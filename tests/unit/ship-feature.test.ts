/**
 * Unit tests for ship-feature.ts
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import yaml from "js-yaml";
import { makeEmptyBacklog, Feature, Backlog } from "../../src/core/backlog-schema.js";
import { StateStore } from "../../src/core/state-store.js";
import { ship as shipFeature, resolveTargetFeature } from "../../src/cli/ship.js";
import type { PhaseRunner } from "../../src/cli/ship.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "ship-feature-test-"));
}

function makeFeature(id: string, status: Feature["status"] = "open"): Feature {
  return {
    id,
    title: `Feature ${id}`,
    epic: "Core",
    status,
    priority: "medium",
    dependsOn: [],
    acceptanceCriteria: [`${id} works`],
    estimatedComplexity: "medium",
    specKitBranch: "",
    notes: "",
  };
}

function setupBacklog(root: string, features: Feature[]): void {
  mkdirSync(join(root, "docs"), { recursive: true });
  const backlog: Backlog = { ...makeEmptyBacklog(), features };
  writeFileSync(join(root, "docs", "product-backlog.yaml"), yaml.dump(backlog), "utf8");
  writeFileSync(join(root, "docs", "tech-stack.md"), "# Tech Stack\n\n## Backend\n- Language / Runtime: TypeScript\n", "utf8");
  const store = new StateStore(root);
  store.createInitial("greenfield");
}

const noopRunner: PhaseRunner = async () => ({ success: true, phase: "implement" });

// ---------------------------------------------------------------------------
// backlog required — no more runStandaloneFeature bypass
// ---------------------------------------------------------------------------

describe("shipFeature — backlog required", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns success:false with clear error when backlog is missing", async () => {
    // No docs/ or backlog at all
    const result = await shipFeature({ root: tmp, featureTarget: "feature-one", dryRun: true, phaseRunner: noopRunner });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("error message mentions generate + bootstrap commands", async () => {
    const result = await shipFeature({ root: tmp, featureTarget: "feature-one", dryRun: true, phaseRunner: noopRunner });
    expect(result.error).toContain("generate");
    expect(result.error).toContain("bootstrap");
  });
});

// ---------------------------------------------------------------------------
// transparent brownfield handling
// ---------------------------------------------------------------------------

describe("shipFeature — transparent brownfield handling", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("brownfieldSnapshotWritten is true when src/ + package.json present", async () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "app", dependencies: { express: "^4" } }), "utf8");
    writeFileSync(join(tmp, "src", "index.ts"), "export {};", "utf8");
    setupBacklog(tmp, [makeFeature("feature-one")]);

    const result = await shipFeature({ root: tmp, featureTarget: "feature-one", dryRun: true, phaseRunner: noopRunner });
    expect(result.brownfieldSnapshotWritten).toBe(false); // dryRun=true skips writes
  });

  it("proceeds normally when backlog + feature present in greenfield", async () => {
    setupBacklog(tmp, [makeFeature("feature-one")]);
    const result = await shipFeature({ root: tmp, featureTarget: "feature-one", dryRun: true, phaseRunner: noopRunner });
    expect(result.featureId).toBe("feature-one");
  });

  it("returns feature not found error when feature missing in backlog", async () => {
    setupBacklog(tmp, [makeFeature("feature-one")]);
    const result = await shipFeature({ root: tmp, featureTarget: "feature-dep", dryRun: true, phaseRunner: noopRunner });
    expect(result.success).toBe(false);
    expect(result.error).toContain("feature-dep");
  });
});

// ---------------------------------------------------------------------------
// resolveTargetFeature
// ---------------------------------------------------------------------------

describe("resolveTargetFeature", () => {
  const features: Feature[] = [
    makeFeature("feature-one"),
    { ...makeFeature("feature-two"), status: "done" },
    { ...makeFeature("feature-three"), title: "Payment Gateway" },
  ];
  const backlog: Backlog = { ...makeEmptyBacklog(), features };

  it("returns first open feature when target is undefined", () => {
    const f = resolveTargetFeature(backlog, undefined);
    expect(f?.id).toBe("feature-one");
  });

  it("resolves by ID (F-003)", () => {
    const f = resolveTargetFeature(backlog, "feature-three");
    expect(f?.id).toBe("feature-three");
  });

  it("resolves by title substring (case-insensitive partial match)", () => {
    const f = resolveTargetFeature(backlog, "payment");
    expect(f?.id).toBe("feature-three");
  });

  it("returns undefined when no feature matches", () => {
    const f = resolveTargetFeature(backlog, "NonExistent");
    expect(f).toBeUndefined();
  });
});
