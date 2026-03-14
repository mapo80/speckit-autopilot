import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { parseBacklog, Backlog } from "../core/backlog-schema.js";
import { markFeatureStatus, setFeatureBranch } from "../core/feature-picker.js";
import { StateStore, Phase } from "../core/state-store.js";
import { pickNextFeature } from "../core/feature-picker.js";
import { appendToIterationLog } from "../core/compact-state.js";
import { runAcceptanceGate, applyGateResultToState } from "../core/acceptance-gate.js";
import { SpecKitRunner, ensureSpecKitInitialized, verifyImplementationProducedCode } from "../core/spec-kit-runner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShipPhase = Phase;

export interface FeatureIterationResult {
  featureId: string;
  featureTitle: string;
  success: boolean;
  phase: ShipPhase;
  error?: string;
}

export interface ShipProductResult {
  completed: number;
  blocked: number;
  failed: number;
  iterations: FeatureIterationResult[];
  finalStatus: string;
}

// ---------------------------------------------------------------------------
// Backlog I/O
// ---------------------------------------------------------------------------

export function readBacklog(root: string): Backlog {
  const path = join(root, "docs", "product-backlog.yaml");
  if (!existsSync(path)) {
    throw new Error(`product-backlog.yaml not found. Run bootstrap-product first.`);
  }
  const raw = yaml.load(readFileSync(path, "utf8")) as unknown;
  return parseBacklog(raw);
}

export function writeBacklog(root: string, backlog: Backlog): void {
  const path = join(root, "docs", "product-backlog.yaml");
  writeFileSync(path, yaml.dump(backlog), "utf8");
}

// ---------------------------------------------------------------------------
// Phase runner (Spec Kit integration)
// ---------------------------------------------------------------------------

export interface PhaseRunnerOptions {
  root: string;
  featureId: string;
  featureTitle: string;
  startFromPhase?: Phase;
  dryRun?: boolean;
}

export type PhaseRunner = (opts: PhaseRunnerOptions) => Promise<{ success: boolean; phase: Phase; error?: string }>;

export function makeDefaultPhaseRunner(apiKey?: string): PhaseRunner {
  return async (opts) => {
    const { root, featureId, featureTitle, startFromPhase, dryRun } = opts;

    // Dry-run: skip real AI calls but still validate init
    if (dryRun) {
      const phases: Phase[] = ["constitution", "spec", "clarify", "plan", "tasks", "analyze", "implement"];
      const startIdx = startFromPhase ? phases.indexOf(startFromPhase) : 0;
      const activePhases = startIdx >= 0 ? phases.slice(startIdx) : phases;
      const lastPhase: Phase = activePhases[activePhases.length - 1] ?? "implement";
      return { success: true, phase: lastPhase };
    }

    // Ensure spec-kit is initialized in the project root
    const initResult = ensureSpecKitInitialized(root);
    if (!initResult.ok) {
      return {
        success: false,
        phase: "constitution" as Phase,
        error: `Spec Kit initialization failed: ${initResult.error}`,
      };
    }

    // Build runner — fails immediately if ANTHROPIC_API_KEY is missing
    let runner: SpecKitRunner;
    try {
      runner = new SpecKitRunner(root, apiKey);
    } catch (err) {
      return {
        success: false,
        phase: "spec" as Phase,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // Read acceptance criteria from the backlog if available
    let acceptanceCriteria: string[] = [];
    try {
      const backlog = readBacklog(root);
      const feature = backlog.features.find((f) => f.id === featureId);
      acceptanceCriteria = feature?.acceptanceCriteria ?? [];
    } catch {
      // backlog unavailable — proceed without criteria
    }

    // Run spec → plan → tasks → implement phases
    const result = await runner.runPhases(featureId, featureTitle, acceptanceCriteria, startFromPhase ?? "spec");

    if (!result.success) {
      return { success: false, phase: result.phase, error: result.error };
    }

    // Verify implementation produced real code
    const verification = verifyImplementationProducedCode(root, featureId);
    if (!verification.hasNewFiles) {
      return {
        success: false,
        phase: "implement" as Phase,
        error: `No application code produced. ${verification.diffSummary}`,
      };
    }

    return { success: true, phase: result.phase };
  };
}

// ---------------------------------------------------------------------------
// Main ship-product orchestrator
// ---------------------------------------------------------------------------

export interface ShipProductOptions {
  root: string;
  phaseRunner?: PhaseRunner;
  dryRun?: boolean;
}

export async function shipProduct(opts: ShipProductOptions): Promise<ShipProductResult> {
  const { root, dryRun = false } = opts;
  const phaseRunner = opts.phaseRunner ?? makeDefaultPhaseRunner();
  const store = new StateStore(root);

  // Ensure state exists
  if (!store.exists()) {
    throw new Error("autopilot-state.json not found. Run bootstrap-product first.");
  }

  let state = store.read();
  let backlog = readBacklog(root);

  // Reset any features stuck in_progress from a previous interrupted run
  // so pickNextFeature can re-select them on this run.
  const hadStuck = backlog.features.some((f) => f.status === "in_progress");
  if (hadStuck) {
    backlog = {
      ...backlog,
      features: backlog.features.map((f) =>
        f.status === "in_progress" ? { ...f, status: "open" } : f
      ),
    };
    writeBacklog(root, backlog);
  }

  const result: ShipProductResult = {
    completed: 0,
    blocked: 0,
    failed: 0,
    iterations: [],
    finalStatus: "running",
  };

  // Set status to running
  state = store.update({ status: "running" });

  // Main loop
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const pick = pickNextFeature(backlog);

    if (!pick.ok) {
      if (pick.failure.reason === "all_done") {
        result.finalStatus = "completed";
        state = store.update({ status: "completed", activeFeature: null, currentPhase: null });
        appendToIterationLog(root, `\n## PRODUCT COMPLETED – ${new Date().toISOString()}\nAll features shipped.\n`);
        break;
      }
      if (pick.failure.reason === "empty_backlog") {
        result.finalStatus = "empty_backlog";
        break;
      }
      if (pick.failure.reason === "no_open_features") {
        result.finalStatus = "no_open_features";
        break;
      }
      // blocked_by_dependencies (only remaining PickFailure reason)
      result.blocked++;
      const bf = (pick.failure as { reason: "blocked_by_dependencies"; feature: import("../core/backlog-schema.js").Feature; blockedBy: string[] }).feature;
      const blockedBy = (pick.failure as { reason: "blocked_by_dependencies"; feature: import("../core/backlog-schema.js").Feature; blockedBy: string[] }).blockedBy;
      appendToIterationLog(
        root,
        `\n## BLOCKED – ${new Date().toISOString()}\nFeature ${bf.id} blocked by: ${blockedBy.join(", ")}\n`
      );
      result.finalStatus = "blocked";
      state = store.update({
        status: "blocked",
        lastError: `Feature ${bf.id} blocked by unmet dependencies: ${blockedBy.join(", ")}`,
      });
      break;
    }

    const { feature } = pick.result;

    // Check failure threshold
    if (state.consecutiveFailures >= state.maxFailures) {
      backlog = markFeatureStatus(backlog, feature.id, "blocked");
      writeBacklog(root, backlog);
      state = store.update({
        status: "running",
        activeFeature: null,
        currentPhase: null,
        consecutiveFailures: 0,
        lastError: `Feature ${feature.id} blocked after ${state.maxFailures} failures`,
      });
      result.blocked++;
      appendToIterationLog(
        root,
        `\n## FEATURE BLOCKED – ${new Date().toISOString()}\n${feature.id} blocked after ${state.maxFailures} failures.\n`
      );
      continue;
    }

    // Mark in_progress
    backlog = markFeatureStatus(backlog, feature.id, "in_progress");
    const branch = `feature/${feature.id.toLowerCase()}`;
    backlog = setFeatureBranch(backlog, feature.id, branch);
    writeBacklog(root, backlog);
    state = store.update({
      activeFeature: feature.id,
      currentPhase: "spec",
      nextFeature: null,
      status: "running",
    });

    appendToIterationLog(
      root,
      `\n## START – ${feature.id} "${feature.title}" – ${new Date().toISOString()}\n- Branch: ${branch}\n`
    );

    // Run phases
    const startPhase: Phase = state.currentPhase ?? "spec";
    const phaseResult = await phaseRunner({
      root,
      featureId: feature.id,
      featureTitle: feature.title,
      startFromPhase: startPhase,
      dryRun,
    });

    state = store.update({ currentPhase: phaseResult.phase });

    if (!phaseResult.success) {
      const failures = (state.consecutiveFailures ?? 0) + 1;
      state = store.update({
        consecutiveFailures: failures,
        lastError: phaseResult.error ?? "Phase runner failed",
        status: failures >= state.maxFailures ? "error" : "running",
      });
      backlog = markFeatureStatus(backlog, feature.id, "open"); // reopen for retry
      writeBacklog(root, backlog);
      result.failed++;
      result.iterations.push({
        featureId: feature.id,
        featureTitle: feature.title,
        success: false,
        phase: phaseResult.phase,
        error: phaseResult.error,
      });
      appendToIterationLog(
        root,
        `\n## FAIL – ${feature.id} – ${new Date().toISOString()}\nPhase: ${phaseResult.phase}\nError: ${phaseResult.error ?? "unknown"}\n`
      );
      continue;
    }

    // QA gate
    state = store.update({ currentPhase: "qa" });
    const gateResult = dryRun
      ? { passed: true, checks: [], coverage: null, summary: "dry-run" }
      : runAcceptanceGate(root, state);

    const gatePatch = applyGateResultToState(state, gateResult);
    state = store.update(gatePatch);

    if (!gateResult.passed) {
      const failures = (state.consecutiveFailures ?? 0) + 1;
      state = store.update({
        consecutiveFailures: failures,
        lastError: gateResult.summary,
      });
      backlog = markFeatureStatus(backlog, feature.id, "open");
      writeBacklog(root, backlog);
      result.failed++;
      result.iterations.push({
        featureId: feature.id,
        featureTitle: feature.title,
        success: false,
        phase: "qa",
        error: gateResult.summary,
      });
      appendToIterationLog(
        root,
        `\n## QA FAIL – ${feature.id} – ${new Date().toISOString()}\n${gateResult.summary}\n`
      );
      continue;
    }

    // Success
    backlog = markFeatureStatus(backlog, feature.id, "done");
    writeBacklog(root, backlog);
    state = store.update({
      consecutiveFailures: 0,
      activeFeature: null,
      currentPhase: null,
      lastError: null,
      status: "running",
    });

    result.completed++;
    result.iterations.push({
      featureId: feature.id,
      featureTitle: feature.title,
      success: true,
      phase: "done",
    });

    appendToIterationLog(
      root,
      `\n## DONE – ${feature.id} "${feature.title}" – ${new Date().toISOString()}\nCoverage: ${state.lastCoverage ?? "unknown"}\n`
    );
  }

  return result;
}
