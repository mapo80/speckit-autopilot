import {
  parseBacklog,
  validateBacklog,
  makeEmptyBacklog,
  featureSlug,
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
          id: "task-crud",
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
    expect(backlog.features[0].id).toBe("task-crud");
  });

  it("throws on invalid version", () => {
    const raw = { version: "2", generatedAt: "2024-01-01T00:00:00.000Z", features: [] };
    expect(() => parseBacklog(raw)).toThrow();
  });

  it("throws on invalid feature ID format", () => {
    const raw = {
      version: "1",
      generatedAt: "2024-01-01T00:00:00.000Z",
      // Uppercase is invalid in slug format
      features: [{ id: "F-001", title: "x", epic: "e", status: "open", priority: "high", dependsOn: [], acceptanceCriteria: [], estimatedComplexity: "medium", specKitBranch: "", notes: "" }],
    };
    expect(() => parseBacklog(raw)).toThrow();
  });

  it("applies defaults for optional fields", () => {
    const raw = {
      version: "1",
      generatedAt: "2024-01-01T00:00:00.000Z",
      features: [{ id: "task-crud", title: "T", epic: "E" }],
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
// featureSlug
// ---------------------------------------------------------------------------

describe("featureSlug", () => {
  it("strips 'Feature N - EpicName:' prefix", () => {
    expect(featureSlug("Feature 1 - Auth: JWT authentication", [])).toBe("jwt-authentication");
  });

  it("strips 'Feature N -' prefix when no epic name", () => {
    expect(featureSlug("Feature 45 - Sign-only room workflow", [])).toBe("sign-only-room-workflow");
  });

  it("strips EpicName: prefix without Feature N prefix", () => {
    expect(featureSlug("Auth: Login and registration", [])).toBe("login-and-registration");
  });

  it("converts to kebab-case", () => {
    const slug = featureSlug("User Profile Management", []);
    expect(slug).toMatch(/^[a-z][a-z0-9-]{2,63}$/);
    expect(slug).toBe("user-profile-management");
  });

  it("removes special characters", () => {
    const slug = featureSlug("JWT auth (login, refresh token, logout)", []);
    expect(slug).toMatch(/^[a-z][a-z0-9-]+$/);
  });

  it("truncates at 40 chars on a word boundary", () => {
    const title = "Feature 1 - Core: A very long feature title that exceeds forty characters easily";
    const slug = featureSlug(title, []);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).not.toMatch(/-$/); // no trailing dash
  });

  it("adds numeric suffix on collision", () => {
    const existing = ["jwt-authentication"];
    const slug = featureSlug("Feature 45 - Auth: JWT authentication", existing);
    expect(slug).toBe("jwt-authentication-2");
  });

  it("increments suffix until unique", () => {
    const existing = ["jwt-authentication", "jwt-authentication-2"];
    const slug = featureSlug("Feature 45 - Auth: JWT authentication", existing);
    expect(slug).toBe("jwt-authentication-3");
  });

  it("produces a valid kebab-case slug for any title", () => {
    const titles = [
      "Feature 1 - RoomWorkflow: Sign-only room workflow",
      "Feature 20 - SigningWorkflow: Multi-signer sequential",
      "Simple Feature",
    ];
    for (const title of titles) {
      const slug = featureSlug(title, []);
      expect(slug).toMatch(/^[a-z][a-z0-9-]{2,63}$/);
    }
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
    const features = [makeFeature("feature-three", "low"), makeFeature("feature-one", "high"), makeFeature("feature-two", "medium")];
    const sorted = sortFeaturesByPriority(features);
    expect(sorted[0].id).toBe("feature-one");
    expect(sorted[1].id).toBe("feature-two");
    expect(sorted[2].id).toBe("feature-three");
  });

  it("does not mutate the original array", () => {
    const features = [makeFeature("feature-two", "low"), makeFeature("feature-one", "high")];
    const sorted = sortFeaturesByPriority(features);
    expect(features[0].id).toBe("feature-two"); // original unchanged
    expect(sorted[0].id).toBe("feature-one");
  });
});
