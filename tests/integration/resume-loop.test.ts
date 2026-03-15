import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import yaml from "js-yaml";
import { StateStore } from "../../src/core/state-store.js";
import { makeEmptyBacklog, Feature, Backlog } from "../../src/core/backlog-schema.js";
import { resumeLoop } from "../../src/cli/resume-loop.js";
import { PhaseRunner } from "../../src/cli/ship.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "resume-test-"));
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

function writeBacklog(root: string, features: Feature[]): void {
  mkdirSync(join(root, "docs"), { recursive: true });
  const backlog: Backlog = { ...makeEmptyBacklog(), features };
  writeFileSync(join(root, "docs", "product-backlog.yaml"), yaml.dump(backlog), "utf8");
}

function makeNoOpPhaseRunner(): PhaseRunner {
  return async () => ({ success: true, phase: "implement" });
}

// ---------------------------------------------------------------------------
// resume-loop: no state file
// ---------------------------------------------------------------------------

describe("resumeLoop – no state file", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns resumed:false with message suggesting bootstrap", async () => {
    const result = await resumeLoop({ root: tmp, continueAutomatically: false });
    expect(result.resumed).toBe(false);
    expect(result.banner).toContain("bootstrap-product");
  });
});

// ---------------------------------------------------------------------------
// resume-loop: completed product
// ---------------------------------------------------------------------------

describe("resumeLoop – completed product", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns resumed:false when status is completed", async () => {
    const store = new StateStore(tmp);
    store.createInitial();
    store.update({ status: "completed" });
    writeBacklog(tmp, [makeFeature("F-001", "done")]);

    const result = await resumeLoop({ root: tmp, continueAutomatically: false });
    expect(result.resumed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resume-loop: active feature in progress
// ---------------------------------------------------------------------------

describe("resumeLoop – active feature", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns correct resolved phase from state", async () => {
    const store = new StateStore(tmp);
    store.createInitial();
    store.update({ activeFeature: "F-001", currentPhase: "implement", status: "running" });
    writeBacklog(tmp, [makeFeature("F-001", "in_progress")]);

    const result = await resumeLoop({ root: tmp, continueAutomatically: false });
    expect(result.resumed).toBe(true);
    expect(result.resolvedPhase).toBe("implement");
  });

  it("includes banner with feature info", async () => {
    const store = new StateStore(tmp);
    store.createInitial();
    store.update({ activeFeature: "F-002", currentPhase: "plan", status: "running" });
    writeBacklog(tmp, [makeFeature("F-002", "in_progress")]);

    const result = await resumeLoop({ root: tmp, continueAutomatically: false });
    expect(result.banner).toContain("F-002");
  });
});

// ---------------------------------------------------------------------------
// resume-loop: continues automatically with phase runner
// ---------------------------------------------------------------------------

describe("resumeLoop – continueAutomatically", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("runs ship-product and returns final status", async () => {
    const store = new StateStore(tmp);
    store.createInitial();
    store.update({ status: "running" });
    writeBacklog(tmp, [makeFeature("F-001", "open")]);

    const result = await resumeLoop({
      root: tmp,
      continueAutomatically: true,
      phaseRunner: makeNoOpPhaseRunner(),
      dryRun: true,
    });

    expect(result.continuedAutomatically).toBe(true);
    expect(result.finalStatus).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// resume-loop: validateStateForResume branch – bootstrapped with activeFeature
// ---------------------------------------------------------------------------

describe("resumeLoop – bootstrapped with activeFeature", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("is resumable when status=bootstrapped but activeFeature is set", async () => {
    const store = new StateStore(tmp);
    store.createInitial();
    // Force status=bootstrapped but also set activeFeature (covers the && !state.activeFeature false branch)
    store.update({ status: "bootstrapped", activeFeature: "F-001", currentPhase: "spec" });
    writeBacklog(tmp, [makeFeature("F-001", "in_progress")]);

    const result = await resumeLoop({ root: tmp, continueAutomatically: false });
    expect(result.resumed).toBe(true);
    expect(result.resolvedPhase).toBe("spec");
  });

  it("uses default continueAutomatically=true when not specified", async () => {
    const store = new StateStore(tmp);
    store.createInitial();
    store.update({ status: "running" });
    writeBacklog(tmp, [makeFeature("F-001", "done")]);

    // Don't pass continueAutomatically — uses default true
    const result = await resumeLoop({
      root: tmp,
      phaseRunner: makeNoOpPhaseRunner(),
      dryRun: true,
    });

    expect(result.continuedAutomatically).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resume-loop: compaction reinjection
// ---------------------------------------------------------------------------

describe("resumeLoop – compaction reinjection", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("resumes correctly after simulated compaction", async () => {
    // Simulate: state was written before compact
    const store = new StateStore(tmp);
    store.createInitial();
    store.update({
      activeFeature: "F-001",
      currentPhase: "clarify",
      status: "running",
      compactCount: 1,
      lastCompactAt: new Date().toISOString(),
    });
    writeBacklog(tmp, [makeFeature("F-001", "in_progress")]);

    const result = await resumeLoop({ root: tmp, continueAutomatically: false });
    expect(result.resumed).toBe(true);
    expect(result.resolvedPhase).toBe("clarify");
    expect(result.banner).toContain("F-001");
  });
});
