/**
 * BUG#9 regression: when the backlog contains features with status "in_progress"
 * (left over from a previous interrupted run), ship() must reset them to "open"
 * AND write a "STUCK RESET" entry to the iteration log.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import yaml from "js-yaml";
import { StateStore } from "../../src/core/state-store.js";
import { makeEmptyBacklog, Feature, Backlog } from "../../src/core/backlog-schema.js";
import { ship, PhaseRunner, readBacklog } from "../../src/cli/ship.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "ship-stuck-"));
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

function setupProject(root: string, features: Feature[]): void {
  mkdirSync(join(root, "docs"), { recursive: true });
  const backlog: Backlog = { ...makeEmptyBacklog(), features };
  writeFileSync(join(root, "docs", "product-backlog.yaml"), yaml.dump(backlog), "utf8");
  const store = new StateStore(root);
  store.createInitial("greenfield");
  store.update({ gatingEnabled: false });
}

const successRunner: PhaseRunner = async () => ({ success: true, phase: "implement" });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ship – stuck in_progress features are reset (BUG#9)", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("resets in_progress feature to open then ships it as done", async () => {
    // Simulate a previously-interrupted run: F-001 is stuck in_progress
    setupProject(tmp, [makeFeature("feature-one", "in_progress")]);

    const result = await ship({ root: tmp, dryRun: true, phaseRunner: successRunner });

    // The stuck feature should have been processed and completed
    expect(result.success).toBe(true);
    expect(result.completed).toBeGreaterThan(0);

    const backlog = readBacklog(tmp);
    expect(backlog.features[0].status).toBe("done");
  });

  it("writes STUCK RESET entry to iteration log", async () => {
    setupProject(tmp, [makeFeature("feature-one", "in_progress")]);

    await ship({ root: tmp, dryRun: true, phaseRunner: successRunner });

    const logPath = join(tmp, "docs", "iteration-log.md");
    expect(existsSync(logPath)).toBe(true);

    const logContent = readFileSync(logPath, "utf8");
    expect(logContent).toContain("STUCK RESET");
  });

  it("includes the stuck feature's ID in the STUCK RESET log entry", async () => {
    setupProject(tmp, [makeFeature("feature-one", "in_progress")]);

    await ship({ root: tmp, dryRun: true, phaseRunner: successRunner });

    const logContent = readFileSync(join(tmp, "docs", "iteration-log.md"), "utf8");
    expect(logContent).toContain("feature-one");
  });

  it("resets multiple stuck features and logs all of them", async () => {
    setupProject(tmp, [
      makeFeature("feature-one", "in_progress"),
      makeFeature("feature-two", "in_progress"),
      makeFeature("feature-three", "open"),
    ]);

    await ship({ root: tmp, dryRun: true, phaseRunner: successRunner });

    const logContent = readFileSync(join(tmp, "docs", "iteration-log.md"), "utf8");
    expect(logContent).toContain("STUCK RESET");
    expect(logContent).toContain("feature-one");
    expect(logContent).toContain("feature-two");
  });

  it("does NOT write STUCK RESET when no features are in_progress", async () => {
    setupProject(tmp, [makeFeature("feature-one", "open")]);

    await ship({ root: tmp, dryRun: true, phaseRunner: successRunner });

    const logPath = join(tmp, "docs", "iteration-log.md");
    if (existsSync(logPath)) {
      const logContent = readFileSync(logPath, "utf8");
      expect(logContent).not.toContain("STUCK RESET");
    }
    // If log does not even exist there is definitely no STUCK RESET entry
  });

  it("ships all features (including reset ones) in a single call", async () => {
    setupProject(tmp, [
      makeFeature("feature-one", "in_progress"),
      makeFeature("feature-two", "open"),
    ]);

    const shippedIds: string[] = [];
    const trackingRunner: PhaseRunner = async (opts) => {
      shippedIds.push(opts.featureId);
      return { success: true, phase: "implement" };
    };

    await ship({ root: tmp, dryRun: true, phaseRunner: trackingRunner });

    // Both features should have been shipped
    expect(shippedIds).toContain("feature-one");
    expect(shippedIds).toContain("feature-two");
  });

  it("leaves done features untouched by stuck reset", async () => {
    setupProject(tmp, [
      makeFeature("feature-one", "done"),
      makeFeature("feature-two", "in_progress"),
    ]);

    await ship({ root: tmp, dryRun: true, phaseRunner: successRunner });

    const backlog = readBacklog(tmp);
    const f1 = backlog.features.find((f) => f.id === "feature-one")!;
    expect(f1.status).toBe("done"); // must remain done
  });
});
