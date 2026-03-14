import { Feature, Backlog, FeatureStatus, priorityWeight } from "./backlog-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PickResult {
  feature: Feature;
  index: number;
}

export type PickFailure =
  | { reason: "empty_backlog" }
  | { reason: "all_done" }
  | { reason: "blocked_by_dependencies"; feature: Feature; blockedBy: string[] }
  | { reason: "no_open_features" };

export type PickOutcome = { ok: true; result: PickResult } | { ok: false; failure: PickFailure };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function doneFeatureIds(features: Feature[]): Set<string> {
  return new Set(features.filter((f) => f.status === "done").map((f) => f.id));
}

function openFeatures(features: Feature[]): Feature[] {
  return features.filter((f) => f.status === "open");
}

function dependenciesMet(feature: Feature, done: Set<string>): boolean {
  return feature.dependsOn.every((dep) => done.has(dep));
}

function missingDependencies(feature: Feature, done: Set<string>): string[] {
  return feature.dependsOn.filter((dep) => !done.has(dep));
}

// ---------------------------------------------------------------------------
// Feature picker
// ---------------------------------------------------------------------------

export function pickNextFeature(backlog: Backlog): PickOutcome {
  const { features } = backlog;

  if (features.length === 0) {
    return { ok: false, failure: { reason: "empty_backlog" } };
  }

  const allDone = features.every((f) => f.status === "done");
  if (allDone) {
    return { ok: false, failure: { reason: "all_done" } };
  }

  const open = openFeatures(features);
  if (open.length === 0) {
    return { ok: false, failure: { reason: "no_open_features" } };
  }

  const done = doneFeatureIds(features);

  // Sort open features: priority desc, then original order
  const candidates = open
    .map((f) => ({ feature: f, originalIndex: features.indexOf(f) }))
    .sort((a, b) => {
      const pd = priorityWeight(b.feature.priority) - priorityWeight(a.feature.priority);
      if (pd !== 0) return pd;
      return a.originalIndex - b.originalIndex;
    });

  for (const { feature, originalIndex } of candidates) {
    if (dependenciesMet(feature, done)) {
      return { ok: true, result: { feature, index: originalIndex } };
    }
  }

  // All open features are blocked by unmet dependencies – return the first as the blocker
  const first = candidates[0];
  return {
    ok: false,
    failure: {
      reason: "blocked_by_dependencies",
      feature: first.feature,
      blockedBy: missingDependencies(first.feature, done),
    },
  };
}

// ---------------------------------------------------------------------------
// Backlog mutation helpers
// ---------------------------------------------------------------------------

export function markFeatureStatus(backlog: Backlog, featureId: string, status: FeatureStatus): Backlog {
  return {
    ...backlog,
    features: backlog.features.map((f) => (f.id === featureId ? { ...f, status } : f)),
  };
}

export function setFeatureBranch(backlog: Backlog, featureId: string, branch: string): Backlog {
  return {
    ...backlog,
    features: backlog.features.map((f) => (f.id === featureId ? { ...f, specKitBranch: branch } : f)),
  };
}

export function getFeatureById(backlog: Backlog, featureId: string): Feature | undefined {
  return backlog.features.find((f) => f.id === featureId);
}

export function getFeatureByTitle(backlog: Backlog, title: string): Feature | undefined {
  const lower = title.toLowerCase();
  return backlog.features.find((f) => f.title.toLowerCase().includes(lower));
}
