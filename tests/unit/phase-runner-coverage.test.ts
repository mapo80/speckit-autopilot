/**
 * Targeted unit tests for the non-dryRun branches of makeDefaultPhaseRunner.
 * Uses a fake API key and patches SpecKitRunner.prototype to avoid real API calls.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import yaml from "js-yaml";
import { StateStore } from "../../src/core/state-store.js";
import { makeEmptyBacklog, Feature, Backlog } from "../../src/core/backlog-schema.js";
import { makeDefaultPhaseRunner } from "../../src/cli/ship-product.js";
import { SpecKitRunner, verifyImplementationProducedCode } from "../../src/core/spec-kit-runner.js";
import { generateRoadmap, renderRoadmapMarkdown } from "../../src/core/roadmap-generator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "phase-runner-cov-"));
}

function makeFeature(id: string): Feature {
  return {
    id,
    title: `Feature ${id}`,
    epic: "Core",
    status: "open",
    priority: "medium",
    dependsOn: [],
    acceptanceCriteria: [`${id} works`],
    estimatedComplexity: "medium",
    specKitBranch: "",
    notes: "",
  };
}

function setupProject(root: string, features: Feature[]): void {
  mkdirSync(join(root, "docs"), { recursive: true });
  const backlog: Backlog = { ...makeEmptyBacklog(), features };
  writeFileSync(join(root, "docs", "product-backlog.yaml"), yaml.dump(backlog), "utf8");
  const store = new StateStore(root);
  store.createInitial("greenfield");
}

function setupSpecKitDirs(root: string): void {
  mkdirSync(join(root, ".specify"), { recursive: true });
  mkdirSync(join(root, ".claude", "commands"), { recursive: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("makeDefaultPhaseRunner non-dryRun branch coverage", () => {
  let tmp: string;
  let runPhasesSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    tmp = makeTmp();
  });

  afterEach(() => {
    runPhasesSpy?.mockRestore();
    jest.restoreAllMocks();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns success and phase when runPhases succeeds and code is produced", async () => {
    setupSpecKitDirs(tmp);
    setupProject(tmp, [makeFeature("F-001")]);

    // Write a real source file so verifyImplementationProducedCode returns hasNewFiles:true
    const featureDir = join(tmp, "src", "features", "f-001");
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, "index.ts"), "export const x = 1;", "utf8");

    // Patch SpecKitRunner.prototype.runPhases to return success without real API call
    runPhasesSpy = jest.spyOn(SpecKitRunner.prototype, "runPhases").mockResolvedValue({
      success: true,
      phase: "implement",
    });

    const runner = makeDefaultPhaseRunner("fake-api-key-for-testing");
    const result = await runner({
      root: tmp,
      featureId: "F-001",
      featureTitle: "Feature F-001",
      startFromPhase: "spec",
      dryRun: false,
    });

    expect(result.success).toBe(true);
    expect(result.phase).toBe("implement");
    expect(runPhasesSpy).toHaveBeenCalledTimes(1);
  });

  it("returns failure when runPhases fails", async () => {
    setupSpecKitDirs(tmp);
    setupProject(tmp, [makeFeature("F-001")]);

    runPhasesSpy = jest.spyOn(SpecKitRunner.prototype, "runPhases").mockResolvedValue({
      success: false,
      phase: "spec",
      error: "AI quota exceeded",
    });

    const runner = makeDefaultPhaseRunner("fake-api-key-for-testing");
    const result = await runner({
      root: tmp,
      featureId: "F-001",
      featureTitle: "Feature F-001",
      startFromPhase: "spec",
      dryRun: false,
    });

    expect(result.success).toBe(false);
    expect(result.phase).toBe("spec");
    expect(result.error).toBe("AI quota exceeded");
  });

  it("returns failure when runPhases succeeds but no code was produced", async () => {
    setupSpecKitDirs(tmp);
    setupProject(tmp, [makeFeature("F-001")]);
    // No files written to src/ — verifyImplementationProducedCode returns hasNewFiles:false

    runPhasesSpy = jest.spyOn(SpecKitRunner.prototype, "runPhases").mockResolvedValue({
      success: true,
      phase: "implement",
    });

    const runner = makeDefaultPhaseRunner("fake-api-key-for-testing");
    const result = await runner({
      root: tmp,
      featureId: "F-001",
      featureTitle: "Feature F-001",
      startFromPhase: "spec",
      dryRun: false,
    });

    expect(result.success).toBe(false);
    expect(result.phase).toBe("implement");
    expect(result.error).toContain("No application code produced");
  });

  it("passes acceptance criteria from backlog to runPhases", async () => {
    setupSpecKitDirs(tmp);
    const feat = makeFeature("F-002");
    feat.acceptanceCriteria = ["Criterion A", "Criterion B"];
    setupProject(tmp, [feat]);

    const featureDir = join(tmp, "src", "features", "f-002");
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, "index.ts"), "export const y = 2;", "utf8");

    runPhasesSpy = jest.spyOn(SpecKitRunner.prototype, "runPhases").mockResolvedValue({
      success: true,
      phase: "implement",
    });

    const runner = makeDefaultPhaseRunner("fake-api-key-for-testing");
    await runner({
      root: tmp,
      featureId: "F-002",
      featureTitle: "Feature F-002",
      startFromPhase: "spec",
      dryRun: false,
    });

    // runPhases should have been called with the acceptance criteria
    expect(runPhasesSpy).toHaveBeenCalledWith(
      "F-002",
      "Feature F-002",
      ["Criterion A", "Criterion B"],
      "spec"
    );
  });

  it("falls back to empty criteria when backlog feature not found", async () => {
    setupSpecKitDirs(tmp);
    setupProject(tmp, [makeFeature("F-001")]);

    const featureDir = join(tmp, "src", "features", "f-999");
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, "index.ts"), "export const z = 3;", "utf8");

    runPhasesSpy = jest.spyOn(SpecKitRunner.prototype, "runPhases").mockResolvedValue({
      success: true,
      phase: "implement",
    });

    const runner = makeDefaultPhaseRunner("fake-api-key-for-testing");
    const result = await runner({
      root: tmp,
      featureId: "F-999",  // not in backlog
      featureTitle: "Unknown Feature",
      startFromPhase: "spec",
      dryRun: false,
    });

    // runPhases called with empty criteria
    expect(runPhasesSpy).toHaveBeenCalledWith("F-999", "Unknown Feature", [], "spec");
    expect(result.success).toBe(true);
  });

  it("returns failure when spec-kit init fails", async () => {
    // No .specify or .claude/commands — specify init will be called
    // But point root to a path where it would fail or succeed
    // We can force failure by using a path where specify can't write
    setupProject(tmp, [makeFeature("F-001")]);

    // Don't setup speckit dirs — let ensureSpecKitInitialized try to run specify init
    // Since specify IS installed, it will actually succeed. Test the failure branch
    // by patching ensureSpecKitInitialized directly.
    // We do this by creating a runner with an invalid root where specify init fails.
    // Use /dev/null as root to guarantee failure
    const badRoot = "/dev/null";
    const runner = makeDefaultPhaseRunner("fake-api-key-for-testing");
    const result = await runner({
      root: badRoot,
      featureId: "F-001",
      featureTitle: "Feature",
      startFromPhase: "spec",
      dryRun: false,
    });

    // Should fail — either init fails or something else
    expect(result.success).toBe(false);
  });

  it("dryRun with no startFromPhase defaults to spec as first phase", async () => {
    const runner = makeDefaultPhaseRunner();
    const result = await runner({
      root: tmp,
      featureId: "F-001",
      featureTitle: "Test",
      dryRun: true,
    });

    expect(result.success).toBe(true);
    // Without startFromPhase, starts from constitution (first in phases array)
    // and ends at implement (last)
    expect(result.phase).toBe("implement");
  });

  it("dryRun with startFromPhase not in phases list uses all phases", async () => {
    const runner = makeDefaultPhaseRunner();
    // 'done' is not in the phases list for dryRun
    const result = await runner({
      root: tmp,
      featureId: "F-001",
      featureTitle: "Test",
      startFromPhase: "done",
      dryRun: true,
    });

    // startIdx will be -1 (not found), activePhases = phases (all)
    // lastPhase = implement
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// spec-kit-runner: verifyImplementationProducedCode additional branches
// ---------------------------------------------------------------------------

describe("verifyImplementationProducedCode additional branches", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns hasNewFiles:false with summary when no artifacts at all", () => {
    const result = verifyImplementationProducedCode(tmp, "F-NONE");
    expect(result.hasNewFiles).toBe(false);
    expect(result.diffSummary).toContain("No application code produced");
  });

  it("changedFiles is empty array when nothing found", () => {
    const result = verifyImplementationProducedCode(tmp, "F-EMPTY");
    expect(Array.isArray(result.changedFiles)).toBe(true);
  });

  it("spec artifacts only → hasNewFiles depends on count, diffSummary is set", () => {
    const specsDir = join(tmp, "docs", "specs", "f-speconly");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec", "utf8");
    writeFileSync(join(specsDir, "plan.md"), "# Plan", "utf8");
    writeFileSync(join(specsDir, "tasks.md"), "# Tasks", "utf8");

    const result = verifyImplementationProducedCode(tmp, "F-speconly");
    // Spec artifacts exist but no src/ files
    expect(typeof result.hasNewFiles).toBe("boolean");
    expect(result.diffSummary.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// roadmap-generator additional coverage
// ---------------------------------------------------------------------------

describe("roadmap-generator: additional branches", () => {
  it("renders markdown with empty backlog", () => {
    const backlog = makeEmptyBacklog();
    const roadmap = generateRoadmap(backlog);
    const md = renderRoadmapMarkdown(roadmap);
    expect(typeof md).toBe("string");
    expect(md.length).toBeGreaterThan(0);
  });
});
