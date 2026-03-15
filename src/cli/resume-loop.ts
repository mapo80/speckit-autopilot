import { existsSync, readFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { parseBacklog, Backlog } from "../core/backlog-schema.js";
import { StateStore, AutopilotState, Phase } from "../core/state-store.js";
import {
  buildResumeBanner,
  resolveResumePhase,
  phaseToSpeckitCommand,
  appendToIterationLog,
} from "../core/compact-state.js";
import { readBacklog, ship as shipProduct, PhaseRunner } from "./ship.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResumeResult {
  resumed: boolean;
  banner: string;
  resolvedPhase: string;
  suggestedCommand: string;
  continuedAutomatically: boolean;
  finalStatus?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// State validation
// ---------------------------------------------------------------------------

function validateStateForResume(state: AutopilotState): string | null {
  if (state.status === "completed") return "Product is already completed.";
  if (state.status === "bootstrapped" && !state.activeFeature) return null; // valid, will start loop
  return null; // resumable
}

// ---------------------------------------------------------------------------
// Backlog/state cross-reference
// ---------------------------------------------------------------------------

function reconcileActiveFeature(state: AutopilotState, backlog: Backlog): string | null {
  // State is the source of truth; verify backlog has it in_progress
  if (!state.activeFeature) return null;

  const inProgress = backlog.features.filter((f) => f.status === "in_progress");

  if (inProgress.length === 0 && state.activeFeature) {
    // State says in_progress, backlog doesn't – use state as truth
    return state.activeFeature;
  }

  if (inProgress.length === 1) {
    return inProgress[0].id;
  }

  // Multiple in_progress: prefer state
  return state.activeFeature;
}

// ---------------------------------------------------------------------------
// Main resume function
// ---------------------------------------------------------------------------

export interface ResumeLoopOptions {
  root: string;
  continueAutomatically?: boolean;
  phaseRunner?: PhaseRunner;
  dryRun?: boolean;
}

export async function resumeLoop(opts: ResumeLoopOptions): Promise<ResumeResult> {
  const { root, continueAutomatically = true, dryRun = false } = opts;
  const store = new StateStore(root);

  // 1. Read state
  const state = store.readOrNull();
  if (!state) {
    return {
      resumed: false,
      banner: "No autopilot state found. Run /speckit-autopilot:bootstrap-product first.",
      resolvedPhase: "(none)",
      suggestedCommand: "/speckit-autopilot:bootstrap-product",
      continuedAutomatically: false,
      error: "State file missing",
    };
  }

  // Validate
  const validationError = validateStateForResume(state);
  if (validationError) {
    return {
      resumed: false,
      banner: validationError,
      resolvedPhase: state.currentPhase ?? "(none)",
      suggestedCommand: "/speckit-autopilot:status",
      continuedAutomatically: false,
    };
  }

  // 2. Read backlog
  let backlog: Backlog | null = null;
  const backlogPath = join(root, "docs", "product-backlog.yaml");
  if (existsSync(backlogPath)) {
    try {
      backlog = readBacklog(root);
    } catch {
      backlog = null;
    }
  }

  // 3. Reconcile active feature
  const activeFeatureId = backlog ? reconcileActiveFeature(state, backlog) : state.activeFeature;
  if (activeFeatureId !== state.activeFeature) {
    store.update({ activeFeature: activeFeatureId });
  }

  // 4. Resolve resume phase
  const resolvedPhase = resolveResumePhase(state);
  const suggestedCommand =
    resolvedPhase === "start_from_bootstrap"
      ? "/speckit-autopilot:ship-product"
      : phaseToSpeckitCommand(resolvedPhase as Phase);

  // 5. Build banner
  const banner = buildResumeBanner(store.read());

  // 6. Log resume event
  appendToIterationLog(
    root,
    `\n## RESUME – ${new Date().toISOString()}\n- Resolved phase: ${resolvedPhase}\n- Suggested: ${suggestedCommand}\n`
  );

  // 7. Optionally continue automatically (dryRun is forwarded to shipProduct)
  if (continueAutomatically) {
    const shipResult = await shipProduct({
      root,
      phaseRunner: opts.phaseRunner,
      dryRun,
    });
    return {
      resumed: true,
      banner,
      resolvedPhase: String(resolvedPhase),
      suggestedCommand,
      continuedAutomatically: true,
      finalStatus: shipResult.finalStatus,
    };
  }

  return {
    resumed: true,
    banner,
    resolvedPhase: String(resolvedPhase),
    suggestedCommand,
    continuedAutomatically: false,
    finalStatus: state.status,
  };
}

// ---------------------------------------------------------------------------
// Status formatter (used by status skill)
// ---------------------------------------------------------------------------

export function formatStatus(root: string): string {
  const store = new StateStore(root);
  const state = store.readOrNull();

  if (!state) {
    return "No autopilot state found. Run /speckit-autopilot:bootstrap-product first.";
  }

  let backlog: Backlog | null = null;
  try {
    backlog = readBacklog(root);
  } catch {
    // no backlog
  }

  const counts = { open: 0, in_progress: 0, done: 0, blocked: 0, total: 0 };
  if (backlog) {
    for (const f of backlog.features) {
      counts.total++;
      counts[f.status]++;
    }
  }

  const logPath = join(root, "docs", "iteration-log.md");
  let lastLogLines = "(no log)";
  if (existsSync(logPath)) {
    const log = readFileSync(logPath, "utf8");
    lastLogLines = log.split("\n").filter(Boolean).slice(-10).join("\n");
  }

  const lines = [
    "=== speckit-autopilot STATUS ===",
    "",
    `Mode          : ${state.mode}`,
    `Overall status: ${state.status}`,
    "",
    `Active feature : ${state.activeFeature ?? "(none)"}`,
    `Current phase  : ${state.currentPhase ?? "(none)"}`,
    `Next feature   : ${state.nextFeature ?? "(none)"}`,
    "",
    `Failures       : ${state.consecutiveFailures}/${state.maxFailures}`,
    `Last error     : ${state.lastError ?? "(none)"}`,
    "",
    `Test results   : ${state.lastTestRun ?? "never"} – ${state.lastTestsPassed === null ? "unknown" : state.lastTestsPassed ? "pass" : "fail"}`,
    `Coverage       : ${state.lastCoverage ?? "unknown"}`,
    `Lint           : ${state.lastLintPassed === null ? "unknown" : state.lastLintPassed ? "pass" : "fail"}`,
    "",
    "--- Backlog summary ---",
    `  Open       : ${counts.open}`,
    `  In progress: ${counts.in_progress}`,
    `  Done       : ${counts.done}`,
    `  Blocked    : ${counts.blocked}`,
    `  Total      : ${counts.total}`,
    "",
    "--- Recent iteration log (last 10 lines) ---",
    lastLogLines,
    "",
    `Compact count  : ${state.compactCount}`,
    `Last compact   : ${state.lastCompactAt ?? "never"}`,
    "================================",
  ];

  return lines.join("\n");
}
