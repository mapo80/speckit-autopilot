import { applyGateResultToState, GateResult } from "../../src/core/acceptance-gate.js";
import { StateStore, AutopilotState } from "../../src/core/state-store.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "gate-test-"));
}

function makeState(root: string, overrides: Partial<AutopilotState> = {}): AutopilotState {
  const store = new StateStore(root);
  store.createInitial("greenfield");
  if (Object.keys(overrides).length > 0) {
    store.update(overrides);
  }
  return store.read();
}

function makeGateResult(overrides: Partial<GateResult> = {}): GateResult {
  return {
    passed: true,
    checks: [],
    coverage: null,
    summary: "All checks passed",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// applyGateResultToState
// ---------------------------------------------------------------------------

describe("applyGateResultToState", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("sets lastLintPassed from lint check", () => {
    const state = makeState(tmp);
    const gate = makeGateResult({
      checks: [{ name: "lint", passed: true, details: "ok" }],
    });
    const patch = applyGateResultToState(state, gate);
    expect(patch.lastLintPassed).toBe(true);
  });

  it("sets lastLintPassed false when lint fails", () => {
    const state = makeState(tmp);
    const gate = makeGateResult({
      checks: [{ name: "lint", passed: false, details: "errors found" }],
    });
    const patch = applyGateResultToState(state, gate);
    expect(patch.lastLintPassed).toBe(false);
  });

  it("sets lastTestsPassed from tests check", () => {
    const state = makeState(tmp);
    const gate = makeGateResult({
      checks: [{ name: "tests", passed: true, details: "all pass" }],
    });
    const patch = applyGateResultToState(state, gate);
    expect(patch.lastTestsPassed).toBe(true);
  });

  it("sets lastCoverage when coverage is provided", () => {
    const state = makeState(tmp);
    const gate = makeGateResult({ coverage: 94.5 });
    const patch = applyGateResultToState(state, gate);
    expect(patch.lastCoverage).toBe("94.5");
  });

  it("preserves existing lastCoverage when gate coverage is null", () => {
    const state = makeState(tmp, { lastCoverage: "87.0" });
    const gate = makeGateResult({ coverage: null });
    const patch = applyGateResultToState(state, gate);
    expect(patch.lastCoverage).toBe("87.0");
  });

  it("sets lastTestRun to ISO date string", () => {
    const state = makeState(tmp);
    const gate = makeGateResult();
    const patch = applyGateResultToState(state, gate);
    expect(patch.lastTestRun).toBeTruthy();
    expect(() => new Date(patch.lastTestRun!)).not.toThrow();
  });

  it("sets lastError to null on gate pass", () => {
    const state = makeState(tmp, { lastError: "previous error" });
    const gate = makeGateResult({ passed: true });
    const patch = applyGateResultToState(state, gate);
    expect(patch.lastError).toBeNull();
  });

  it("sets lastError to summary on gate fail", () => {
    const state = makeState(tmp);
    const gate = makeGateResult({ passed: false, summary: "Tests failed" });
    const patch = applyGateResultToState(state, gate);
    expect(patch.lastError).toBe("Tests failed");
  });

  it("preserves existing lastLintPassed when no lint check present", () => {
    const state = makeState(tmp, { lastLintPassed: true });
    const gate = makeGateResult({ checks: [] }); // no lint check
    const patch = applyGateResultToState(state, gate);
    expect(patch.lastLintPassed).toBe(true);
  });
});
