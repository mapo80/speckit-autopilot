import { readFileSync, existsSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { parseBacklog, Backlog, Feature } from "../core/backlog-schema.js";
import { StateStore } from "../core/state-store.js";
import { getFeatureById, getFeatureByTitle, markFeatureStatus } from "../core/feature-picker.js";
import { buildBrownfieldSnapshot, writeBrownfieldSnapshot, isBrownfieldRepo } from "../core/brownfield-snapshot.js";
import { appendToIterationLog } from "../core/compact-state.js";
import { runAcceptanceGate, applyGateResultToState } from "../core/acceptance-gate.js";
import { readBacklog, writeBacklog, makeDefaultPhaseRunner } from "./ship-product.js";
import { bootstrapProduct } from "./bootstrap-product.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShipFeatureOptions {
  root: string;
  featureTarget?: string; // ID (F-001) or title substring
  dryRun?: boolean;
  phaseRunner?: import("./ship-product.js").PhaseRunner; // injectable for testing
}

export interface ShipFeatureResult {
  success: boolean;
  featureId: string;
  featureTitle: string;
  mode: "greenfield" | "brownfield";
  brownfieldSnapshotWritten: boolean;
  phases: string[];
  coverage: string | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Feature resolution
// ---------------------------------------------------------------------------

export function resolveTargetFeature(
  backlog: Backlog,
  target?: string
): Feature | undefined {
  if (!target) return backlog.features.find((f) => f.status === "open");
  // Try ID first
  const byId = getFeatureById(backlog, target);
  if (byId) return byId;
  // Try title substring
  return getFeatureByTitle(backlog, target);
}

// ---------------------------------------------------------------------------
// Main ship-feature orchestrator
// ---------------------------------------------------------------------------

export async function shipFeature(opts: ShipFeatureOptions): Promise<ShipFeatureResult> {
  const { root, featureTarget, dryRun = false } = opts;
  const customPhaseRunner = opts.phaseRunner;
  const store = new StateStore(root);

  // Detect mode
  const brownfield = isBrownfieldRepo(root);
  const mode: "greenfield" | "brownfield" = brownfield ? "brownfield" : "greenfield";

  // Ensure backlog exists
  const backlogPath = join(root, "docs", "product-backlog.yaml");
  if (!existsSync(backlogPath)) {
    if (!brownfield) {
      // Greenfield: run bootstrap first
      await bootstrapProduct(root);
    } else {
      // Brownfield without backlog: treat as standalone feature
      return runStandaloneFeature(root, store, mode, featureTarget ?? "Unnamed Feature", dryRun, customPhaseRunner);
    }
  }

  const backlog = readBacklog(root);

  // Ensure state exists
  if (!store.exists()) {
    store.createInitial(mode);
  }

  let state = store.read();

  // Resolve target feature
  const feature = resolveTargetFeature(backlog, featureTarget);
  if (!feature) {
    return {
      success: false,
      featureId: "",
      featureTitle: featureTarget ?? "(unknown)",
      mode,
      brownfieldSnapshotWritten: false,
      phases: [],
      coverage: null,
      error: `Feature not found: ${featureTarget ?? "no open features in backlog"}`,
    };
  }

  // Brownfield snapshot
  let brownfieldSnapshotWritten = false;
  if (brownfield) {
    const snapshot = buildBrownfieldSnapshot(root, feature.title);
    if (!dryRun) {
      writeBrownfieldSnapshot(root, snapshot);
      brownfieldSnapshotWritten = true;
    }
    store.update({ mode: "brownfield" });
    state = store.read();
  }

  // Mark in_progress
  let updatedBacklog = markFeatureStatus(backlog, feature.id, "in_progress");
  if (!dryRun) writeBacklog(root, updatedBacklog);

  state = store.update({
    mode,
    activeFeature: feature.id,
    currentPhase: "spec",
    status: "running",
  });

  appendToIterationLog(
    root,
    `\n## SHIP-FEATURE START – ${feature.id} "${feature.title}" – ${new Date().toISOString()}\n- Mode: ${mode}\n`
  );

  // Run phases
  const phaseRunner = customPhaseRunner ?? makeDefaultPhaseRunner();
  const phaseResult = await phaseRunner({
    root,
    featureId: feature.id,
    featureTitle: feature.title,
    startFromPhase: "spec",
    dryRun,
  });

  if (!phaseResult.success) {
    if (!dryRun) {
      updatedBacklog = markFeatureStatus(updatedBacklog, feature.id, "open");
      writeBacklog(root, updatedBacklog);
      store.update({
        currentPhase: phaseResult.phase,
        lastError: phaseResult.error ?? "Phase runner failed",
        consecutiveFailures: (state.consecutiveFailures ?? 0) + 1,
      });
    }
    return {
      success: false,
      featureId: feature.id,
      featureTitle: feature.title,
      mode,
      brownfieldSnapshotWritten,
      phases: [phaseResult.phase],
      coverage: null,
      error: phaseResult.error,
    };
  }

  // QA gate
  state = store.update({ currentPhase: "qa" });
  const gateResult = dryRun
    ? { passed: true, checks: [], coverage: null, summary: "dry-run" }
    : runAcceptanceGate(root, state);

  const gatePatch = applyGateResultToState(state, gateResult);
  if (!dryRun) store.update(gatePatch);

  if (!gateResult.passed) {
    if (!dryRun) {
      updatedBacklog = markFeatureStatus(updatedBacklog, feature.id, "open");
      writeBacklog(root, updatedBacklog);
      store.update({ lastError: gateResult.summary });
    }
    return {
      success: false,
      featureId: feature.id,
      featureTitle: feature.title,
      mode,
      brownfieldSnapshotWritten,
      phases: ["qa"],
      coverage: gateResult.coverage?.toString() ?? null,
      error: gateResult.summary,
    };
  }

  // Mark done
  updatedBacklog = markFeatureStatus(updatedBacklog, feature.id, "done");
  if (!dryRun) {
    writeBacklog(root, updatedBacklog);
    store.update({
      consecutiveFailures: 0,
      activeFeature: null,
      currentPhase: null,
      lastError: null,
    });
    appendToIterationLog(
      root,
      `\n## SHIP-FEATURE DONE – ${feature.id} "${feature.title}" – ${new Date().toISOString()}\n`
    );
  }

  return {
    success: true,
    featureId: feature.id,
    featureTitle: feature.title,
    mode,
    brownfieldSnapshotWritten,
    phases: ["spec", "clarify", "plan", "tasks", "analyze", "implement", "qa", "done"],
    coverage: gateResult.coverage?.toString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Standalone feature (brownfield without backlog)
// ---------------------------------------------------------------------------

async function runStandaloneFeature(
  root: string,
  store: StateStore,
  mode: "greenfield" | "brownfield",
  featureTitle: string,
  dryRun: boolean,
  customPhaseRunner?: import("./ship-product.js").PhaseRunner
): Promise<ShipFeatureResult> {
  if (!store.exists()) store.createInitial(mode);

  const snapshot = buildBrownfieldSnapshot(root, featureTitle);
  let brownfieldSnapshotWritten = false;
  if (!dryRun) {
    writeBrownfieldSnapshot(root, snapshot);
    brownfieldSnapshotWritten = true;
  }

  store.update({ mode, activeFeature: featureTitle, currentPhase: "spec", status: "running" });

  const phaseRunner = customPhaseRunner ?? makeDefaultPhaseRunner();
  const phaseResult = await phaseRunner({
    root,
    featureId: "standalone",
    featureTitle,
    startFromPhase: "spec",
    dryRun,
  });

  if (!phaseResult.success) {
    return {
      success: false,
      featureId: "standalone",
      featureTitle,
      mode,
      brownfieldSnapshotWritten,
      phases: [phaseResult.phase],
      coverage: null,
      error: phaseResult.error,
    };
  }

  if (!dryRun) {
    store.update({ activeFeature: null, currentPhase: null, lastError: null });
    appendToIterationLog(root, `\n## STANDALONE DONE – "${featureTitle}" – ${new Date().toISOString()}\n`);
  }

  return {
    success: true,
    featureId: "standalone",
    featureTitle,
    mode,
    brownfieldSnapshotWritten,
    phases: ["spec", "clarify", "plan", "tasks", "analyze", "implement", "qa", "done"],
    coverage: null,
  };
}
