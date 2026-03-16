import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { parseBacklog, Backlog, Feature } from "../core/backlog-schema.js";
import {
  markFeatureStatus,
  setFeatureBranch,
  pickNextFeature,
  getFeatureById,
  getFeatureByTitle,
} from "../core/feature-picker.js";
import { StateStore, Phase } from "../core/state-store.js";
import { appendToIterationLog } from "../core/compact-state.js";
import { runAcceptanceGate, applyGateResultToState } from "../core/acceptance-gate.js";
import { SpecKitRunner, ensureSpecKitInitialized, verifyImplementationProducedCode } from "../core/spec-kit-runner.js";
import { auditFeature } from "./audit.js";
import { buildBrownfieldSnapshot, writeBrownfieldSnapshot, isBrownfieldRepo } from "../core/brownfield-snapshot.js";

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

export interface ShipResult {
  // Loop fields (always present)
  success: boolean;
  completed: number;
  blocked: number;
  failed: number;
  iterations: FeatureIterationResult[];
  // "completed" | "empty_backlog" | "no_open_features" | "blocked" | "failed"
  finalStatus: string;
  // Per-feature fields (set for single-feature case; defaults for loop case)
  featureId: string;
  featureTitle: string;
  mode: "greenfield" | "brownfield";
  brownfieldSnapshotWritten: boolean;
  coverage: string | null;
  error?: string;
}

export interface ShipOptions {
  root: string;
  featureTarget?: string;   // ID (F-001) or title substring; absent → loop all open features
  dryRun?: boolean;
  phaseRunner?: PhaseRunner;
}

// ---------------------------------------------------------------------------
// Codebase snapshot
// ---------------------------------------------------------------------------

const SNAPSHOT_EXCLUDE = new Set([".git", "docs", "node_modules", ".specify", ".speckit", ".claude"]);

function collectFiles(dir: string, base: string, results: string[]): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    const full = join(dir, entry);
    const rel = join(base, entry);
    if (base === "" && SNAPSHOT_EXCLUDE.has(entry)) continue;
    try {
      const st = statSync(full);
      if (st.isDirectory()) {
        collectFiles(full, rel, results);
      } else if (!entry.endsWith(".DS_Store")) {
        results.push(rel);
      }
    } catch { /* skip unreadable entries */ }
  }
}

export function updateCodebaseSnapshot(root: string): void {
  const files: string[] = [];
  collectFiles(root, "", files);
  files.sort();
  const content = `# Codebase File Tree\n\nUpdated: ${new Date().toISOString()}\n\n${files.map((f) => `- ${f}`).join("\n")}\n`;
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "codebase-snapshot.md"), content, "utf8");
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

    // Dry-run: skip real AI calls
    if (dryRun) {
      const constitutionPath = join(root, ".speckit", "constitution.md");
      const phases: Phase[] = [
        ...(existsSync(constitutionPath) ? [] : (["constitution"] as Phase[])),
        "spec",
        "clarify",
        "plan",
        "tasks",
        "analyze",
        "implement",
      ];
      const startIdx = startFromPhase ? phases.indexOf(startFromPhase) : 0;
      const activePhases = startIdx >= 0 ? phases.slice(startIdx) : phases;
      const lastPhase: Phase = activePhases[activePhases.length - 1] ?? "implement";
      return { success: true, phase: lastPhase };
    }

    // Ensure Spec Kit is initialized
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
      const bl = readBacklog(root);
      const feature = bl.features.find((f) => f.id === featureId);
      acceptanceCriteria = feature?.acceptanceCriteria ?? [];
    } catch {
      // backlog unavailable — proceed without criteria
    }

    // Run Spec Kit phases
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
// Feature resolution
// ---------------------------------------------------------------------------

export function resolveTargetFeature(backlog: Backlog, target?: string): Feature | undefined {
  if (!target) return backlog.features.find((f) => f.status === "open");
  const byId = getFeatureById(backlog, target);
  if (byId) return byId;
  return getFeatureByTitle(backlog, target);
}

// ---------------------------------------------------------------------------
// Internal: per-feature execution (shared between single and loop)
// ---------------------------------------------------------------------------

interface RunOneFeatureOpts {
  root: string;
  feature: Feature;
  store: StateStore;
  backlog: Backlog;
  phaseRunner: PhaseRunner;
  startFromPhase: Phase;  // "spec" for single-feature; state.currentPhase for loop (resume)
  dryRun: boolean;
}

interface RunOneResult {
  success: boolean;
  updatedBacklog: Backlog;
  brownfieldSnapshotWritten: boolean;
  coverage: string | null;
  error?: string;
  phase: Phase;
}

async function runOneFeature(opts: RunOneFeatureOpts): Promise<RunOneResult> {
  const { root, feature, store, phaseRunner, dryRun, startFromPhase } = opts;
  let backlog = opts.backlog;

  // 1. Mark in_progress + set branch (from ship-product.ts)
  const branch = `feature/${feature.id.toLowerCase()}`;
  backlog = markFeatureStatus(backlog, feature.id, "in_progress");
  backlog = setFeatureBranch(backlog, feature.id, branch);
  writeBacklog(root, backlog);

  // 2. Update state
  let state = store.update({
    activeFeature: feature.id,
    currentPhase: startFromPhase,
    nextFeature: null,
    status: "running",
  });

  // 3. Iteration log: START
  appendToIterationLog(
    root,
    `\n## START – ${feature.id} "${feature.title}" – ${new Date().toISOString()}\n- Branch: ${branch}\n`
  );

  // 4. Brownfield snapshot — write only if not already present and not dry-run
  let brownfieldSnapshotWritten = false;
  const snapshotPath = join(root, "docs", "brownfield-snapshot.md");
  if (isBrownfieldRepo(root) && !existsSync(snapshotPath) && !dryRun) {
    const snapshot = buildBrownfieldSnapshot(root, feature.title);
    writeBrownfieldSnapshot(root, snapshot);
    brownfieldSnapshotWritten = true;
  }

  // 5. Run phases
  const phaseResult = await phaseRunner({
    root,
    featureId: feature.id,
    featureTitle: feature.title,
    startFromPhase,
    dryRun,
  });

  state = store.update({ currentPhase: phaseResult.phase });

  // 6. Phase failure
  if (!phaseResult.success) {
    const failures = (state.consecutiveFailures ?? 0) + 1;
    state = store.update({
      consecutiveFailures: failures,
      lastError: phaseResult.error ?? "Phase runner failed",
    });
    backlog = markFeatureStatus(backlog, feature.id, "open");
    writeBacklog(root, backlog);
    appendToIterationLog(
      root,
      `\n## FAIL – ${feature.id} – ${new Date().toISOString()}\nPhase: ${phaseResult.phase}\nError: ${phaseResult.error ?? "unknown"}\n`
    );
    return {
      success: false,
      updatedBacklog: backlog,
      brownfieldSnapshotWritten,
      coverage: null,
      error: phaseResult.error,
      phase: phaseResult.phase,
    };
  }

  // 7. Update codebase snapshot so subsequent features see newly created files
  if (!dryRun) updateCodebaseSnapshot(root);

  // 8. QA gate
  state = store.update({ currentPhase: "qa" });
  const gateResult = dryRun
    ? { passed: true, checks: [], coverage: null, summary: "dry-run" }
    : runAcceptanceGate(root, state);

  const gatePatch = applyGateResultToState(state, gateResult);
  state = store.update(gatePatch);

  // 8. Gate failure
  if (!gateResult.passed) {
    const failures = (state.consecutiveFailures ?? 0) + 1;
    state = store.update({
      consecutiveFailures: failures,
      lastError: gateResult.summary,
      currentPhase: "spec",
    });
    backlog = markFeatureStatus(backlog, feature.id, "open");
    writeBacklog(root, backlog);
    appendToIterationLog(
      root,
      `\n## QA FAIL – ${feature.id} – ${new Date().toISOString()}\n${gateResult.summary}\n`
    );
    return {
      success: false,
      updatedBacklog: backlog,
      brownfieldSnapshotWritten,
      coverage: gateResult.coverage?.toString() ?? null,
      error: gateResult.summary,
      phase: "qa",
    };
  }

  // 9. Mark done, reset state
  backlog = markFeatureStatus(backlog, feature.id, "done");
  writeBacklog(root, backlog);
  store.update({
    consecutiveFailures: 0,
    activeFeature: null,
    currentPhase: null,
    lastError: null,
    status: "running",
  });

  const coverage = gateResult.coverage?.toString() ?? null;

  if (!dryRun) {
    // 10. Implementation report
    const implVerify = verifyImplementationProducedCode(root, feature.id);
    const reportDir = join(root, "docs", "specs", feature.id.toLowerCase());
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      join(reportDir, "implementation-report.json"),
      JSON.stringify({
        featureId: feature.id,
        completedAt: new Date().toISOString(),
        changedFiles: implVerify.changedFiles,
        newFileCount: implVerify.changedFiles.length,
        qaChecks: gateResult.checks.map((c) => ({ name: c.name, passed: c.passed, details: c.details })),
        coverage: gateResult.coverage,
      }, null, 2),
      "utf8"
    );

    const filesSummary = implVerify.changedFiles.length > 0
      ? `${implVerify.changedFiles.length} (${implVerify.changedFiles.slice(0, 5).map((f) => f.split("/").pop()).join(", ")}${implVerify.changedFiles.length > 5 ? ", ..." : ""})`
      : "0";
    const qaSummary = gateResult.checks
      .map((c) => `${c.name}=${c.passed ? (c.details.startsWith("skipped") ? "skipped" : "pass") : "FAIL"}`)
      .join(", ");

    // 12. Iteration log: DONE
    appendToIterationLog(
      root,
      `\n## DONE – ${feature.id} "${feature.title}" – ${new Date().toISOString()}\n- Files: ${filesSummary}\n- QA: ${qaSummary || "dry-run"}\n- Coverage: ${coverage ?? "n/a"}\n`
    );

    // 11. Audit (best-effort, from ship-product.ts)
    try { await auditFeature(root, feature.id, feature.title); } catch { /* best-effort */ }
  } else {
    appendToIterationLog(
      root,
      `\n## DONE – ${feature.id} "${feature.title}" – ${new Date().toISOString()}\nCoverage: ${coverage ?? "unknown"}\n`
    );
  }

  return {
    success: true,
    updatedBacklog: backlog,
    brownfieldSnapshotWritten,
    coverage,
    phase: "done",
  };
}

// ---------------------------------------------------------------------------
// Unified ship function
// ---------------------------------------------------------------------------

export async function ship(opts: ShipOptions): Promise<ShipResult> {
  const { root, featureTarget, dryRun = false } = opts;
  const phaseRunner = opts.phaseRunner ?? makeDefaultPhaseRunner();

  // 1. Verify backlog (required in both modes)
  const backlogPath = join(root, "docs", "product-backlog.yaml");
  if (!existsSync(backlogPath)) {
    const mode = isBrownfieldRepo(root) ? "brownfield" : "greenfield";
    return {
      success: false,
      completed: 0,
      blocked: 0,
      failed: 0,
      iterations: [],
      finalStatus: "failed",
      featureId: "",
      featureTitle: featureTarget ?? "(unknown)",
      mode,
      brownfieldSnapshotWritten: false,
      coverage: null,
      error:
        "product-backlog.yaml not found.\n" +
        "Run: node run.mjs generate --spec <path> && node run.mjs bootstrap",
    };
  }

  // 2. Detect mode
  const brownfield = isBrownfieldRepo(root);
  const mode: "greenfield" | "brownfield" = brownfield ? "brownfield" : "greenfield";

  // 3. Create state if missing (user-friendly: ship-feature.ts behavior)
  const store = new StateStore(root);
  if (!store.exists()) {
    store.createInitial(mode);
  }

  // 4. Set status running
  let state = store.update({ status: "running" });

  let backlog = readBacklog(root);

  // -------------------------------------------------------------------------
  // 5. Single-feature case
  // -------------------------------------------------------------------------
  if (featureTarget !== undefined) {
    const feature = resolveTargetFeature(backlog, featureTarget);
    if (!feature) {
      return {
        success: false,
        completed: 0,
        blocked: 0,
        failed: 1,
        iterations: [],
        finalStatus: "failed",
        featureId: "",
        featureTitle: featureTarget,
        mode,
        brownfieldSnapshotWritten: false,
        coverage: null,
        error: `Feature not found: ${featureTarget ?? "no open features in backlog"}`,
      };
    }

    const oneResult = await runOneFeature({
      root,
      feature,
      store,
      backlog,
      phaseRunner,
      startFromPhase: "spec",
      dryRun,
    });

    return {
      success: oneResult.success,
      completed: oneResult.success ? 1 : 0,
      blocked: 0,
      failed: oneResult.success ? 0 : 1,
      iterations: [
        {
          featureId: feature.id,
          featureTitle: feature.title,
          success: oneResult.success,
          phase: oneResult.phase,
          error: oneResult.error,
        },
      ],
      finalStatus: oneResult.success ? "completed" : "failed",
      featureId: feature.id,
      featureTitle: feature.title,
      mode,
      brownfieldSnapshotWritten: oneResult.brownfieldSnapshotWritten,
      coverage: oneResult.coverage,
      error: oneResult.error,
    };
  }

  // -------------------------------------------------------------------------
  // 6. Loop case — all open features
  // -------------------------------------------------------------------------

  // Reset any features stuck in_progress from a previous interrupted run
  const stuckFeatures = backlog.features.filter((f) => f.status === "in_progress");
  const hadStuck = stuckFeatures.length > 0;
  if (hadStuck) {
    backlog = {
      ...backlog,
      features: backlog.features.map((f) =>
        f.status === "in_progress" ? { ...f, status: "open" } : f
      ),
    };
    writeBacklog(root, backlog);
    appendToIterationLog(
      root,
      `\n## STUCK RESET – ${new Date().toISOString()}\nReset in_progress → open: ${stuckFeatures.map((f) => f.id).join(", ")}\n`
    );
  }

  const result: ShipResult = {
    success: false,
    completed: 0,
    blocked: 0,
    failed: 0,
    iterations: [],
    finalStatus: "running",
    featureId: "",
    featureTitle: "",
    mode,
    brownfieldSnapshotWritten: false,
    coverage: null,
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const pick = pickNextFeature(backlog);

    if (!pick.ok) {
      if (pick.failure.reason === "all_done") {
        result.finalStatus = "completed";
        result.success = true;
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
      // blocked_by_dependencies
      const bf = (pick.failure as { reason: "blocked_by_dependencies"; feature: Feature; blockedBy: string[] }).feature;
      const blockedBy = (pick.failure as { reason: "blocked_by_dependencies"; feature: Feature; blockedBy: string[] }).blockedBy;
      appendToIterationLog(
        root,
        `\n## BLOCKED – ${new Date().toISOString()}\nFeature ${bf.id} blocked by: ${blockedBy.join(", ")}\n`
      );
      result.blocked++;
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

    // Resume from saved phase when feature was in_progress
    const startFromPhase: Phase = state.currentPhase ?? "spec";

    const oneResult = await runOneFeature({
      root,
      feature,
      store,
      backlog,
      phaseRunner,
      startFromPhase,
      dryRun,
    });

    backlog = oneResult.updatedBacklog;
    if (oneResult.brownfieldSnapshotWritten) result.brownfieldSnapshotWritten = true;

    // Re-read state after runOneFeature updated it
    state = store.read();

    result.iterations.push({
      featureId: feature.id,
      featureTitle: feature.title,
      success: oneResult.success,
      phase: oneResult.phase,
      error: oneResult.error,
    });

    if (oneResult.success) {
      result.completed++;
    } else {
      result.failed++;
    }
  }

  return result;
}
