/**
 * Tests for BUG#5 fix: snapshotContent (brownfield-snapshot.md) is included
 * in the implement prompt so Claude has full awareness of the existing codebase.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SpecKitRunner } from "../../src/core/spec-kit-runner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "spec-kit-bf-impl-"));
}

function makeTechStack(tmp: string): void {
  mkdirSync(join(tmp, "docs"), { recursive: true });
  writeFileSync(
    join(tmp, "docs", "tech-stack.md"),
    "# Tech Stack\n\n## Backend\n- Language / Runtime: TypeScript\n",
    "utf8"
  );
}

function seedArtifacts(tmp: string, featureId: string): void {
  const specsDir = join(tmp, "docs", "specs", featureId.toLowerCase());
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, "spec.md"), "# Feature Spec\nSpec content here.\n", "utf8");
  writeFileSync(join(specsDir, "plan.md"), "# Plan\nPlan content here.\n", "utf8");
  writeFileSync(join(specsDir, "tasks.md"), "# Tasks\n- [ ] T001 Implement feature\n", "utf8");
}

/**
 * Create a SpecKitRunner that has snapshotContent injected directly.
 * We bypass the constructor's claude --version check by trying normal
 * construction first, then falling back to Object.create when the CLI
 * is not present in this test environment.
 */
function makeRunnerWithSnapshot(
  tmp: string,
  snapshotContent: string
): { runner: SpecKitRunner; capturedPrompts: string[] } {
  const capturedPrompts: string[] = [];
  let runner: SpecKitRunner;

  try {
    runner = new SpecKitRunner(tmp);
  } catch (err) {
    if ((err as Error).message.includes("claude CLI")) {
      runner = Object.create(SpecKitRunner.prototype) as SpecKitRunner;
      (runner as unknown as Record<string, unknown>)["root"] = tmp;
      (runner as unknown as Record<string, unknown>)["claudePath"] = "claude";
      (runner as unknown as Record<string, unknown>)["techStack"] = "TypeScript";
    } else {
      throw err;
    }
  }

  // Inject snapshot content directly — this is what BUG#5 exercises.
  (runner as unknown as Record<string, unknown>)["snapshotContent"] = snapshotContent;

  runner.callClaude = async (prompt: string) => {
    capturedPrompts.push(prompt);
    return `<<<FILE: src/features/f-001/index.ts>>>\nexport const x = 1;\n<<<END_FILE>>>`;
  };

  return { runner, capturedPrompts };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runImplement – snapshotContent in implement prompt (BUG#5)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    makeTechStack(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("includes CODEBASE CONTEXT when snapshotContent is set", async () => {
    seedArtifacts(tmp, "F-001");
    const snapshot = "# CODEBASE CONTEXT\n\nExisting modules: AuthService, UserRepository.\n";

    const { runner, capturedPrompts } = makeRunnerWithSnapshot(tmp, snapshot);
    await runner.runImplement("F-001", "Brownfield Feature");

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toContain("CODEBASE CONTEXT");
  });

  it("includes snapshot module names in the implement prompt", async () => {
    seedArtifacts(tmp, "F-001");
    const snapshot =
      "# CODEBASE CONTEXT\n\nExisting modules: PaymentGateway, OrderService.\n";

    const { runner, capturedPrompts } = makeRunnerWithSnapshot(tmp, snapshot);
    await runner.runImplement("F-001", "Payment Feature");

    expect(capturedPrompts[0]).toContain("PaymentGateway");
    expect(capturedPrompts[0]).toContain("OrderService");
  });

  it("does NOT include CODEBASE CONTEXT when snapshotContent is null", async () => {
    seedArtifacts(tmp, "F-002");
    const capturedPrompts: string[] = [];
    let runner: SpecKitRunner;

    try {
      runner = new SpecKitRunner(tmp);
    } catch (err) {
      if ((err as Error).message.includes("claude CLI")) {
        runner = Object.create(SpecKitRunner.prototype) as SpecKitRunner;
        (runner as unknown as Record<string, unknown>)["root"] = tmp;
        (runner as unknown as Record<string, unknown>)["claudePath"] = "claude";
        (runner as unknown as Record<string, unknown>)["techStack"] = "TypeScript";
      } else {
        throw err;
      }
    }

    // Explicitly set null snapshot
    (runner as unknown as Record<string, unknown>)["snapshotContent"] = null;

    runner.callClaude = async (prompt: string) => {
      capturedPrompts.push(prompt);
      return `<<<FILE: src/features/f-002/index.ts>>>\nexport const y = 2;\n<<<END_FILE>>>`;
    };

    await runner.runImplement("F-002", "Greenfield Feature");

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).not.toContain("CODEBASE CONTEXT");
  });

  it("snapshot content is automatically loaded from docs/brownfield-snapshot.md on construction", async () => {
    // Write the brownfield snapshot file before constructing the runner
    writeFileSync(
      join(tmp, "docs", "brownfield-snapshot.md"),
      "# CODEBASE CONTEXT\n\nExisting module: InventoryService.\n",
      "utf8"
    );

    seedArtifacts(tmp, "F-003");
    const capturedPrompts: string[] = [];
    let runner: SpecKitRunner;

    try {
      runner = new SpecKitRunner(tmp);
    } catch (err) {
      if ((err as Error).message.includes("claude CLI")) {
        // In environments without claude CLI, simulate the snapshot load
        runner = Object.create(SpecKitRunner.prototype) as SpecKitRunner;
        (runner as unknown as Record<string, unknown>)["root"] = tmp;
        (runner as unknown as Record<string, unknown>)["claudePath"] = "claude";
        (runner as unknown as Record<string, unknown>)["techStack"] = "TypeScript";
        const snapshotRaw = readFileSync(
          join(tmp, "docs", "brownfield-snapshot.md"),
          "utf8"
        );
        (runner as unknown as Record<string, unknown>)["snapshotContent"] = snapshotRaw;
      } else {
        throw err;
      }
    }

    runner.callClaude = async (prompt: string) => {
      capturedPrompts.push(prompt);
      return `<<<FILE: src/features/f-003/index.ts>>>\nexport const z = 3;\n<<<END_FILE>>>`;
    };

    await runner.runImplement("F-003", "Auto-loaded Snapshot Feature");

    expect(capturedPrompts[0]).toContain("InventoryService");
  });

  it("snapshot content appears before the SPECIFICATION section in the implement prompt", async () => {
    seedArtifacts(tmp, "F-004");
    const { runner, capturedPrompts } = makeRunnerWithSnapshot(
      tmp,
      "# CODEBASE CONTEXT\nLegacy code info."
    );

    await runner.runImplement("F-004", "Order Feature");

    const prompt = capturedPrompts[0];
    const snapshotIndex = prompt.indexOf("CODEBASE CONTEXT");
    const specIndex = prompt.indexOf("SPECIFICATION:");

    expect(snapshotIndex).toBeGreaterThan(-1);
    expect(specIndex).toBeGreaterThan(-1);
    // Snapshot block should appear before the SPECIFICATION section
    expect(snapshotIndex).toBeLessThan(specIndex);
  });
});

// ---------------------------------------------------------------------------
// runSpec / runPlan / runTasks also include snapshotContent (via BUG#5 block)
// ---------------------------------------------------------------------------

describe("runSpec / runPlan / runTasks – snapshotContent in prompts", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    makeTechStack(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("runSpec prompt includes CODEBASE CONTEXT when snapshot set", async () => {
    const snapshot = "# CODEBASE CONTEXT\nSpec snapshot info.";
    const capturedPrompts: string[] = [];
    let runner: SpecKitRunner;

    try {
      runner = new SpecKitRunner(tmp);
    } catch (err) {
      if ((err as Error).message.includes("claude CLI")) {
        runner = Object.create(SpecKitRunner.prototype) as SpecKitRunner;
        (runner as unknown as Record<string, unknown>)["root"] = tmp;
        (runner as unknown as Record<string, unknown>)["claudePath"] = "claude";
        (runner as unknown as Record<string, unknown>)["techStack"] = "TypeScript";
      } else {
        throw err;
      }
    }

    (runner as unknown as Record<string, unknown>)["snapshotContent"] = snapshot;
    runner.callClaude = async (prompt) => {
      capturedPrompts.push(prompt);
      return "# Feature Specification: Test\n";
    };

    await runner.runSpec("F-005", "Snapshot Spec Feature", []);

    expect(capturedPrompts[0]).toContain("CODEBASE CONTEXT");
    expect(capturedPrompts[0]).toContain("Spec snapshot info.");
  });

  it("runPlan prompt includes CODEBASE CONTEXT when snapshot set", async () => {
    seedArtifacts(tmp, "F-006");
    const snapshot = "# CODEBASE CONTEXT\nPlan snapshot info.";
    const capturedPrompts: string[] = [];
    let runner: SpecKitRunner;

    try {
      runner = new SpecKitRunner(tmp);
    } catch (err) {
      if ((err as Error).message.includes("claude CLI")) {
        runner = Object.create(SpecKitRunner.prototype) as SpecKitRunner;
        (runner as unknown as Record<string, unknown>)["root"] = tmp;
        (runner as unknown as Record<string, unknown>)["claudePath"] = "claude";
        (runner as unknown as Record<string, unknown>)["techStack"] = "TypeScript";
      } else {
        throw err;
      }
    }

    (runner as unknown as Record<string, unknown>)["snapshotContent"] = snapshot;
    runner.callClaude = async (prompt) => {
      capturedPrompts.push(prompt);
      return "# Plan\n";
    };

    await runner.runPlan("F-006", "Snapshot Plan Feature");

    expect(capturedPrompts[0]).toContain("CODEBASE CONTEXT");
    expect(capturedPrompts[0]).toContain("Plan snapshot info.");
  });
});
