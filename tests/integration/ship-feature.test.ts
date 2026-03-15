import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import yaml from "js-yaml";
import { StateStore } from "../../src/core/state-store.js";
import { makeEmptyBacklog, Feature, Backlog } from "../../src/core/backlog-schema.js";
import { shipFeature, resolveTargetFeature } from "../../src/cli/ship-feature.js";
import { readBacklog } from "../../src/cli/ship-product.js";
import { formatStatus } from "../../src/cli/resume-loop.js";

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

function setupGreenfield(root: string, features: Feature[]): void {
  mkdirSync(join(root, "docs"), { recursive: true });
  const backlog: Backlog = { ...makeEmptyBacklog(), features };
  writeFileSync(join(root, "docs", "product-backlog.yaml"), yaml.dump(backlog), "utf8");
  const store = new StateStore(root);
  store.createInitial("greenfield");
  store.update({ gatingEnabled: false });
}

function setupBrownfield(root: string, features: Feature[]): void {
  setupGreenfield(root, features);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "index.ts"), "export {};", "utf8");
  const pkg = {
    name: "my-app",
    version: "1.0.0",
    dependencies: { react: "^18.0.0" },
    devDependencies: { jest: "^29.0.0" },
  };
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg), "utf8");
}

// ---------------------------------------------------------------------------
// resolveTargetFeature
// ---------------------------------------------------------------------------

describe("resolveTargetFeature", () => {
  const backlog: Backlog = {
    ...makeEmptyBacklog(),
    features: [makeFeature("F-001"), { ...makeFeature("F-002"), title: "User Authentication" }],
  };

  it("returns the first open feature when no target given", () => {
    const f = resolveTargetFeature(backlog);
    expect(f?.id).toBe("F-001");
  });

  it("resolves by feature ID", () => {
    const f = resolveTargetFeature(backlog, "F-002");
    expect(f?.id).toBe("F-002");
  });

  it("resolves by title substring", () => {
    const f = resolveTargetFeature(backlog, "Authentication");
    expect(f?.id).toBe("F-002");
  });

  it("returns undefined for unknown target", () => {
    expect(resolveTargetFeature(backlog, "F-999")).toBeUndefined();
  });

  it("returns undefined when no open features and no target", () => {
    const doneBacklog: Backlog = {
      ...makeEmptyBacklog(),
      features: [{ ...makeFeature("F-001"), status: "done" }],
    };
    expect(resolveTargetFeature(doneBacklog)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// shipFeature – greenfield
// ---------------------------------------------------------------------------

describe("shipFeature – greenfield", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns error when feature not found in backlog", async () => {
    setupGreenfield(tmp, [makeFeature("F-001")]);
    const result = await shipFeature({ root: tmp, featureTarget: "F-999", dryRun: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain("F-999");
  });

  it("ships a feature successfully (dry run)", async () => {
    setupGreenfield(tmp, [makeFeature("F-001")]);
    const result = await shipFeature({ root: tmp, dryRun: true });
    expect(result.success).toBe(true);
    expect(result.featureId).toBe("F-001");
  });

  it("ships a feature by ID target", async () => {
    setupGreenfield(tmp, [makeFeature("F-001"), makeFeature("F-002")]);
    const result = await shipFeature({ root: tmp, featureTarget: "F-002", dryRun: true });
    expect(result.featureId).toBe("F-002");
  });

  it("reports mode as greenfield for a clean directory", async () => {
    setupGreenfield(tmp, [makeFeature("F-001")]);
    const result = await shipFeature({ root: tmp, dryRun: true });
    expect(result.mode).toBe("greenfield");
  });

  it("marks feature done in backlog on success (non-dry-run)", async () => {
    setupGreenfield(tmp, [makeFeature("F-001")]);
    // Inject a success runner so the test doesn't require ANTHROPIC_API_KEY
    const successRunner = async () => ({ success: true, phase: "implement" as const });
    await shipFeature({ root: tmp, dryRun: false, phaseRunner: successRunner });
    const backlog = readBacklog(tmp);
    expect(backlog.features[0].status).toBe("done");
  });

  it("includes phases in result on success", async () => {
    setupGreenfield(tmp, [makeFeature("F-001")]);
    const result = await shipFeature({ root: tmp, dryRun: true });
    expect(result.phases.length).toBeGreaterThan(0);
  });

  it("writes iteration log on success (non-dry-run)", async () => {
    setupGreenfield(tmp, [makeFeature("F-001")]);
    // Inject a success runner so the test doesn't require ANTHROPIC_API_KEY
    const successRunner = async () => ({ success: true, phase: "implement" as const });
    await shipFeature({ root: tmp, dryRun: false, phaseRunner: successRunner });
    expect(existsSync(join(tmp, "docs", "iteration-log.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shipFeature – brownfield
// ---------------------------------------------------------------------------

describe("shipFeature – brownfield", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("detects brownfield mode", async () => {
    setupBrownfield(tmp, [makeFeature("F-001")]);
    const result = await shipFeature({ root: tmp, dryRun: true });
    expect(result.mode).toBe("brownfield");
  });

  it("writes brownfield-snapshot.md in non-dry-run mode", async () => {
    setupBrownfield(tmp, [makeFeature("F-001")]);
    const noopRunner = async () => ({ success: true, phase: "implement" as const });
    const result = await shipFeature({ root: tmp, dryRun: false, phaseRunner: noopRunner });
    expect(result.brownfieldSnapshotWritten).toBe(true);
    expect(existsSync(join(tmp, "docs", "brownfield-snapshot.md"))).toBe(true);
  });

  it("does not write snapshot in dry-run mode", async () => {
    setupBrownfield(tmp, [makeFeature("F-001")]);
    const result = await shipFeature({ root: tmp, dryRun: true });
    expect(result.brownfieldSnapshotWritten).toBe(false);
  });

  it("ships brownfield feature successfully", async () => {
    setupBrownfield(tmp, [makeFeature("F-001")]);
    const result = await shipFeature({ root: tmp, dryRun: true });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shipFeature – standalone (brownfield, no backlog)
// ---------------------------------------------------------------------------

describe("shipFeature – standalone brownfield (no backlog)", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("runs standalone feature when brownfield repo has no backlog", async () => {
    // Brownfield setup WITHOUT writing a backlog
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src", "index.ts"), "export {};", "utf8");
    const pkg = {
      name: "app",
      version: "1.0.0",
      dependencies: { express: "^4" },
      devDependencies: { jest: "^29" },
    };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg), "utf8");

    const result = await shipFeature({ root: tmp, featureTarget: "New API Feature", dryRun: true });
    expect(result.featureId).toBe("standalone");
    expect(result.featureTitle).toBe("New API Feature");
  });

  it("standalone non-dryRun writes state and log (covers lines 260-261)", async () => {
    // Brownfield without backlog, non-dryRun, inject success runner
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src", "index.ts"), "export {};", "utf8");
    const pkg = { name: "app", version: "1.0.0", dependencies: { x: "1" }, devDependencies: {} };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg), "utf8");

    const successRunner = async () => ({ success: true, phase: "implement" as const });
    const result = await shipFeature({
      root: tmp,
      featureTarget: "Standalone Feature",
      dryRun: false,
      phaseRunner: successRunner,
    });

    expect(result.success).toBe(true);
    expect(result.featureId).toBe("standalone");
    expect(existsSync(join(tmp, "docs", "iteration-log.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatStatus
// ---------------------------------------------------------------------------

describe("formatStatus", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns bootstrap message when no state exists", () => {
    const output = formatStatus(tmp);
    expect(output).toContain("bootstrap-product");
  });

  it("includes all status sections when state and backlog exist", () => {
    mkdirSync(join(tmp, "docs"), { recursive: true });
    const store = new StateStore(tmp);
    store.createInitial("greenfield");
    store.update({ activeFeature: "F-001", currentPhase: "plan", status: "running" });

    const backlog: Backlog = {
      ...makeEmptyBacklog(),
      features: [{ ...makeFeature("F-001"), status: "in_progress" }, makeFeature("F-002")],
    };
    writeFileSync(join(tmp, "docs", "product-backlog.yaml"), yaml.dump(backlog), "utf8");

    const output = formatStatus(tmp);
    expect(output).toContain("F-001");
    expect(output).toContain("plan");
    expect(output).toContain("running");
    expect(output).toContain("In progress: 1");
    expect(output).toContain("Open       : 1");
  });

  it("shows zero totals when backlog does not exist", () => {
    const store = new StateStore(tmp);
    store.createInitial();
    const output = formatStatus(tmp);
    expect(output).toContain("Total      : 0");
  });

  it("includes iteration log excerpt", () => {
    const store = new StateStore(tmp);
    store.createInitial();
    mkdirSync(join(tmp, "docs"), { recursive: true });
    writeFileSync(join(tmp, "docs", "iteration-log.md"), "## Test entry\n- some log line\n", "utf8");
    const output = formatStatus(tmp);
    expect(output).toContain("some log line");
  });

  it("shows compact count in status", () => {
    const store = new StateStore(tmp);
    store.createInitial();
    store.update({ compactCount: 3, lastCompactAt: "2024-01-01T00:00:00.000Z" });
    const output = formatStatus(tmp);
    expect(output).toContain("3");
    expect(output).toContain("2024-01-01");
  });

  it("shows unknown for null coverage and test results", () => {
    const store = new StateStore(tmp);
    store.createInitial();
    const output = formatStatus(tmp);
    expect(output).toContain("unknown");
  });

  it("shows pass when lastTestsPassed is true", () => {
    const store = new StateStore(tmp);
    store.createInitial();
    store.update({ lastTestsPassed: true, lastLintPassed: true });
    const output = formatStatus(tmp);
    expect(output).toContain("pass");
  });

  it("shows fail when lastTestsPassed is false", () => {
    const store = new StateStore(tmp);
    store.createInitial();
    store.update({ lastTestsPassed: false, lastLintPassed: false });
    const output = formatStatus(tmp);
    expect(output).toContain("fail");
  });
});
