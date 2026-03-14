import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  extractCoveragePercent,
  runCoverageThresholdCheck,
  checkAcceptanceItems,
  pickCommand,
  readPackageScripts,
  runAcceptanceGate,
} from "../../src/core/acceptance-gate.js";
import { StateStore, AcceptanceCriteriaConfig } from "../../src/core/state-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "gate-pure-test-"));
}

function makeConfig(overrides: Partial<AcceptanceCriteriaConfig> = {}): AcceptanceCriteriaConfig {
  return {
    requireLintPass: true,
    requireTestsPass: true,
    minCoverage: null,
    items: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractCoveragePercent
// ---------------------------------------------------------------------------

describe("extractCoveragePercent", () => {
  it("extracts from Jest/istanbul table format", () => {
    const output = "All files | 94.5 | 88 | 92 | 94";
    expect(extractCoveragePercent(output)).toBe(94.5);
  });

  it("extracts from Vitest Coverage format", () => {
    const output = "Coverage: 87.3%";
    expect(extractCoveragePercent(output)).toBe(87.3);
  });

  it("extracts from generic 'lines' format", () => {
    const output = "92.1% lines covered";
    expect(extractCoveragePercent(output)).toBe(92.1);
  });

  it("extracts from generic 'statements' format", () => {
    const output = "78.5% statements covered";
    expect(extractCoveragePercent(output)).toBe(78.5);
  });

  it("returns null for unrecognised format", () => {
    expect(extractCoveragePercent("no coverage data here")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractCoveragePercent("")).toBeNull();
  });

  it("handles coverage at 100%", () => {
    const output = "All files | 100 | 100 | 100 | 100";
    expect(extractCoveragePercent(output)).toBe(100);
  });

  it("handles coverage at 0%", () => {
    const output = "All files | 0 | 0 | 0 | 0";
    expect(extractCoveragePercent(output)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runCoverageThresholdCheck
// ---------------------------------------------------------------------------

describe("runCoverageThresholdCheck", () => {
  it("passes when minCoverage is null", () => {
    const result = runCoverageThresholdCheck(50, null);
    expect(result.passed).toBe(true);
    expect(result.details).toContain("No minimum coverage");
  });

  it("fails when coverage is null but minCoverage is set", () => {
    const result = runCoverageThresholdCheck(null, 80);
    expect(result.passed).toBe(false);
    expect(result.details).toContain("could not be extracted");
  });

  it("passes when coverage meets threshold", () => {
    const result = runCoverageThresholdCheck(95, 90);
    expect(result.passed).toBe(true);
    expect(result.details).toContain(">=");
  });

  it("passes when coverage exactly meets threshold", () => {
    const result = runCoverageThresholdCheck(90, 90);
    expect(result.passed).toBe(true);
  });

  it("fails when coverage is below threshold", () => {
    const result = runCoverageThresholdCheck(85, 90);
    expect(result.passed).toBe(false);
    expect(result.details).toContain("< required");
  });

  it("includes numeric values in details", () => {
    const result = runCoverageThresholdCheck(87.3, 90);
    expect(result.details).toContain("87.3");
    expect(result.details).toContain("90");
  });
});

// ---------------------------------------------------------------------------
// checkAcceptanceItems
// ---------------------------------------------------------------------------

describe("checkAcceptanceItems", () => {
  it("passes with no items", () => {
    const result = checkAcceptanceItems(makeConfig({ items: [] }));
    expect(result.passed).toBe(true);
  });

  it("passes when all items are done", () => {
    const result = checkAcceptanceItems(makeConfig({
      items: [
        { description: "Feature works", status: "done" },
        { description: "Tests pass", status: "done" },
      ],
    }));
    expect(result.passed).toBe(true);
  });

  it("fails when any item is pending", () => {
    const result = checkAcceptanceItems(makeConfig({
      items: [
        { description: "Feature works", status: "done" },
        { description: "UI reviewed", status: "pending" },
      ],
    }));
    expect(result.passed).toBe(false);
    expect(result.details).toContain("UI reviewed");
  });

  it("reports count of pending items", () => {
    const result = checkAcceptanceItems(makeConfig({
      items: [
        { description: "A", status: "pending" },
        { description: "B", status: "pending" },
      ],
    }));
    expect(result.details).toContain("2 item(s)");
  });

  it("lists all pending item descriptions", () => {
    const result = checkAcceptanceItems(makeConfig({
      items: [
        { description: "Check A", status: "pending" },
        { description: "Check B", status: "done" },
        { description: "Check C", status: "pending" },
      ],
    }));
    expect(result.details).toContain("Check A");
    expect(result.details).toContain("Check C");
    expect(result.details).not.toContain("Check B");
  });
});

// ---------------------------------------------------------------------------
// pickCommand
// ---------------------------------------------------------------------------

describe("pickCommand", () => {
  it("returns npm run <script> when candidate exists in scripts", () => {
    const scripts = { lint: "eslint .", test: "jest" };
    expect(pickCommand(scripts, ["lint"], "fallback")).toBe("npm run lint");
  });

  it("returns first matching candidate", () => {
    const scripts = { eslint: "eslint .", test: "jest" };
    expect(pickCommand(scripts, ["lint", "eslint"], "fallback")).toBe("npm run eslint");
  });

  it("returns fallback when no candidate matches", () => {
    const scripts = { build: "tsc" };
    expect(pickCommand(scripts, ["lint", "eslint"], "npx eslint .")).toBe("npx eslint .");
  });

  it("returns fallback for empty scripts", () => {
    expect(pickCommand({}, ["lint"], "npx eslint .")).toBe("npx eslint .");
  });
});

// ---------------------------------------------------------------------------
// readPackageScripts
// ---------------------------------------------------------------------------

describe("readPackageScripts", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns empty object when package.json does not exist", () => {
    const scripts = readPackageScripts(tmp);
    expect(scripts).toEqual({});
  });

  it("returns scripts from package.json", () => {
    const pkg = { scripts: { test: "jest", lint: "eslint ." } };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg), "utf8");
    const scripts = readPackageScripts(tmp);
    expect(scripts.test).toBe("jest");
    expect(scripts.lint).toBe("eslint .");
  });

  it("returns empty object for package.json without scripts field", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "test" }), "utf8");
    const scripts = readPackageScripts(tmp);
    expect(scripts).toEqual({});
  });

  it("returns empty object for malformed package.json", () => {
    writeFileSync(join(tmp, "package.json"), "not json", "utf8");
    const scripts = readPackageScripts(tmp);
    expect(scripts).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// runAcceptanceGate – gating disabled path
// ---------------------------------------------------------------------------

describe("runAcceptanceGate – gating disabled", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns passed:true when gatingEnabled is false", () => {
    const store = new StateStore(tmp);
    store.createInitial();
    store.update({ gatingEnabled: false });
    const state = store.read();
    const result = runAcceptanceGate(tmp, state);
    expect(result.passed).toBe(true);
    expect(result.summary).toContain("disabled");
  });
});

// ---------------------------------------------------------------------------
// runAcceptanceGate – acceptance items only (no lint/test runners)
// ---------------------------------------------------------------------------

describe("runAcceptanceGate – acceptance items check", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("fails when acceptance items are pending", () => {
    const store = new StateStore(tmp);
    store.createInitial();
    store.update({
      gatingEnabled: true,
      acceptanceCriteria: {
        requireLintPass: false,
        requireTestsPass: false,
        minCoverage: null,
        items: [{ description: "Manual QA sign-off", status: "pending" }],
      },
    });
    const state = store.read();
    const result = runAcceptanceGate(tmp, state);
    expect(result.passed).toBe(false);
    expect(result.checks.some((c) => c.name === "acceptance_items" && !c.passed)).toBe(true);
  });

  it("passes when all acceptance items are done and lint/test disabled", () => {
    const store = new StateStore(tmp);
    store.createInitial();
    store.update({
      gatingEnabled: true,
      acceptanceCriteria: {
        requireLintPass: false,
        requireTestsPass: false,
        minCoverage: null,
        items: [{ description: "Manual QA sign-off", status: "done" }],
      },
    });
    const state = store.read();
    const result = runAcceptanceGate(tmp, state);
    expect(result.passed).toBe(true);
    expect(result.checks.some((c) => c.name === "acceptance_items" && c.passed)).toBe(true);
  });

  it("summary says all criteria met on pass", () => {
    const store = new StateStore(tmp);
    store.createInitial();
    store.update({
      gatingEnabled: true,
      acceptanceCriteria: {
        requireLintPass: false,
        requireTestsPass: false,
        minCoverage: null,
        items: [],
      },
    });
    const state = store.read();
    const result = runAcceptanceGate(tmp, state);
    expect(result.summary).toContain("met");
  });

  it("summary lists failed checks on failure", () => {
    const store = new StateStore(tmp);
    store.createInitial();
    store.update({
      gatingEnabled: true,
      acceptanceCriteria: {
        requireLintPass: false,
        requireTestsPass: false,
        minCoverage: null,
        items: [{ description: "check A", status: "pending" }],
      },
    });
    const state = store.read();
    const result = runAcceptanceGate(tmp, state);
    expect(result.passed).toBe(false);
    expect(result.summary).toContain("FAILED");
  });
});
