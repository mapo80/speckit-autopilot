/**
 * Targeted tests to cover the remaining uncovered branches in:
 * - ship-product.ts (empty_backlog, blocked_by_dependencies, QA gate failure)
 * - ship-feature.ts (phase failure non-dry-run, QA gate failure non-dry-run,
 *                    greenfield without backlog, store missing after bootstrap)
 * - bootstrap-product.ts (bullet delivery order, fallback epic detection)
 * - resume-loop.ts (backlog null branch, multiple in_progress branch)
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import yaml from "js-yaml";
import { StateStore } from "../../src/core/state-store.js";
import { makeEmptyBacklog, Feature, Backlog, featureNextId } from "../../src/core/backlog-schema.js";
import { shipProduct, readBacklog, writeBacklog, PhaseRunner, makeDefaultPhaseRunner } from "../../src/cli/ship-product.js";
import { shipFeature } from "../../src/cli/ship-feature.js";
import { resumeLoop } from "../../src/cli/resume-loop.js";
import { parseProductMd, buildBacklogFromProduct } from "../../src/cli/bootstrap-product.js";
import { topologicalSort } from "../../src/core/roadmap-generator.js";
import { checkAcceptanceItems } from "../../src/core/acceptance-gate.js";
import { buildBrownfieldSnapshot, isBrownfieldRepo } from "../../src/core/brownfield-snapshot.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "coverage-gaps-test-"));
}

function makeFeature(id: string, priority: Feature["priority"] = "medium", dependsOn: string[] = [], status: Feature["status"] = "open"): Feature {
  return {
    id,
    title: `Feature ${id}`,
    epic: "Core",
    status,
    priority,
    dependsOn,
    acceptanceCriteria: [`${id} works`],
    estimatedComplexity: "medium",
    specKitBranch: "",
    notes: "",
  };
}

function setupProject(root: string, features: Feature[], gatingEnabled = true): void {
  mkdirSync(join(root, "docs"), { recursive: true });
  const backlog: Backlog = { ...makeEmptyBacklog(), features };
  writeFileSync(join(root, "docs", "product-backlog.yaml"), yaml.dump(backlog), "utf8");
  const store = new StateStore(root);
  store.createInitial("greenfield");
  if (!gatingEnabled) store.update({ gatingEnabled: false });
}

function makeSuccessRunner(): PhaseRunner {
  return async () => ({ success: true, phase: "implement" });
}

function makeFailRunner(): PhaseRunner {
  return async () => ({ success: false, phase: "spec", error: "spec failed" });
}

// ---------------------------------------------------------------------------
// ship-product: empty_backlog path (lines 132-133)
// ---------------------------------------------------------------------------

describe("shipProduct – empty_backlog", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns empty_backlog when features array is empty", async () => {
    setupProject(tmp, []);
    const result = await shipProduct({ root: tmp, phaseRunner: makeSuccessRunner(), dryRun: true });
    expect(result.finalStatus).toBe("empty_backlog");
  });
});

// ---------------------------------------------------------------------------
// ship-product: blocked_by_dependencies (lines 139-153)
// ---------------------------------------------------------------------------

describe("shipProduct – blocked_by_dependencies", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns blocked when all open features have unmet dependencies", async () => {
    setupProject(tmp, [
      makeFeature("F-001", "high", ["F-002"]),  // depends on F-002 which is also open
      makeFeature("F-002", "medium", ["F-001"]), // circular: depends on F-001
    ]);
    const result = await shipProduct({ root: tmp, phaseRunner: makeSuccessRunner(), dryRun: true });
    expect(result.finalStatus).toBe("blocked");
    expect(result.blocked).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ship-product: QA gate failure in non-dry-run (lines 240-259)
// ---------------------------------------------------------------------------

describe("shipProduct – QA gate failure (non-dry-run)", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("records QA failure and reopens feature when acceptance items are pending", async () => {
    setupProject(tmp, [makeFeature("F-001")]);
    const store = new StateStore(tmp);
    // Disable lint/test but leave acceptance items pending → gate fails without spawnSync
    store.update({
      gatingEnabled: true,
      acceptanceCriteria: {
        requireLintPass: false,
        requireTestsPass: false,
        minCoverage: null,
        items: [{ description: "Manual QA sign-off", status: "pending" }],
      },
    });

    const result = await shipProduct({ root: tmp, phaseRunner: makeSuccessRunner(), dryRun: false });
    // Feature should be repeatedly failing (QA gate fails each iteration) until blocked
    expect(result.failed).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ship-feature: phase failure with dryRun:false (lines 137-146)
// ---------------------------------------------------------------------------

describe("shipFeature – phase failure (non-dry-run)", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("updates state and reopens feature on phase failure", async () => {
    mkdirSync(join(tmp, "docs"), { recursive: true });
    const backlog: Backlog = { ...makeEmptyBacklog(), features: [makeFeature("F-001")] };
    writeFileSync(join(tmp, "docs", "product-backlog.yaml"), yaml.dump(backlog), "utf8");
    const store = new StateStore(tmp);
    store.createInitial("greenfield");
    store.update({ gatingEnabled: false });

    const result = await shipFeature({
      root: tmp,
      phaseRunner: makeFailRunner(),
      dryRun: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("spec failed");
    // Feature should be reopened (not in_progress)
    const updated = readBacklog(tmp);
    expect(updated.features[0].status).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// ship-feature: QA gate failure with dryRun:false (lines 168-173)
// ---------------------------------------------------------------------------

describe("shipFeature – QA gate failure (non-dry-run)", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("reopens feature when QA gate fails", async () => {
    mkdirSync(join(tmp, "docs"), { recursive: true });
    const backlog: Backlog = { ...makeEmptyBacklog(), features: [makeFeature("F-001")] };
    writeFileSync(join(tmp, "docs", "product-backlog.yaml"), yaml.dump(backlog), "utf8");
    const store = new StateStore(tmp);
    store.createInitial("greenfield");
    store.update({
      gatingEnabled: true,
      acceptanceCriteria: {
        requireLintPass: false,
        requireTestsPass: false,
        minCoverage: null,
        items: [{ description: "Manual sign-off", status: "pending" }],
      },
    });

    const result = await shipFeature({
      root: tmp,
      phaseRunner: makeSuccessRunner(),
      dryRun: false,
    });

    expect(result.success).toBe(false);
    const updated = readBacklog(tmp);
    expect(updated.features[0].status).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// ship-feature: greenfield without backlog (line 67 – calls bootstrapProduct)
// ---------------------------------------------------------------------------

describe("shipFeature – greenfield without backlog", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("bootstraps and ships when product.md exists but no backlog", async () => {
    mkdirSync(join(tmp, "docs"), { recursive: true });
    const productMd = [
      "# Test Product",
      "",
      "## In Scope",
      "### Feature 1 - Core",
      "- Creates core functionality",
      "",
      "## Delivery Preference",
      "1. Core",
    ].join("\n");
    writeFileSync(join(tmp, "docs", "product.md"), productMd, "utf8");

    // No backlog, no state, no src/ → greenfield
    const result = await shipFeature({ root: tmp, dryRun: true });
    // Bootstrap should have run and created the backlog
    expect(existsSync(join(tmp, "docs", "product-backlog.yaml"))).toBe(true);
    // shipFeature should have proceeded
    expect(result.featureId).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// ship-feature: standalone with dryRun:false writes snapshot (lines 228-229)
// ---------------------------------------------------------------------------

describe("shipFeature – standalone brownfield non-dry-run", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("writes brownfield snapshot in non-dry-run standalone mode", async () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src", "index.ts"), "export {};", "utf8");
    const pkg = { name: "app", version: "1.0.0", dependencies: { express: "^4" }, devDependencies: { jest: "^29" } };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg), "utf8");
    // No backlog → standalone path

    const noopRunner = async () => ({ success: true, phase: "implement" as const });
    const result = await shipFeature({ root: tmp, featureTarget: "New Feature", dryRun: false, phaseRunner: noopRunner });
    expect(result.brownfieldSnapshotWritten).toBe(true);
    expect(existsSync(join(tmp, "docs", "brownfield-snapshot.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseProductMd: bullet delivery order (line 85)
// ---------------------------------------------------------------------------

describe("parseProductMd – bullet delivery order", () => {
  it("extracts delivery order from bullet points (not numbered)", () => {
    const md = [
      "# My Product",
      "",
      "## Delivery Order",
      "- Feature A first",
      "- Feature B second",
      "",
      "## In Scope",
      "### Feature A",
      "- Does A",
    ].join("\n");
    const parsed = parseProductMd(md);
    expect(parsed.deliveryOrder).toContain("Feature A first");
    expect(parsed.deliveryOrder).toContain("Feature B second");
  });
});

// ---------------------------------------------------------------------------
// parseProductMd: fallback epic detection (lines 103-111)
// ---------------------------------------------------------------------------

describe("parseProductMd – fallback epic from Feature headings", () => {
  it("creates a Core epic from ### Feature headings when no In Scope section", () => {
    const md = [
      "# Simple Product",
      "",
      "### Feature Alpha",
      "- Does alpha things",
      "- Also this",
      "",
      "### Feature Beta",
      "- Does beta things",
    ].join("\n");
    const parsed = parseProductMd(md);
    const allFeatures = parsed.epics.flatMap((e) => e.features);
    expect(allFeatures.length).toBeGreaterThanOrEqual(2);
    const titles = allFeatures.map((f) => f.title);
    expect(titles.some((t) => t.includes("Alpha"))).toBe(true);
    expect(titles.some((t) => t.includes("Beta"))).toBe(true);
  });

  it("includes criteria from Feature headings in fallback mode", () => {
    const md = [
      "# Simple Product",
      "",
      "### Feature Alpha",
      "- Criterion one",
      "- Criterion two",
    ].join("\n");
    const parsed = parseProductMd(md);
    const allFeatures = parsed.epics.flatMap((e) => e.features);
    expect(allFeatures[0].criteria).toContain("Criterion one");
    expect(allFeatures[0].criteria).toContain("Criterion two");
  });
});

// ---------------------------------------------------------------------------
// resume-loop: backlog not found (line 110 – null backlog branch)
// ---------------------------------------------------------------------------

describe("resumeLoop – backlog file missing", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("resumes when state exists but backlog file is missing", async () => {
    const store = new StateStore(tmp);
    store.createInitial();
    store.update({ activeFeature: "F-001", currentPhase: "spec", status: "running" });
    // No backlog file written

    const result = await resumeLoop({ root: tmp, continueAutomatically: false });
    expect(result.resumed).toBe(true);
    expect(result.resolvedPhase).toBe("spec");
  });
});

// ---------------------------------------------------------------------------
// resume-loop: multiple in_progress features (line 117 – reconcile picks state)
// ---------------------------------------------------------------------------

describe("resumeLoop – multiple in_progress features in backlog", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("uses state.activeFeature when backlog has multiple in_progress", async () => {
    const store = new StateStore(tmp);
    store.createInitial();
    store.update({ activeFeature: "F-002", currentPhase: "plan", status: "running" });

    mkdirSync(join(tmp, "docs"), { recursive: true });
    // Simulate backlog inconsistency: both F-001 and F-002 are in_progress
    const backlog: Backlog = {
      ...makeEmptyBacklog(),
      features: [
        { ...makeFeature("F-001"), status: "in_progress" },
        { ...makeFeature("F-002"), status: "in_progress" },
      ],
    };
    writeFileSync(join(tmp, "docs", "product-backlog.yaml"), yaml.dump(backlog), "utf8");

    const result = await resumeLoop({ root: tmp, continueAutomatically: false });
    expect(result.resumed).toBe(true);
    // State wins: activeFeature should be F-002
    expect(result.banner).toContain("F-002");
  });
});

// ---------------------------------------------------------------------------
// resume-loop: reconcile – state has activeFeature but backlog has 0 in_progress (line 52)
// ---------------------------------------------------------------------------

describe("resumeLoop – state has activeFeature but backlog has no in_progress", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns state.activeFeature when backlog has no in_progress features", async () => {
    const store = new StateStore(tmp);
    store.createInitial();
    store.update({ activeFeature: "F-001", currentPhase: "plan", status: "running" });

    mkdirSync(join(tmp, "docs"), { recursive: true });
    // All features are open (none in_progress) but state says F-001 is active
    const backlog: Backlog = {
      ...makeEmptyBacklog(),
      features: [makeFeature("F-001"), makeFeature("F-002")],
    };
    writeFileSync(join(tmp, "docs", "product-backlog.yaml"), yaml.dump(backlog), "utf8");

    const result = await resumeLoop({ root: tmp, continueAutomatically: false });
    expect(result.resumed).toBe(true);
    expect(result.banner).toContain("F-001");
  });
});

// ---------------------------------------------------------------------------
// resume-loop: reconcile – backlog has 1 in_progress different from state (line 117)
// ---------------------------------------------------------------------------

describe("resumeLoop – backlog single in_progress overrides state", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("updates state when backlog has one in_progress different from state.activeFeature", async () => {
    const store = new StateStore(tmp);
    store.createInitial();
    // State says F-001 is active, but backlog says F-002 is in_progress
    store.update({ activeFeature: "F-001", currentPhase: "plan", status: "running" });

    mkdirSync(join(tmp, "docs"), { recursive: true });
    const backlog: Backlog = {
      ...makeEmptyBacklog(),
      features: [
        makeFeature("F-001"),
        { ...makeFeature("F-002"), status: "in_progress" },
      ],
    };
    writeFileSync(join(tmp, "docs", "product-backlog.yaml"), yaml.dump(backlog), "utf8");

    const result = await resumeLoop({ root: tmp, continueAutomatically: false });
    expect(result.resumed).toBe(true);
    // After reconciliation, state should have F-002 as active
    const updatedState = store.read();
    expect(updatedState.activeFeature).toBe("F-002");
  });
});

// ---------------------------------------------------------------------------
// ship-product: phaseResult.error undefined case (uses "Phase runner failed" fallback)
// ---------------------------------------------------------------------------

describe("shipProduct – phase failure without error message", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("uses fallback error message when runner returns no error string", async () => {
    setupProject(tmp, [makeFeature("F-001")], false);
    // Runner returns failure without an error message
    const noErrorRunner: PhaseRunner = async () => ({ success: false, phase: "spec" });
    const result = await shipProduct({ root: tmp, phaseRunner: noErrorRunner, dryRun: true });
    expect(result.failed).toBeGreaterThan(0);
    // The state should record the fallback error
    const store = new StateStore(tmp);
    // After blocking (3 failures), consecutive failures reset but lastError is set from the block
    const state = store.read();
    expect(state.lastError).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// roadmap-generator: sort comparator invoked when ≥2 deps become ready at once
// ---------------------------------------------------------------------------

describe("topologicalSort – sort comparator covers ready items with different priorities", () => {
  function makeRoadmapFeature(
    id: string,
    priority: Feature["priority"],
    dependsOn: string[] = []
  ): Feature {
    return {
      id, title: `Feature ${id}`, epic: "Core", status: "open",
      priority, dependsOn, acceptanceCriteria: [], estimatedComplexity: "medium",
      specKitBranch: "", notes: "",
    };
  }

  it("places high-priority dependent before low-priority one when both become ready simultaneously", () => {
    const features = [
      makeRoadmapFeature("F-A", "medium"),                    // no deps – processed first
      makeRoadmapFeature("F-B", "low", ["F-A"]),              // dep on F-A, low priority
      makeRoadmapFeature("F-C", "high", ["F-A"]),             // dep on F-A, high priority
    ];
    const result = topologicalSort(features);
    const ids = result.map((f) => f.id);
    expect(ids[0]).toBe("F-A");
    // Both F-B and F-C become ready when F-A is processed; sort comparator fires
    // F-C (high) should come before F-B (low)
    expect(ids.indexOf("F-C")).toBeLessThan(ids.indexOf("F-B"));
  });

  it("handles 3 simultaneous ready items sorted by priority", () => {
    const features = [
      makeRoadmapFeature("GATE", "high"),
      makeRoadmapFeature("R-LOW", "low", ["GATE"]),
      makeRoadmapFeature("R-MED", "medium", ["GATE"]),
      makeRoadmapFeature("R-HIGH", "high", ["GATE"]),
    ];
    const result = topologicalSort(features);
    const ids = result.map((f) => f.id);
    expect(ids[0]).toBe("GATE");
    expect(ids[1]).toBe("R-HIGH");
    expect(ids[2]).toBe("R-MED");
    expect(ids[3]).toBe("R-LOW");
  });
});

// ---------------------------------------------------------------------------
// resume-loop: corrupt backlog YAML → catch branch (line 110)
// ---------------------------------------------------------------------------

describe("resumeLoop – corrupt backlog YAML triggers catch branch", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("falls back to state.activeFeature when backlog YAML is corrupt", async () => {
    const store = new StateStore(tmp);
    store.createInitial();
    store.update({ activeFeature: "F-001", currentPhase: "spec", status: "running" });

    mkdirSync(join(tmp, "docs"), { recursive: true });
    // Write corrupt YAML – existsSync returns true but readBacklog throws
    writeFileSync(join(tmp, "docs", "product-backlog.yaml"), "{ corrupted: yaml: [invalid", "utf8");

    const result = await resumeLoop({ root: tmp, continueAutomatically: false });
    expect(result.resumed).toBe(true);
    expect(result.banner).toContain("F-001");
  });
});

// ---------------------------------------------------------------------------
// backlog-schema: featureNextId with non-standard IDs (line 77 `: 0` branch)
// ---------------------------------------------------------------------------

describe("featureNextId – non-standard ID format returns 0 for that feature", () => {
  it("treats non-F-NNN IDs as 0 and returns F-001", () => {
    const backlog = makeEmptyBacklog();
    backlog.features = [{
      id: "CUSTOM-001", title: "Custom", epic: "E", status: "open",
      priority: "medium", dependsOn: [], acceptanceCriteria: [],
      estimatedComplexity: "medium", specKitBranch: "", notes: "",
    }];
    expect(featureNextId(backlog)).toBe("F-001");
  });
});

// ---------------------------------------------------------------------------
// ship-product: makeDefaultPhaseRunner – ternary branches (lines 71-74)
// ---------------------------------------------------------------------------

describe("makeDefaultPhaseRunner – branch coverage", () => {
  it("uses startIdx=0 (default) when startFromPhase is not provided", async () => {
    const runner = makeDefaultPhaseRunner();
    // No startFromPhase → hits the `: 0` branch on line 71
    const result = await runner({ root: "/tmp", featureId: "F-001", featureTitle: "Test", dryRun: true });
    expect(result.success).toBe(true);
    expect(result.phase).toBe("implement");
  });

  it("falls back to full phases list when startFromPhase is not in the phases array", async () => {
    const runner = makeDefaultPhaseRunner();
    // "qa" is not in the internal phases array → startIdx = -1 → activePhases = phases (line 72)
    const result = await runner({ root: "/tmp", featureId: "F-001", featureTitle: "Test", startFromPhase: "qa", dryRun: true });
    expect(result.success).toBe(true);
    // With full phases list, last phase is "implement"
    expect(result.phase).toBe("implement");
  });

  it("slices from the given start phase when valid", async () => {
    const runner = makeDefaultPhaseRunner();
    // "plan" is in the array → startIdx > 0 → sliced subset
    const result = await runner({ root: "/tmp", featureId: "F-001", featureTitle: "Test", startFromPhase: "plan", dryRun: true });
    expect(result.success).toBe(true);
    expect(result.phase).toBe("implement");
  });
});

// ---------------------------------------------------------------------------
// ship-product: called without dryRun (default false branch on line 96)
// ---------------------------------------------------------------------------

describe("shipProduct – default dryRun=false path", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("uses dryRun=false by default (covers default parameter branch)", async () => {
    setupProject(tmp, [], false);
    // dryRun not passed → defaults to false; empty backlog → immediate empty_backlog result
    const result = await shipProduct({ root: tmp, phaseRunner: makeSuccessRunner() });
    expect(result.finalStatus).toBe("empty_backlog");
  });
});

// ---------------------------------------------------------------------------
// ship-feature: backlog exists but state does not (line 80 – createInitial branch)
// ---------------------------------------------------------------------------

describe("shipFeature – state file missing when backlog exists", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("creates initial state when backlog exists but state file is absent", async () => {
    mkdirSync(join(tmp, "docs"), { recursive: true });
    const backlog: Backlog = { ...makeEmptyBacklog(), features: [makeFeature("F-001")] };
    writeFileSync(join(tmp, "docs", "product-backlog.yaml"), yaml.dump(backlog), "utf8");
    // No state file created → shipFeature must call store.createInitial (line 80)

    const result = await shipFeature({
      root: tmp,
      phaseRunner: makeSuccessRunner(),
      dryRun: true,
    });
    // Should succeed (or fail gracefully); importantly, no crash on missing state
    expect(result.featureId).toBe("F-001");
  });
});

// ---------------------------------------------------------------------------
// ship-feature: standalone brownfield with failing phase runner (line 246)
// ---------------------------------------------------------------------------

describe("shipFeature – standalone brownfield phase failure (line 246)", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns failure when standalone phase runner fails", async () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src", "index.ts"), "export {};", "utf8");
    const pkg = { name: "app", version: "1.0.0", dependencies: { express: "^4" }, devDependencies: {} };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg), "utf8");
    // No backlog → triggers runStandaloneFeature path

    const result = await shipFeature({
      root: tmp,
      featureTarget: "Standalone Feature",
      phaseRunner: makeFailRunner(),
      dryRun: true,
    });
    expect(result.success).toBe(false);
    expect(result.featureId).toBe("standalone");
    expect(result.error).toBe("spec failed");
  });
});

// ---------------------------------------------------------------------------
// acceptance-gate: checkAcceptanceItems with items=undefined (line 144 ?? branch)
// ---------------------------------------------------------------------------

describe("checkAcceptanceItems – items field missing (items ?? [] branch)", () => {
  it("treats missing items as empty array and passes", () => {
    // Cast to bypass TypeScript's requirement for items field
    const criteria = { requireLintPass: false, requireTestsPass: false, minCoverage: null } as Parameters<typeof checkAcceptanceItems>[0];
    const result = checkAcceptanceItems(criteria);
    expect(result.passed).toBe(true);
    expect(result.details).toContain("done");
  });
});

// ---------------------------------------------------------------------------
// brownfield-snapshot: pkg without dependencies/devDependencies fields
// Covers ?? {} fallback branches in detectFrameworks, detectTestFramework,
// buildBrownfieldSnapshot (lines 88-89, 114-115, 198-200)
// ---------------------------------------------------------------------------

describe("buildBrownfieldSnapshot – pkg without dependencies or devDependencies fields", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("handles pkg with no dependencies or devDependencies (covers ?? {} branches)", () => {
    // Only name/version – no dependencies or devDependencies keys at all
    const pkg = { name: "minimal-app", version: "1.0.0" };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg), "utf8");
    const snap = buildBrownfieldSnapshot(tmp, "Feature");
    expect(snap.techStack.frameworks).toEqual([]);
    expect(snap.testFramework).toBeNull();
    expect(snap.techStack.buildTools).toEqual([]);
  });

  it("handles pkg with devDependencies but no dependencies field", () => {
    const pkg = { name: "app", version: "1.0.0", devDependencies: { jest: "^29" } };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg), "utf8");
    const snap = buildBrownfieldSnapshot(tmp, "Feature");
    expect(snap.testFramework?.name).toBe("Jest");
  });
});

// ---------------------------------------------------------------------------
// brownfield-snapshot: deep directory trees cover depth>3 and depth>maxDepth
// (lines 61-65 in detectLanguages, line 162 in getDirectoryTree)
// ---------------------------------------------------------------------------

describe("buildBrownfieldSnapshot – deep directory structures", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("depth > 3 causes early return in detectLanguages without crashing", () => {
    // Create 5 levels deep: root/a/b/c/d/deep.ts (depth 4 > 3)
    const deep = join(tmp, "a", "b", "c", "d");
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, "deep.ts"), "export {};", "utf8");
    // Should not throw; the file at depth 4 is simply skipped
    const snap = buildBrownfieldSnapshot(tmp, "Feature");
    expect(snap).toBeDefined();
  });

  it("directory tree walk triggers depth > maxDepth early return", () => {
    // Create 4 levels deep: root/l1/l2/l3/file.ts (depth 3 > maxDepth=2)
    const deep = join(tmp, "l1", "l2", "l3");
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, "file.ts"), "export {};", "utf8");
    const snap = buildBrownfieldSnapshot(tmp, "Feature");
    // projectStructure should exist but not include depth-3 file
    expect(snap.projectStructure).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// brownfield-snapshot: isBrownfieldRepo with pkg having no deps/devDeps fields
// (lines 316-317 ?? {} branches)
// ---------------------------------------------------------------------------

describe("isBrownfieldRepo – pkg without deps/devDeps fields", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns false when pkg has no dependencies or devDependencies", () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src", "index.ts"), "export {};", "utf8");
    const pkg = { name: "app", version: "1.0.0" };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg), "utf8");
    // hasSrc=true but hasDeps=false (both ?? {} fallbacks hit with length=0)
    expect(isBrownfieldRepo(tmp)).toBe(false);
  });
});
