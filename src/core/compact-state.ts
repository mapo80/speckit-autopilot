import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { AutopilotState } from "./state-store.js";
import { Phase } from "./state-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompactEntry {
  timestamp: string;
  event: "pre-compact" | "post-compact" | "session-resume";
  activeFeature: string | null;
  currentPhase: Phase | null;
  summary: string;
}

// ---------------------------------------------------------------------------
// Iteration log helpers
// ---------------------------------------------------------------------------

export function readIterationLog(root: string): string {
  const path = join(root, "docs", "iteration-log.md");
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

export function appendToIterationLog(root: string, entry: string): void {
  const path = join(root, "docs", "iteration-log.md");
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "# Iteration Log\n";
  writeFileSync(path, existing + "\n" + entry, "utf8");
}

export function formatCompactEntry(entry: CompactEntry): string {
  const lines = [
    `## ${entry.event.toUpperCase()} – ${entry.timestamp}`,
    `- Active feature: ${entry.activeFeature ?? "(none)"}`,
    `- Current phase:  ${entry.currentPhase ?? "(none)"}`,
    `- Summary: ${entry.summary}`,
    "",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Pre-compact snapshot
// ---------------------------------------------------------------------------

export function savePreCompactSnapshot(root: string, state: AutopilotState): void {
  const entry: CompactEntry = {
    timestamp: new Date().toISOString(),
    event: "pre-compact",
    activeFeature: state.activeFeature,
    currentPhase: state.currentPhase,
    summary: `Status=${state.status} failures=${state.consecutiveFailures}/${state.maxFailures} coverage=${state.lastCoverage ?? "unknown"}`,
  };
  appendToIterationLog(root, formatCompactEntry(entry));
}

// ---------------------------------------------------------------------------
// Post-compact log
// ---------------------------------------------------------------------------

export function recordPostCompact(root: string, state: AutopilotState, compactSummary: string): AutopilotState {
  const timestamp = new Date().toISOString();
  const entry: CompactEntry = {
    timestamp,
    event: "post-compact",
    activeFeature: state.activeFeature,
    currentPhase: state.currentPhase,
    summary: compactSummary.slice(0, 300),
  };
  appendToIterationLog(root, formatCompactEntry(entry));

  return {
    ...state,
    lastCompactAt: timestamp,
    compactCount: (state.compactCount ?? 0) + 1,
    updatedAt: timestamp,
  };
}

// ---------------------------------------------------------------------------
// Session resume banner
// ---------------------------------------------------------------------------

export function buildResumeBanner(state: AutopilotState): string {
  const lines = [
    "=== speckit-autopilot RESUME STATE ===",
    `Active feature : ${state.activeFeature ?? "(none)"}`,
    `Current phase  : ${state.currentPhase ?? "(none)"}`,
    `Next feature   : ${state.nextFeature ?? "(none)"}`,
    `Last error     : ${state.lastError ?? "(none)"}`,
    `Failures       : ${state.consecutiveFailures}/${state.maxFailures}`,
    `Coverage       : ${state.lastCoverage ?? "unknown"}`,
    `Last test run  : ${state.lastTestRun ?? "never"}`,
    `Compact count  : ${state.compactCount}`,
    "======================================",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Resume phase resolution
// ---------------------------------------------------------------------------

export type ResumePhase = Phase | "start_from_bootstrap";

export function resolveResumePhase(state: AutopilotState): ResumePhase {
  if (!state.activeFeature) return "start_from_bootstrap";
  if (!state.currentPhase) return "spec";
  return state.currentPhase;
}

export function phaseToSpeckitCommand(phase: Phase): string {
  const map: Record<Phase, string> = {
    constitution: "/speckit.constitution",
    spec: "/speckit.specify",
    clarify: "/speckit.clarify",
    plan: "/speckit.plan",
    tasks: "/speckit.tasks",
    analyze: "/speckit.analyze",
    implement: "/speckit.implement",
    qa: "(qa-gatekeeper)",
    done: "(feature done – advance to next)",
  };
  return map[phase];
}
