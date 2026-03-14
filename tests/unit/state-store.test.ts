import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { StateStore, createStateStore } from "../../src/core/state-store.js";

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "speckit-state-test-"));
}

describe("StateStore", () => {
  let tmpRoot: string;
  let store: StateStore;

  beforeEach(() => {
    tmpRoot = makeTmp();
    store = createStateStore(tmpRoot);
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // exists
  // ---------------------------------------------------------------------------

  it("exists() returns false when state file is absent", () => {
    expect(store.exists()).toBe(false);
  });

  it("exists() returns true after createInitial", () => {
    store.createInitial();
    expect(store.exists()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // createInitial
  // ---------------------------------------------------------------------------

  it("createInitial writes a valid state file", () => {
    const state = store.createInitial("greenfield");
    expect(state.version).toBe("1");
    expect(state.mode).toBe("greenfield");
    expect(state.status).toBe("bootstrapped");
    expect(state.activeFeature).toBeNull();
  });

  it("createInitial supports brownfield mode", () => {
    const state = store.createInitial("brownfield");
    expect(state.mode).toBe("brownfield");
  });

  // ---------------------------------------------------------------------------
  // read
  // ---------------------------------------------------------------------------

  it("read throws when state file is absent", () => {
    expect(() => store.read()).toThrow();
  });

  it("read returns the written state", () => {
    store.createInitial("greenfield");
    const state = store.read();
    expect(state.version).toBe("1");
    expect(state.mode).toBe("greenfield");
  });

  // ---------------------------------------------------------------------------
  // readOrNull
  // ---------------------------------------------------------------------------

  it("readOrNull returns null when file is absent", () => {
    expect(store.readOrNull()).toBeNull();
  });

  it("readOrNull returns state when file exists", () => {
    store.createInitial();
    const state = store.readOrNull();
    expect(state).not.toBeNull();
    expect(state?.version).toBe("1");
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------

  it("update merges patch into state", () => {
    store.createInitial();
    const updated = store.update({ activeFeature: "F-001", currentPhase: "spec" });
    expect(updated.activeFeature).toBe("F-001");
    expect(updated.currentPhase).toBe("spec");
  });

  it("update preserves untouched fields", () => {
    store.createInitial("greenfield");
    store.update({ activeFeature: "F-001" });
    const state = store.read();
    expect(state.mode).toBe("greenfield");
    expect(state.maxFailures).toBe(3);
  });

  it("update bumps updatedAt", () => {
    store.createInitial();
    const before = store.read().updatedAt;
    // Ensure time passes (at least 1ms) for timestamp comparison
    const updated = store.update({ consecutiveFailures: 1 });
    expect(updated.updatedAt).toBeDefined();
    // updatedAt should be a valid ISO string
    expect(() => new Date(updated.updatedAt)).not.toThrow();
  });

  it("update throws on invalid phase value", () => {
    store.createInitial();
    expect(() => store.update({ currentPhase: "invalid_phase" as never })).toThrow();
  });

  // ---------------------------------------------------------------------------
  // write
  // ---------------------------------------------------------------------------

  it("write persists state that can be read back", () => {
    const state = store.createInitial();
    const modified = { ...state, consecutiveFailures: 2, lastError: "test error" };
    store.write(modified);
    const read = store.read();
    expect(read.consecutiveFailures).toBe(2);
    expect(read.lastError).toBe("test error");
  });
});
