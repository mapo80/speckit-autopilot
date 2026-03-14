import {
  parseBacklog,
  validateBacklog,
  makeEmptyBacklog,
  featureNextId,
  priorityWeight,
  sortFeaturesByPriority,
  BacklogSchema,
  FeatureSchema,
  Feature,
  Backlog,
} from "../../src/core/backlog-schema.js";

// ---------------------------------------------------------------------------
// parseBacklog
// ---------------------------------------------------------------------------

describe("parseBacklog", () => {
  it("parses a valid backlog", () => {
    const raw = {
      version: "1",
      generatedAt: "2024-01-01T00:00:00.000Z",
      features: [
        {
          id: "F-001",
          title: "Task CRUD",
          epic: "Core",
          status: "open",
          priority: "high",
          dependsOn: [],
          acceptanceCriteria: ["User can create a task"],
          estimatedComplexity: "medium",
          specKitBranch: "",
          notes: "",
        },
      ],
    };
    const backlog = parseBacklog(raw);
    expect(backlog.version).toBe("1");
    expect(backlog.features).toHaveLength(1);
    expect(backlog.features[0].id).toBe("F-001");
  });

  it("throws on invalid version", () => {
    const raw = { version: "2", generatedAt: "2024-01-01T00:00:00.000Z", features: [] };
    expect(() => parseBacklog(raw)).toThrow();
  });

  it("throws on invalid feature ID format", () => {
    const raw = {
      version: "1",
      generatedAt: "2024-01-01T00:00:00.000Z",
      features: [{ id: "invalid", title: "x", epic: "e", status: "open", priority: "high", dependsOn: [], acceptanceCriteria: [], estimatedComplexity: "medium", specKitBranch: "", notes: "" }],
    };
    expect(() => parseBacklog(raw)).toThrow();
  });

  it("applies defaults for optional fields", () => {
    const raw = {
      version: "1",
      generatedAt: "2024-01-01T00:00:00.000Z",
      features: [{ id: "F-001", title: "T", epic: "E" }],
    };
    const backlog = parseBacklog(raw);
    expect(backlog.features[0].status).toBe("open");
    expect(backlog.features[0].priority).toBe("medium");
    expect(backlog.features[0].dependsOn).toEqual([]);
    expect(backlog.features[0].acceptanceCriteria).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateBacklog
// ---------------------------------------------------------------------------

describe("validateBacklog", () => {
  it("returns success:true for valid data", () => {
    const raw = { version: "1", generatedAt: "2024-01-01T00:00:00.000Z", features: [] };
    const result = validateBacklog(raw);
    expect(result.success).toBe(true);
  });

  it("returns success:false for invalid data", () => {
    const result = validateBacklog({ version: "bad" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// makeEmptyBacklog
// ---------------------------------------------------------------------------

describe("makeEmptyBacklog", () => {
  it("produces a valid empty backlog", () => {
    const backlog = makeEmptyBacklog();
    expect(backlog.version).toBe("1");
    expect(backlog.features).toEqual([]);
    expect(() => parseBacklog(backlog)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// featureNextId
// ---------------------------------------------------------------------------

describe("featureNextId", () => {
  it("returns F-001 for empty backlog", () => {
    const backlog = makeEmptyBacklog();
    expect(featureNextId(backlog)).toBe("F-001");
  });

  it("returns next ID in sequence", () => {
    const backlog: Backlog = {
      version: "1",
      generatedAt: "2024-01-01T00:00:00.000Z",
      features: [
        { id: "F-001", title: "A", epic: "E", status: "open", priority: "high", dependsOn: [], acceptanceCriteria: [], estimatedComplexity: "medium", specKitBranch: "", notes: "" },
        { id: "F-003", title: "B", epic: "E", status: "open", priority: "high", dependsOn: [], acceptanceCriteria: [], estimatedComplexity: "medium", specKitBranch: "", notes: "" },
      ],
    };
    expect(featureNextId(backlog)).toBe("F-004");
  });

  it("pads to 3 digits", () => {
    const backlog: Backlog = {
      version: "1",
      generatedAt: "2024-01-01T00:00:00.000Z",
      features: [
        { id: "F-009", title: "X", epic: "E", status: "open", priority: "low", dependsOn: [], acceptanceCriteria: [], estimatedComplexity: "low", specKitBranch: "", notes: "" },
      ],
    };
    expect(featureNextId(backlog)).toBe("F-010");
  });
});

// ---------------------------------------------------------------------------
// priorityWeight
// ---------------------------------------------------------------------------

describe("priorityWeight", () => {
  it("returns 3 for high", () => expect(priorityWeight("high")).toBe(3));
  it("returns 2 for medium", () => expect(priorityWeight("medium")).toBe(2));
  it("returns 1 for low", () => expect(priorityWeight("low")).toBe(1));
});

// ---------------------------------------------------------------------------
// sortFeaturesByPriority
// ---------------------------------------------------------------------------

describe("sortFeaturesByPriority", () => {
  const makeFeature = (id: string, priority: Feature["priority"]): Feature => ({
    id,
    title: id,
    epic: "E",
    status: "open",
    priority,
    dependsOn: [],
    acceptanceCriteria: [],
    estimatedComplexity: "medium",
    specKitBranch: "",
    notes: "",
  });

  it("sorts high before medium before low", () => {
    const features = [makeFeature("F-003", "low"), makeFeature("F-001", "high"), makeFeature("F-002", "medium")];
    const sorted = sortFeaturesByPriority(features);
    expect(sorted[0].id).toBe("F-001");
    expect(sorted[1].id).toBe("F-002");
    expect(sorted[2].id).toBe("F-003");
  });

  it("does not mutate the original array", () => {
    const features = [makeFeature("F-002", "low"), makeFeature("F-001", "high")];
    const sorted = sortFeaturesByPriority(features);
    expect(features[0].id).toBe("F-002"); // original unchanged
    expect(sorted[0].id).toBe("F-001");
  });
});
