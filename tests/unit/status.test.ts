/**
 * Unit tests for src/cli/status.ts – printStatus()
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import yaml from "js-yaml";
import { StateStore } from "../../src/core/state-store.js";
import { printStatus } from "../../src/cli/status.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "status-test-"));
}

function setupDocs(root: string): void {
  mkdirSync(join(root, "docs"), { recursive: true });
}

function writeBacklogYaml(root: string, features: object[]): void {
  const backlog = {
    version: "1",
    generatedAt: new Date().toISOString(),
    features: features.map((f) => {
      const obj = f as Record<string, unknown>;
      return {
        id: obj.id,
        title: obj.title,
        epic: "Core",
        status: obj.status ?? "open",
        priority: "medium",
        dependsOn: [],
        acceptanceCriteria: obj.acceptanceCriteria ?? [],
        estimatedComplexity: "medium",
        specKitBranch: "",
        notes: "",
      };
    }),
  };
  writeFileSync(join(root, "docs", "product-backlog.yaml"), yaml.dump(backlog), "utf8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("printStatus – no state file", () => {
  let tmp: string;
  let logs: string[];

  beforeEach(() => {
    tmp = makeTmp();
    setupDocs(tmp);
    logs = [];
    jest.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("logs bootstrap message when state does not exist", () => {
    printStatus(tmp);
    expect(logs.some((l) => l.includes("bootstrap-product"))).toBe(true);
  });

  it("returns immediately without status block when state is missing", () => {
    printStatus(tmp);
    expect(logs.some((l) => l.includes("=== speckit-autopilot STATUS ==="))).toBe(false);
  });
});

describe("printStatus – state exists, no backlog", () => {
  let tmp: string;
  let logs: string[];

  beforeEach(() => {
    tmp = makeTmp();
    setupDocs(tmp);
    const store = new StateStore(tmp);
    store.createInitial("greenfield");
    logs = [];
    jest.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("prints the STATUS header", () => {
    printStatus(tmp);
    expect(logs.some((l) => l.includes("=== speckit-autopilot STATUS ==="))).toBe(true);
  });

  it("shows mode from state", () => {
    printStatus(tmp);
    expect(logs.some((l) => l.includes("greenfield"))).toBe(true);
  });

  it("shows 0 total features when no backlog exists", () => {
    printStatus(tmp);
    expect(logs.some((l) => l.includes("Total") && l.includes("0"))).toBe(true);
  });
});

describe("printStatus – state + backlog with features", () => {
  let tmp: string;
  let logs: string[];

  beforeEach(() => {
    tmp = makeTmp();
    setupDocs(tmp);
    const store = new StateStore(tmp);
    store.createInitial("greenfield");
    writeBacklogYaml(tmp, [
      { id: "first-feature", title: "First Feature", status: "open", acceptanceCriteria: ["works"] },
      { id: "second-feature", title: "Second Feature", status: "in_progress", acceptanceCriteria: ["works"] },
      { id: "third-feature", title: "Third Feature", status: "done", acceptanceCriteria: ["works"] },
      { id: "fourth-feature", title: "Fourth Feature", status: "blocked", acceptanceCriteria: ["works"] },
    ]);
    logs = [];
    jest.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("shows correct open count", () => {
    printStatus(tmp);
    expect(logs.some((l) => l.includes("Open") && l.includes("1"))).toBe(true);
  });

  it("shows correct in_progress count", () => {
    printStatus(tmp);
    expect(logs.some((l) => l.includes("In progress") && l.includes("1"))).toBe(true);
  });

  it("shows correct done count", () => {
    printStatus(tmp);
    expect(logs.some((l) => l.includes("Done") && l.includes("1"))).toBe(true);
  });

  it("shows correct blocked count", () => {
    printStatus(tmp);
    expect(logs.some((l) => l.includes("Blocked") && l.includes("1"))).toBe(true);
  });

  it("shows correct total count", () => {
    printStatus(tmp);
    expect(logs.some((l) => l.includes("Total") && l.includes("4"))).toBe(true);
  });

  it("shows next feature (first open feature)", () => {
    printStatus(tmp);
    expect(logs.some((l) => l.includes("first-feature") && l.includes("First Feature"))).toBe(true);
  });
});

describe("printStatus – iteration log tail", () => {
  let tmp: string;
  let logs: string[];

  beforeEach(() => {
    tmp = makeTmp();
    setupDocs(tmp);
    const store = new StateStore(tmp);
    store.createInitial("greenfield");
    logs = [];
    jest.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("includes content from iteration-log.md when it exists", () => {
    writeFileSync(
      join(tmp, "docs", "iteration-log.md"),
      "## START – F-001\n- Branch: feature/f-001\n## DONE – F-001\nCoverage: 90%\n",
      "utf8"
    );
    printStatus(tmp);
    // The log tail should appear somewhere in the output
    expect(logs.some((l) => l.includes("Recent log"))).toBe(true);
  });

  it("shows dash when iteration-log.md does not exist", () => {
    printStatus(tmp);
    // logTail defaults to "—"
    expect(logs.some((l) => l.includes("—"))).toBe(true);
  });
});

describe("printStatus – lastLintPassed variations", () => {
  let tmp: string;
  let logs: string[];
  let store: StateStore;

  beforeEach(() => {
    tmp = makeTmp();
    setupDocs(tmp);
    store = new StateStore(tmp);
    store.createInitial("greenfield");
    logs = [];
    jest.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("shows '—' when lastLintPassed is null", () => {
    // createInitial sets lastLintPassed to null
    printStatus(tmp);
    const lintLine = logs.find((l) => l.includes("Lint"));
    expect(lintLine).toBeDefined();
    expect(lintLine).toContain("—");
  });

  it("shows 'pass' when lastLintPassed is true", () => {
    store.update({ lastLintPassed: true });
    printStatus(tmp);
    const lintLine = logs.find((l) => l.includes("Lint"));
    expect(lintLine).toBeDefined();
    expect(lintLine).toContain("pass");
  });

  it("shows 'fail' when lastLintPassed is false", () => {
    store.update({ lastLintPassed: false });
    printStatus(tmp);
    const lintLine = logs.find((l) => l.includes("Lint"));
    expect(lintLine).toBeDefined();
    expect(lintLine).toContain("fail");
  });
});
