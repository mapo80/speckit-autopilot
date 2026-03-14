import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  appendToIterationLog,
  readIterationLog,
  formatCompactEntry,
  savePreCompactSnapshot,
  recordPostCompact,
  buildResumeBanner,
  resolveResumePhase,
  phaseToSpeckitCommand,
  CompactEntry,
} from "../../src/core/compact-state.js";
import { StateStore, AutopilotState } from "../../src/core/state-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "compact-test-"));
}

function makeState(root: string, overrides: Partial<AutopilotState> = {}): AutopilotState {
  const store = new StateStore(root);
  store.createInitial("greenfield");
  if (Object.keys(overrides).length > 0) {
    store.update(overrides);
  }
  return store.read();
}

// ---------------------------------------------------------------------------
// appendToIterationLog / readIterationLog
// ---------------------------------------------------------------------------

describe("appendToIterationLog", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("creates the file if it does not exist", () => {
    appendToIterationLog(tmp, "## Entry\n- line\n");
    expect(existsSync(join(tmp, "docs", "iteration-log.md"))).toBe(true);
  });

  it("appends to existing content", () => {
    appendToIterationLog(tmp, "## First\n");
    appendToIterationLog(tmp, "## Second\n");
    const content = readIterationLog(tmp);
    expect(content).toContain("## First");
    expect(content).toContain("## Second");
  });
});

describe("readIterationLog", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns empty string when file does not exist", () => {
    expect(readIterationLog(tmp)).toBe("");
  });

  it("returns file content when it exists", () => {
    appendToIterationLog(tmp, "## Test\n");
    expect(readIterationLog(tmp)).toContain("## Test");
  });
});

// ---------------------------------------------------------------------------
// formatCompactEntry
// ---------------------------------------------------------------------------

describe("formatCompactEntry", () => {
  it("includes all entry fields", () => {
    const entry: CompactEntry = {
      timestamp: "2024-01-01T00:00:00.000Z",
      event: "pre-compact",
      activeFeature: "F-001",
      currentPhase: "spec",
      summary: "test summary",
    };
    const formatted = formatCompactEntry(entry);
    expect(formatted).toContain("PRE-COMPACT");
    expect(formatted).toContain("F-001");
    expect(formatted).toContain("spec");
    expect(formatted).toContain("test summary");
  });

  it("handles null activeFeature", () => {
    const entry: CompactEntry = {
      timestamp: "2024-01-01T00:00:00.000Z",
      event: "post-compact",
      activeFeature: null,
      currentPhase: null,
      summary: "none",
    };
    const formatted = formatCompactEntry(entry);
    expect(formatted).toContain("(none)");
  });
});

// ---------------------------------------------------------------------------
// savePreCompactSnapshot
// ---------------------------------------------------------------------------

describe("savePreCompactSnapshot", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("writes a pre-compact entry to iteration log", () => {
    const state = makeState(tmp, { activeFeature: "F-002", currentPhase: "plan" });
    savePreCompactSnapshot(tmp, state);
    const log = readIterationLog(tmp);
    expect(log).toContain("PRE-COMPACT");
    expect(log).toContain("F-002");
  });
});

// ---------------------------------------------------------------------------
// recordPostCompact
// ---------------------------------------------------------------------------

describe("recordPostCompact", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("increments compactCount", () => {
    const state = makeState(tmp);
    const updated = recordPostCompact(tmp, state, "summary text");
    expect(updated.compactCount).toBe(1);
  });

  it("writes post-compact entry to iteration log", () => {
    const state = makeState(tmp);
    recordPostCompact(tmp, state, "test compact summary");
    const log = readIterationLog(tmp);
    expect(log).toContain("POST-COMPACT");
    expect(log).toContain("test compact summary");
  });

  it("sets lastCompactAt", () => {
    const state = makeState(tmp);
    const updated = recordPostCompact(tmp, state, "");
    expect(updated.lastCompactAt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// buildResumeBanner
// ---------------------------------------------------------------------------

describe("buildResumeBanner", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("includes all key status fields", () => {
    const state = makeState(tmp, { activeFeature: "F-003", currentPhase: "implement" });
    const banner = buildResumeBanner(state);
    expect(banner).toContain("F-003");
    expect(banner).toContain("implement");
    expect(banner).toContain("RESUME STATE");
  });
});

// ---------------------------------------------------------------------------
// resolveResumePhase
// ---------------------------------------------------------------------------

describe("resolveResumePhase", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns start_from_bootstrap when no active feature", () => {
    const state = makeState(tmp);
    expect(resolveResumePhase(state)).toBe("start_from_bootstrap");
  });

  it("returns spec when active feature but no current phase", () => {
    const state = makeState(tmp, { activeFeature: "F-001", currentPhase: null });
    expect(resolveResumePhase(state)).toBe("spec");
  });

  it("returns current phase when set", () => {
    const state = makeState(tmp, { activeFeature: "F-001", currentPhase: "implement" });
    expect(resolveResumePhase(state)).toBe("implement");
  });
});

// ---------------------------------------------------------------------------
// phaseToSpeckitCommand
// ---------------------------------------------------------------------------

describe("phaseToSpeckitCommand", () => {
  it("maps spec to /speckit.specify", () => {
    expect(phaseToSpeckitCommand("spec")).toBe("/speckit.specify");
  });

  it("maps implement to /speckit.implement", () => {
    expect(phaseToSpeckitCommand("implement")).toBe("/speckit.implement");
  });

  it("maps qa to qa-gatekeeper", () => {
    expect(phaseToSpeckitCommand("qa")).toContain("qa-gatekeeper");
  });

  it("maps done to advance message", () => {
    expect(phaseToSpeckitCommand("done")).toContain("next");
  });
});
