import {
  pickNextFeature,
  markFeatureStatus,
  setFeatureBranch,
  getFeatureById,
  getFeatureByTitle,
} from "../../src/core/feature-picker.js";
import { Feature, Backlog, makeEmptyBacklog } from "../../src/core/backlog-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFeature(id: string, priority: Feature["priority"] = "medium", dependsOn: string[] = [], status: Feature["status"] = "open"): Feature {
  return {
    id,
    title: `Feature ${id}`,
    epic: "Core",
    status,
    priority,
    dependsOn,
    acceptanceCriteria: [],
    estimatedComplexity: "medium",
    specKitBranch: "",
    notes: "",
  };
}

function makeBacklog(features: Feature[]): Backlog {
  return { version: "1", generatedAt: "2024-01-01T00:00:00.000Z", features };
}

// ---------------------------------------------------------------------------
// pickNextFeature
// ---------------------------------------------------------------------------

describe("pickNextFeature", () => {
  it("returns empty_backlog for empty backlog", () => {
    const result = pickNextFeature(makeEmptyBacklog());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe("empty_backlog");
  });

  it("returns all_done when all features are done", () => {
    const backlog = makeBacklog([makeFeature("F-001", "high", [], "done")]);
    const result = pickNextFeature(backlog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe("all_done");
  });

  it("returns no_open_features when features are in_progress or blocked", () => {
    const backlog = makeBacklog([
      makeFeature("F-001", "high", [], "in_progress"),
      makeFeature("F-002", "medium", [], "blocked"),
    ]);
    const result = pickNextFeature(backlog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe("no_open_features");
  });

  it("picks the highest priority open feature", () => {
    const backlog = makeBacklog([
      makeFeature("F-001", "low"),
      makeFeature("F-002", "high"),
      makeFeature("F-003", "medium"),
    ]);
    const result = pickNextFeature(backlog);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.feature.id).toBe("F-002");
  });

  it("respects dependsOn: skips features with unmet dependencies", () => {
    const backlog = makeBacklog([
      makeFeature("F-001", "low"),
      makeFeature("F-002", "high", ["F-003"]), // F-003 not done
      makeFeature("F-003", "medium"),
    ]);
    const result = pickNextFeature(backlog);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // F-002 is high but blocked; next is F-003 (medium)
      expect(["F-001", "F-003"]).toContain(result.result.feature.id);
    }
  });

  it("picks feature once all its dependencies are done", () => {
    const backlog = makeBacklog([
      makeFeature("F-001", "high", [], "done"),
      makeFeature("F-002", "high", ["F-001"]),
    ]);
    const result = pickNextFeature(backlog);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.feature.id).toBe("F-002");
  });

  it("returns blocked_by_dependencies when all open features have unmet deps", () => {
    const backlog = makeBacklog([
      makeFeature("F-001", "high", ["F-002"]), // F-002 not done
      makeFeature("F-002", "medium", ["F-001"]), // F-001 not done
    ]);
    const result = pickNextFeature(backlog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe("blocked_by_dependencies");
  });

  it("returns correct index for the picked feature", () => {
    const backlog = makeBacklog([
      makeFeature("F-001", "low"),
      makeFeature("F-002", "high"),
    ]);
    const result = pickNextFeature(backlog);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.feature.id).toBe("F-002");
      expect(result.result.index).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// markFeatureStatus
// ---------------------------------------------------------------------------

describe("markFeatureStatus", () => {
  it("updates status of the target feature", () => {
    const backlog = makeBacklog([makeFeature("F-001"), makeFeature("F-002")]);
    const updated = markFeatureStatus(backlog, "F-001", "done");
    expect(updated.features[0].status).toBe("done");
    expect(updated.features[1].status).toBe("open"); // unchanged
  });

  it("does not mutate original backlog", () => {
    const backlog = makeBacklog([makeFeature("F-001")]);
    markFeatureStatus(backlog, "F-001", "done");
    expect(backlog.features[0].status).toBe("open");
  });

  it("is a no-op for unknown ID", () => {
    const backlog = makeBacklog([makeFeature("F-001")]);
    const updated = markFeatureStatus(backlog, "F-999", "done");
    expect(updated.features[0].status).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// setFeatureBranch
// ---------------------------------------------------------------------------

describe("setFeatureBranch", () => {
  it("sets the specKitBranch field", () => {
    const backlog = makeBacklog([makeFeature("F-001")]);
    const updated = setFeatureBranch(backlog, "F-001", "feature/f-001");
    expect(updated.features[0].specKitBranch).toBe("feature/f-001");
  });
});

// ---------------------------------------------------------------------------
// getFeatureById / getFeatureByTitle
// ---------------------------------------------------------------------------

describe("getFeatureById", () => {
  it("returns the feature for a known ID", () => {
    const backlog = makeBacklog([makeFeature("F-001"), makeFeature("F-002")]);
    expect(getFeatureById(backlog, "F-001")?.id).toBe("F-001");
  });

  it("returns undefined for unknown ID", () => {
    const backlog = makeBacklog([makeFeature("F-001")]);
    expect(getFeatureById(backlog, "F-999")).toBeUndefined();
  });
});

describe("getFeatureByTitle", () => {
  it("returns feature for substring match", () => {
    const backlog = makeBacklog([{ ...makeFeature("F-001"), title: "Task CRUD Operations" }]);
    expect(getFeatureByTitle(backlog, "CRUD")?.id).toBe("F-001");
  });

  it("is case-insensitive", () => {
    const backlog = makeBacklog([{ ...makeFeature("F-001"), title: "Task CRUD" }]);
    expect(getFeatureByTitle(backlog, "task crud")?.id).toBe("F-001");
  });

  it("returns undefined when no match", () => {
    const backlog = makeBacklog([makeFeature("F-001")]);
    expect(getFeatureByTitle(backlog, "nonexistent")).toBeUndefined();
  });
});
