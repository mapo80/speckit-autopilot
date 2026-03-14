import {
  topologicalSort,
  groupByEpic,
  generateRoadmap,
  renderRoadmapMarkdown,
  RoadmapDocument,
} from "../../src/core/roadmap-generator.js";
import { Feature, Backlog, makeEmptyBacklog } from "../../src/core/backlog-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFeature(id: string, priority: Feature["priority"] = "medium", dependsOn: string[] = [], epic = "Core"): Feature {
  return {
    id,
    title: `Feature ${id}`,
    epic,
    status: "open",
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
// topologicalSort
// ---------------------------------------------------------------------------

describe("topologicalSort", () => {
  it("returns empty array for empty input", () => {
    expect(topologicalSort([])).toEqual([]);
  });

  it("preserves single feature", () => {
    const f = makeFeature("F-001");
    const sorted = topologicalSort([f]);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].id).toBe("F-001");
  });

  it("places dependency before dependent", () => {
    const f1 = makeFeature("F-001");
    const f2 = makeFeature("F-002", "medium", ["F-001"]);
    const sorted = topologicalSort([f2, f1]);
    const ids = sorted.map((f) => f.id);
    expect(ids.indexOf("F-001")).toBeLessThan(ids.indexOf("F-002"));
  });

  it("respects priority order for independent features", () => {
    const high = makeFeature("F-001", "high");
    const low = makeFeature("F-002", "low");
    const medium = makeFeature("F-003", "medium");
    const sorted = topologicalSort([low, medium, high]);
    expect(sorted[0].id).toBe("F-001"); // high first
    expect(sorted[1].id).toBe("F-003"); // then medium
    expect(sorted[2].id).toBe("F-002"); // then low
  });

  it("handles chain of dependencies", () => {
    const f1 = makeFeature("F-001");
    const f2 = makeFeature("F-002", "medium", ["F-001"]);
    const f3 = makeFeature("F-003", "medium", ["F-002"]);
    const sorted = topologicalSort([f3, f1, f2]);
    const ids = sorted.map((f) => f.id);
    expect(ids).toEqual(["F-001", "F-002", "F-003"]);
  });

  it("handles features with multiple dependencies", () => {
    const f1 = makeFeature("F-001", "high");
    const f2 = makeFeature("F-002", "high");
    const f3 = makeFeature("F-003", "medium", ["F-001", "F-002"]);
    const sorted = topologicalSort([f3, f2, f1]);
    const ids = sorted.map((f) => f.id);
    expect(ids.indexOf("F-001")).toBeLessThan(ids.indexOf("F-003"));
    expect(ids.indexOf("F-002")).toBeLessThan(ids.indexOf("F-003"));
  });

  it("skips circular dependencies (returns partial result)", () => {
    const f1 = makeFeature("F-001", "medium", ["F-002"]);
    const f2 = makeFeature("F-002", "medium", ["F-001"]);
    const sorted = topologicalSort([f1, f2]);
    // Circular nodes should be excluded
    expect(sorted).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// groupByEpic
// ---------------------------------------------------------------------------

describe("groupByEpic", () => {
  it("groups features by epic name", () => {
    const features = [
      makeFeature("F-001", "high", [], "Auth"),
      makeFeature("F-002", "medium", [], "Dashboard"),
      makeFeature("F-003", "low", [], "Auth"),
    ];
    const groups = groupByEpic(features);
    const authGroup = groups.find((g) => g.name === "Auth");
    expect(authGroup?.features).toHaveLength(2);
    const dashGroup = groups.find((g) => g.name === "Dashboard");
    expect(dashGroup?.features).toHaveLength(1);
  });

  it("preserves feature order within epic", () => {
    const features = [makeFeature("F-001", "high", [], "Core"), makeFeature("F-002", "low", [], "Core")];
    const groups = groupByEpic(features);
    expect(groups[0].features[0].id).toBe("F-001");
    expect(groups[0].features[1].id).toBe("F-002");
  });
});

// ---------------------------------------------------------------------------
// generateRoadmap
// ---------------------------------------------------------------------------

describe("generateRoadmap", () => {
  it("generates roadmap from backlog", () => {
    const backlog = makeBacklog([makeFeature("F-001", "high"), makeFeature("F-002", "medium", ["F-001"])]);
    const roadmap = generateRoadmap(backlog);
    expect(roadmap.orderedFeatures).toHaveLength(2);
    expect(roadmap.orderedFeatures[0].id).toBe("F-001");
  });

  it("includes a note for circular dependencies", () => {
    const f1 = makeFeature("F-001", "medium", ["F-002"]);
    const f2 = makeFeature("F-002", "medium", ["F-001"]);
    const backlog = makeBacklog([f1, f2]);
    const roadmap = generateRoadmap(backlog);
    expect(roadmap.notes.some((n) => n.includes("circular"))).toBe(true);
  });

  it("returns empty ordered features for empty backlog", () => {
    const roadmap = generateRoadmap(makeEmptyBacklog());
    expect(roadmap.orderedFeatures).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// renderRoadmapMarkdown
// ---------------------------------------------------------------------------

describe("renderRoadmapMarkdown", () => {
  it("renders valid markdown containing key sections", () => {
    const doc: RoadmapDocument = {
      generatedAt: "2024-01-01T00:00:00.000Z",
      epics: [{ name: "Core", features: [makeFeature("F-001")] }],
      orderedFeatures: [makeFeature("F-001")],
      notes: ["A note"],
    };
    const md = renderRoadmapMarkdown(doc);
    expect(md).toContain("# Product Roadmap");
    expect(md).toContain("## Epics");
    expect(md).toContain("## Feature Implementation Order");
    expect(md).toContain("F-001");
    expect(md).toContain("## Notes");
    expect(md).toContain("A note");
  });

  it("omits Notes section when empty", () => {
    const doc: RoadmapDocument = {
      generatedAt: "2024-01-01T00:00:00.000Z",
      epics: [],
      orderedFeatures: [],
      notes: [],
    };
    const md = renderRoadmapMarkdown(doc);
    expect(md).not.toContain("## Notes");
  });
});
