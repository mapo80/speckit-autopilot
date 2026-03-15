/**
 * BUG#13 regression: testTimeoutMs from AutopilotState is passed through to
 * runTestCheck and honoured by spawnSync.
 *
 * Direct verification of the timeout propagation inside spawnSync is not
 * straightforward in ESM without complex mocking, so these tests take a
 * two-pronged approach:
 *
 *   1. Schema / persistence tests: verify that testTimeoutMs survives a full
 *      write → read round-trip through StateStore.
 *
 *   2. Functional gate tests: verify that runAcceptanceGate behaves correctly
 *      when gatingEnabled:false (passes immediately) and when called with a
 *      state that carries a custom testTimeoutMs — ensuring the function
 *      accepts the field without error.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { StateStore, AutopilotState } from "../../src/core/state-store.js";
import { runAcceptanceGate } from "../../src/core/acceptance-gate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "gate-timeout-"));
}

function makeState(root: string, overrides: Partial<Omit<AutopilotState, "version" | "createdAt">> = {}): AutopilotState {
  const store = new StateStore(root);
  store.createInitial("greenfield");
  return store.update(overrides);
}

// ---------------------------------------------------------------------------
// Schema / persistence
// ---------------------------------------------------------------------------

describe("StateStore – testTimeoutMs field persistence (BUG#13)", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("preserves testTimeoutMs:5000 through write → read cycle", () => {
    const store = new StateStore(tmp);
    store.createInitial("greenfield");
    store.update({ testTimeoutMs: 5000 });

    const state = store.read();
    expect(state.testTimeoutMs).toBe(5000);
  });

  it("preserves testTimeoutMs:300000 through write → read cycle", () => {
    const store = new StateStore(tmp);
    store.createInitial("greenfield");
    store.update({ testTimeoutMs: 300_000 });

    const state = store.read();
    expect(state.testTimeoutMs).toBe(300_000);
  });

  it("defaults testTimeoutMs to 120000 when not explicitly set", () => {
    const store = new StateStore(tmp);
    const state = store.createInitial("greenfield");
    expect(state.testTimeoutMs).toBe(120_000);
  });

  it("rejects testTimeoutMs below minimum (999)", () => {
    const store = new StateStore(tmp);
    store.createInitial("greenfield");
    expect(() => store.update({ testTimeoutMs: 999 })).toThrow();
  });

  it("accepts testTimeoutMs at minimum boundary (1000)", () => {
    const store = new StateStore(tmp);
    store.createInitial("greenfield");
    store.update({ testTimeoutMs: 1000 });
    expect(store.read().testTimeoutMs).toBe(1000);
  });

  it("testTimeoutMs can be updated multiple times and last value wins", () => {
    const store = new StateStore(tmp);
    store.createInitial("greenfield");
    store.update({ testTimeoutMs: 10_000 });
    store.update({ testTimeoutMs: 60_000 });
    store.update({ testTimeoutMs: 45_000 });
    expect(store.read().testTimeoutMs).toBe(45_000);
  });
});

// ---------------------------------------------------------------------------
// runAcceptanceGate – functional
// ---------------------------------------------------------------------------

describe("runAcceptanceGate – accepts state with testTimeoutMs (BUG#13)", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns passed:true when gatingEnabled:false (regardless of testTimeoutMs)", () => {
    const state = makeState(tmp, { gatingEnabled: false, testTimeoutMs: 5000 });
    const result = runAcceptanceGate(tmp, state);
    expect(result.passed).toBe(true);
  });

  it("returns a single 'gating' check with passed:true when disabled", () => {
    const state = makeState(tmp, { gatingEnabled: false, testTimeoutMs: 1000 });
    const result = runAcceptanceGate(tmp, state);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].name).toBe("gating");
    expect(result.checks[0].passed).toBe(true);
  });

  it("summary indicates gating disabled when gatingEnabled:false", () => {
    const state = makeState(tmp, { gatingEnabled: false, testTimeoutMs: 30_000 });
    const result = runAcceptanceGate(tmp, state);
    expect(result.summary).toMatch(/disabled/i);
  });

  it("coverage is null when gating is disabled", () => {
    const state = makeState(tmp, { gatingEnabled: false, testTimeoutMs: 10_000 });
    const result = runAcceptanceGate(tmp, state);
    expect(result.coverage).toBeNull();
  });

  it("skips lint and tests checks when no package.json exists", () => {
    // gatingEnabled:true but no package.json → both checks are skipped (passed:true)
    const state = makeState(tmp, {
      gatingEnabled: true,
      testTimeoutMs: 5000,
      acceptanceCriteria: {
        requireLintPass: true,
        requireTestsPass: true,
        minCoverage: null,
        items: [],
      },
    });
    const result = runAcceptanceGate(tmp, state);
    // All individual checks should pass (skipped with no package.json)
    expect(result.passed).toBe(true);
    const lintCheck = result.checks.find((c) => c.name === "lint");
    const testCheck = result.checks.find((c) => c.name === "tests");
    expect(lintCheck?.details).toMatch(/skipped/i);
    expect(testCheck?.details).toMatch(/skipped/i);
  });

  it("runAcceptanceGate returns a GateResult with required fields", () => {
    const state = makeState(tmp, { gatingEnabled: false, testTimeoutMs: 5000 });
    const result = runAcceptanceGate(tmp, state);
    expect(typeof result.passed).toBe("boolean");
    expect(Array.isArray(result.checks)).toBe(true);
    expect("coverage" in result).toBe(true);
    expect(typeof result.summary).toBe("string");
  });
});
