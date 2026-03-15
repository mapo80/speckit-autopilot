import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { parseBacklog, Backlog, Feature } from "../core/backlog-schema.js";
import { StateStore } from "../core/state-store.js";
import { getFeatureById, getFeatureByTitle, markFeatureStatus } from "../core/feature-picker.js";
import { buildBrownfieldSnapshot, writeBrownfieldSnapshot, isBrownfieldRepo } from "../core/brownfield-snapshot.js";
import { appendToIterationLog } from "../core/compact-state.js";
import { runAcceptanceGate, applyGateResultToState } from "../core/acceptance-gate.js";
import { readBacklog, writeBacklog, makeDefaultPhaseRunner } from "./ship-product.js";
import { verifyImplementationProducedCode } from "../core/spec-kit-runner.js";

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

  // Ensure backlog exists — required in both modes
  const backlogPath = join(root, "docs", "product-backlog.yaml");
  if (!existsSync(backlogPath)) {
    return {
      success: false,
      featureId: "",
      featureTitle: featureTarget ?? "(unknown)",
      mode,
      brownfieldSnapshotWritten: false,
      phases: [],
      coverage: null,
      error:
        "product-backlog.yaml not found.\n" +
        "Run: node run.mjs generate --spec <path> && node run.mjs bootstrap",
    };
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

    // Persist implementation report
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
    const qaSummary = gateResult.checks.map((c) => `${c.name}=${c.passed ? (c.details.startsWith("skipped") ? "skipped" : "pass") : "FAIL"}`).join(", ");
    appendToIterationLog(
      root,
      `\n## SHIP-FEATURE DONE – ${feature.id} "${feature.title}" – ${new Date().toISOString()}\n- Files: ${filesSummary}\n- QA: ${qaSummary || "dry-run"}\n- Coverage: ${gateResult.coverage ?? "n/a"}\n`
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

