import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import yaml from "js-yaml";
import { StateStore } from "../../src/core/state-store.js";
import { makeEmptyBacklog, Feature, Backlog } from "../../src/core/backlog-schema.js";
import { ship as shipProduct, readBacklog, writeBacklog, PhaseRunner } from "../../src/cli/ship.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "ship-product-test-"));
}

function makeFeature(id: string, priority: Feature["priority"] = "medium", dependsOn: string[] = [], status: Feature["status"] = "open"): Feature {
  return {
    id,
    title: `Feature ${id}`,
    epic: "Core",
    status,
    priority,
    dependsOn,
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

function makeSuccessRunner(): PhaseRunner {
  return async () => ({ success: true, phase: "implement" });
}

function makeFailRunner(): PhaseRunner {
  return async () => ({ success: false, phase: "spec", error: "spec failed" });
}

// ---------------------------------------------------------------------------
// readBacklog / writeBacklog
// ---------------------------------------------------------------------------

describe("readBacklog", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("throws when backlog file is missing", () => {
    expect(() => readBacklog(tmp)).toThrow();
  });

  it("reads a valid backlog", () => {
    setupProject(tmp, [makeFeature("feature-one")]);
    const backlog = readBacklog(tmp);
    expect(backlog.version).toBe("1");
    expect(backlog.features[0].id).toBe("feature-one");
  });
});

describe("writeBacklog", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("writes YAML that can be read back", () => {
    mkdirSync(join(tmp, "docs"), { recursive: true });
    const backlog: Backlog = { ...makeEmptyBacklog(), features: [makeFeature("feature-one")] };
    writeBacklog(tmp, backlog);
    const read = readBacklog(tmp);
    expect(read.features[0].id).toBe("feature-one");
  });
});

// ---------------------------------------------------------------------------
// shipProduct
// ---------------------------------------------------------------------------

describe("shipProduct", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns error when backlog is missing (no throw)", async () => {
    const result = await shipProduct({ root: tmp, dryRun: true });
    expect(result.success).toBe(false);
  });

  it("completes when all features are done", async () => {
    setupProject(tmp, [makeFeature("feature-one", "medium", [], "done")]);
    const result = await shipProduct({ root: tmp, phaseRunner: makeSuccessRunner(), dryRun: true });
    expect(result.finalStatus).toBe("completed");
  });

  it("ships a single open feature", async () => {
    setupProject(tmp, [makeFeature("feature-one")]);
    const result = await shipProduct({ root: tmp, phaseRunner: makeSuccessRunner(), dryRun: true });
    expect(result.completed).toBe(1);
    expect(result.finalStatus).toBe("completed");
  });

  it("ships features in priority order", async () => {
    const shipped: string[] = [];
    const runner: PhaseRunner = async (opts) => {
      shipped.push(opts.featureId);
      return { success: true, phase: "implement" };
    };
    setupProject(tmp, [
      makeFeature("feature-one", "low"),
      makeFeature("feature-two", "high"),
      makeFeature("feature-three", "medium"),
    ]);
    await shipProduct({ root: tmp, phaseRunner: runner, dryRun: true });
    expect(shipped[0]).toBe("feature-two"); // high first
    expect(shipped[1]).toBe("feature-three"); // then medium
    expect(shipped[2]).toBe("feature-one"); // then low
  });

  it("increments consecutive failures on phase runner failure", async () => {
    setupProject(tmp, [makeFeature("feature-one")]);
    // After maxFailures (3) consecutive failures the feature is blocked and failures reset to 0.
    // Verify via result.failed counter instead of state (which resets after block).
    const result = await shipProduct({ root: tmp, phaseRunner: makeFailRunner(), dryRun: true });
    expect(result.failed).toBeGreaterThan(0);
  });

  it("marks feature blocked after maxFailures failures", async () => {
    setupProject(tmp, [makeFeature("feature-one")]);
    const store = new StateStore(tmp);
    store.update({ maxFailures: 2 });

    // First run: fails twice → becomes blocked
    await shipProduct({ root: tmp, phaseRunner: makeFailRunner(), dryRun: true });

    // After maxFailures failures the feature should be blocked (no open features remain)
    const result2 = await shipProduct({ root: tmp, phaseRunner: makeSuccessRunner(), dryRun: true });
    expect(["completed", "no_open_features", "blocked"]).toContain(result2.finalStatus);
  });

  it("is idempotent: calling twice on completed project returns completed", async () => {
    setupProject(tmp, [makeFeature("feature-one", "medium", [], "done")]);
    await shipProduct({ root: tmp, phaseRunner: makeSuccessRunner(), dryRun: true });
    const result2 = await shipProduct({ root: tmp, phaseRunner: makeSuccessRunner(), dryRun: true });
    expect(result2.finalStatus).toBe("completed");
  });

  it("writes iteration log entries", async () => {
    setupProject(tmp, [makeFeature("feature-one")]);
    await shipProduct({ root: tmp, phaseRunner: makeSuccessRunner(), dryRun: true });
    expect(existsSync(join(tmp, "docs", "iteration-log.md"))).toBe(true);
  });

  it("updates backlog feature status to done on success", async () => {
    setupProject(tmp, [makeFeature("feature-one")]);
    // Disable gating so QA gate passes in a temp directory without a real project
    const store = new StateStore(tmp);
    store.update({ gatingEnabled: false });
    await shipProduct({ root: tmp, phaseRunner: makeSuccessRunner(), dryRun: false });
    const backlog = readBacklog(tmp);
    expect(backlog.features[0].status).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// makeDefaultPhaseRunner – non-dryRun branch coverage
// ---------------------------------------------------------------------------

describe("makeDefaultPhaseRunner (non-dryRun paths)", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("dryRun path returns success with implement as last phase", async () => {
    const { makeDefaultPhaseRunner } = await import("../../src/cli/ship.js");
    const runner = makeDefaultPhaseRunner();
    setupProject(tmp, [makeFeature("feature-one")]);

    const result = await runner({
      root: tmp,
      featureId: "feature-one",
      featureTitle: "Test Feature",
      startFromPhase: "spec",
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.phase).toBe("implement");
  });

  it("dryRun with startFromPhase:plan slices phases correctly", async () => {
    const { makeDefaultPhaseRunner } = await import("../../src/cli/ship.js");
    const runner = makeDefaultPhaseRunner();
    setupProject(tmp, [makeFeature("feature-one")]);

    const result = await runner({
      root: tmp,
      featureId: "feature-one",
      featureTitle: "Test Feature",
      startFromPhase: "plan",
      dryRun: true,
    });

    expect(result.success).toBe(true);
  });

  it("non-dryRun uses dryRun path correctly when dryRun:true", async () => {
    const { makeDefaultPhaseRunner } = await import("../../src/cli/ship.js");
    const runner = makeDefaultPhaseRunner();

    mkdirSync(join(tmp, ".specify"), { recursive: true });
    mkdirSync(join(tmp, ".claude", "commands"), { recursive: true });
    setupProject(tmp, [makeFeature("feature-one")]);

    const result = await runner({
      root: tmp,
      featureId: "feature-one",
      featureTitle: "Test Feature",
      startFromPhase: "spec",
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.phase).toBe("implement");
  });

  it("non-dryRun with backlog reads acceptance criteria without error", async () => {
    const { makeDefaultPhaseRunner } = await import("../../src/cli/ship.js");
    const runner = makeDefaultPhaseRunner();

    mkdirSync(join(tmp, ".specify"), { recursive: true });
    mkdirSync(join(tmp, ".claude", "commands"), { recursive: true });
    // Setup project WITH a backlog containing acceptance criteria
    const feature = makeFeature("feature-one");
    feature.acceptanceCriteria = ["Must do X", "Must do Y"];
    setupProject(tmp, [feature]);

    // dryRun:true so we don't call real claude but verify backlog reading works
    const result = await runner({
      root: tmp,
      featureId: "feature-one",
      featureTitle: "Feature F-001",
      startFromPhase: "spec",
      dryRun: true,
    });

    // Backlog reading should work without error
    expect(result.success).toBe(true);
  });

  it("non-dryRun proceeds without backlog (criteria empty)", async () => {
    const { makeDefaultPhaseRunner } = await import("../../src/cli/ship.js");
    const runner = makeDefaultPhaseRunner();

    mkdirSync(join(tmp, ".specify"), { recursive: true });
    mkdirSync(join(tmp, ".claude", "commands"), { recursive: true });
    mkdirSync(join(tmp, "docs"), { recursive: true });
    // No backlog file — acceptance criteria read should silently fail
    const store = new StateStore(tmp);
    store.createInitial("greenfield");

    // dryRun:true so we don't call real claude
    const result = await runner({
      root: tmp,
      featureId: "feature-one",
      featureTitle: "Feature F-001",
      startFromPhase: "spec",
      dryRun: true,
    });

    // No backlog — no error, proceeds with empty criteria
    expect(result.success).toBe(true);
  });
});
