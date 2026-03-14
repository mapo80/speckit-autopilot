/**
 * Integration tests for runAcceptanceGate that actually invoke spawnSync
 * via minimal shell scripts embedded in package.json.
 * Covers lines 74-103 (runLintCheck, runTestCheck) and 176, 181-187
 * in acceptance-gate.ts.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { StateStore } from "../../src/core/state-store.js";
import { runAcceptanceGate } from "../../src/core/acceptance-gate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "gate-cmd-test-"));
}

function setupProjectWithScripts(
  root: string,
  scripts: Record<string, string>
): void {
  const pkg = { name: "test-project", version: "1.0.0", scripts };
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg), "utf8");
}

function makeStateWithCriteria(
  root: string,
  opts: {
    requireLintPass?: boolean;
    requireTestsPass?: boolean;
    minCoverage?: number | null;
  } = {}
): ReturnType<StateStore["read"]> {
  const store = new StateStore(root);
  store.createInitial("greenfield");
  store.update({
    gatingEnabled: true,
    acceptanceCriteria: {
      requireLintPass: opts.requireLintPass ?? true,
      requireTestsPass: opts.requireTestsPass ?? true,
      minCoverage: opts.minCoverage ?? null,
      items: [],
    },
  });
  return store.read();
}

// ---------------------------------------------------------------------------
// runLintCheck via runAcceptanceGate (line 176)
// ---------------------------------------------------------------------------

describe("runAcceptanceGate – lint check via real command", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("passes when lint script exits 0", () => {
    setupProjectWithScripts(tmp, {
      lint: `node -e "process.exit(0)"`,
      test: `node -e "process.exit(0)"`,
    });
    const state = makeStateWithCriteria(tmp, {
      requireLintPass: true,
      requireTestsPass: false,
    });
    const result = runAcceptanceGate(tmp, state);
    const lintCheck = result.checks.find((c) => c.name === "lint");
    expect(lintCheck).toBeDefined();
    expect(lintCheck?.passed).toBe(true);
  });

  it("fails when lint script exits non-zero", () => {
    setupProjectWithScripts(tmp, {
      lint: `node -e "process.exit(1)"`,
      test: `node -e "process.exit(0)"`,
    });
    const state = makeStateWithCriteria(tmp, {
      requireLintPass: true,
      requireTestsPass: false,
    });
    const result = runAcceptanceGate(tmp, state);
    const lintCheck = result.checks.find((c) => c.name === "lint");
    expect(lintCheck?.passed).toBe(false);
  });

  it("uses fallback npx eslint when no lint script defined", () => {
    // package.json with no lint script – falls back to npx eslint
    setupProjectWithScripts(tmp, { test: `node -e "process.exit(0)"` });
    const state = makeStateWithCriteria(tmp, {
      requireLintPass: true,
      requireTestsPass: false,
    });
    // Just verify it doesn't throw; result depends on whether eslint is installed
    expect(() => runAcceptanceGate(tmp, state)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// runTestCheck via runAcceptanceGate (lines 181-187)
// ---------------------------------------------------------------------------

describe("runAcceptanceGate – test check via real command", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("passes when test script exits 0", () => {
    setupProjectWithScripts(tmp, {
      test: `node -e "process.exit(0)"`,
    });
    const state = makeStateWithCriteria(tmp, {
      requireLintPass: false,
      requireTestsPass: true,
      minCoverage: null,
    });
    const result = runAcceptanceGate(tmp, state);
    const testCheck = result.checks.find((c) => c.name === "tests");
    expect(testCheck).toBeDefined();
    expect(testCheck?.passed).toBe(true);
  });

  it("fails when test script exits non-zero", () => {
    setupProjectWithScripts(tmp, {
      test: `node -e "process.exit(1)"`,
    });
    const state = makeStateWithCriteria(tmp, {
      requireLintPass: false,
      requireTestsPass: true,
      minCoverage: null,
    });
    const result = runAcceptanceGate(tmp, state);
    const testCheck = result.checks.find((c) => c.name === "tests");
    expect(testCheck?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("extracts coverage from test output when minCoverage is set", () => {
    // Script outputs Jest coverage table format and exits 0
    const coverageOutput = "All files | 95.5 | 90 | 88 | 95";
    setupProjectWithScripts(tmp, {
      test: `node -e "console.log('${coverageOutput}'); process.exit(0)"`,
    });
    const state = makeStateWithCriteria(tmp, {
      requireLintPass: false,
      requireTestsPass: true,
      minCoverage: 80,
    });
    const result = runAcceptanceGate(tmp, state);
    // Coverage should be extracted and threshold check should pass
    const thresholdCheck = result.checks.find((c) => c.name === "coverage_threshold");
    expect(thresholdCheck).toBeDefined();
    expect(thresholdCheck?.passed).toBe(true);
  });

  it("fails coverage threshold when output coverage is below minimum", () => {
    const coverageOutput = "All files | 75.0 | 70 | 65 | 75";
    setupProjectWithScripts(tmp, {
      test: `node -e "console.log('${coverageOutput}'); process.exit(0)"`,
    });
    const state = makeStateWithCriteria(tmp, {
      requireLintPass: false,
      requireTestsPass: true,
      minCoverage: 90,
    });
    const result = runAcceptanceGate(tmp, state);
    const thresholdCheck = result.checks.find((c) => c.name === "coverage_threshold");
    expect(thresholdCheck?.passed).toBe(false);
  });

  it("handles missing package.json (uses fallback command)", () => {
    // No package.json at all – falls back to npx jest
    const state = makeStateWithCriteria(tmp, {
      requireLintPass: false,
      requireTestsPass: true,
    });
    expect(() => runAcceptanceGate(tmp, state)).not.toThrow();
  });
});
