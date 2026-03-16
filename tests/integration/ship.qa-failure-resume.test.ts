/**
 * BUG#7 regression: after QA gate failure, currentPhase must be reset to "spec"
 * (not left as "qa").
 *
 * We set gatingEnabled:true with requireTestsPass:true and place a package.json
 * whose "test" script exits 1, which causes the gate to fail.  After ship()
 * returns we assert that state.currentPhase === "spec".
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
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
  return mkdtempSync(join(tmpdir(), "ship-qa-fail-"));
}

function makeFeature(id: string): Feature {
  return {
    id,
    title: `Feature ${id}`,
    epic: "Core",
    status: "open",
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
}

const successRunner: PhaseRunner = async () => ({ success: true, phase: "implement" });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ship – QA gate failure resets currentPhase to spec (BUG#7)", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("sets currentPhase to 'spec' after QA gate test failure", async () => {
    setupProject(tmp, [makeFeature("feature-one")]);

    // Enable gating with a test script that always fails
    const store = new StateStore(tmp);
    store.update({
      gatingEnabled: true,
      acceptanceCriteria: {
        requireLintPass: false,
        requireTestsPass: true,
        minCoverage: null,
        items: [],
      },
    });

    // Write a package.json whose test script exits 1 (forces gate failure)
    const pkg = {
      name: "test-project",
      version: "1.0.0",
      scripts: {
        test: "node -e \"process.exit(1)\"",
        lint: "node -e \"process.exit(0)\"",
      },
    };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg, null, 2), "utf8");

    const result = await ship({
      root: tmp,
      featureTarget: "feature-one",
      dryRun: false,
      phaseRunner: successRunner,
    });

    // QA gate should have failed → ship returns success:false
    expect(result.success).toBe(false);

    // BUG#7: currentPhase must be reset to "spec", not stuck at "qa"
    const state = store.read();
    expect(state.currentPhase).toBe("spec");
  });

  it("increments consecutiveFailures on QA gate failure", async () => {
    setupProject(tmp, [makeFeature("feature-one")]);

    const store = new StateStore(tmp);
    store.update({
      gatingEnabled: true,
      acceptanceCriteria: {
        requireLintPass: false,
        requireTestsPass: true,
        minCoverage: null,
        items: [],
      },
    });

    const pkg = {
      name: "test-project",
      version: "1.0.0",
      scripts: { test: "node -e \"process.exit(1)\"" },
    };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg, null, 2), "utf8");

    await ship({
      root: tmp,
      featureTarget: "feature-one",
      dryRun: false,
      phaseRunner: successRunner,
    });

    const state = store.read();
    expect(state.consecutiveFailures).toBeGreaterThan(0);
  });

  it("marks feature back to 'open' in backlog after QA gate failure", async () => {
    setupProject(tmp, [makeFeature("feature-one")]);

    const store = new StateStore(tmp);
    store.update({
      gatingEnabled: true,
      acceptanceCriteria: {
        requireLintPass: false,
        requireTestsPass: true,
        minCoverage: null,
        items: [],
      },
    });

    const pkg = {
      name: "test-project",
      version: "1.0.0",
      scripts: { test: "node -e \"process.exit(1)\"" },
    };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg, null, 2), "utf8");

    await ship({
      root: tmp,
      featureTarget: "feature-one",
      dryRun: false,
      phaseRunner: successRunner,
    });

    const backlog = readBacklog(tmp);
    // Feature must not be stuck in_progress — reverted to open on gate failure
    expect(backlog.features[0].status).toBe("open");
  });

  it("skips QA gate in dryRun mode (gate always passes)", async () => {
    setupProject(tmp, [makeFeature("feature-one")]);

    const store = new StateStore(tmp);
    store.update({
      gatingEnabled: true,
      acceptanceCriteria: {
        requireLintPass: false,
        requireTestsPass: true,
        minCoverage: null,
        items: [],
      },
    });

    // Even with a failing test script, dryRun should bypass the gate
    const pkg = {
      name: "test-project",
      version: "1.0.0",
      scripts: { test: "node -e \"process.exit(1)\"" },
    };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg, null, 2), "utf8");

    const result = await ship({
      root: tmp,
      featureTarget: "feature-one",
      dryRun: true,
      phaseRunner: successRunner,
    });

    // dryRun skips the gate so it should succeed
    expect(result.success).toBe(true);
  });
});
