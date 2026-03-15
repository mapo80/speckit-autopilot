/**
 * Tests for BUG#4 fix: acceptanceCriteria are included in the prompts
 * for runPlan, runTasks, and runImplement phases.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SpecKitRunner } from "../../src/core/spec-kit-runner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "spec-kit-ac-"));
}

function makeTechStack(tmp: string): void {
  mkdirSync(join(tmp, "docs"), { recursive: true });
  writeFileSync(
    join(tmp, "docs", "tech-stack.md"),
    "# Tech Stack\n\n## Backend\n- Language / Runtime: TypeScript\n",
    "utf8"
  );
}

/**
 * Build a runner with a prompt-capturing callClaude.
 * Returns both the runner and an array that accumulates every prompt received.
 */
function makeCapturingRunner(
  tmp: string,
  responseFactory: (prompt: string) => string = () => "# Response\nContent."
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
      (runner as unknown as Record<string, unknown>)["snapshotContent"] = null;
      (runner as unknown as Record<string, unknown>)["techStack"] = "TypeScript";
    } else {
      throw err;
    }
  }

  runner.callClaude = async (prompt: string) => {
    capturedPrompts.push(prompt);
    return responseFactory(prompt);
  };

  return { runner, capturedPrompts };
}

function seedSpec(tmp: string, featureId: string): void {
  const specsDir = join(tmp, "docs", "specs", featureId.toLowerCase());
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, "spec.md"), "# Feature Spec\nRequirements here.\n", "utf8");
  writeFileSync(join(specsDir, "plan.md"), "# Plan\nPlan content.\n", "utf8");
  writeFileSync(join(specsDir, "tasks.md"), "# Tasks\n- [ ] T001 Do work\n", "utf8");
}

// ---------------------------------------------------------------------------
// runSpec – acceptanceCriteria in prompt
// ---------------------------------------------------------------------------

describe("runSpec – acceptanceCriteria in prompt", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    makeTechStack(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("includes acceptance criteria in the spec prompt", async () => {
    const criteria = ["must do X", "must do Y"];
    const { runner, capturedPrompts } = makeCapturingRunner(tmp);

    await runner.runSpec("F-001", "Spec Feature", criteria);

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toContain("must do X");
    expect(capturedPrompts[0]).toContain("must do Y");
  });

  it("includes the Acceptance Criteria header when criteria are provided", async () => {
    const criteria = ["must authenticate users"];
    const { runner, capturedPrompts } = makeCapturingRunner(tmp);

    await runner.runSpec("F-001", "Auth Feature", criteria);

    expect(capturedPrompts[0]).toContain("Acceptance Criteria");
  });

  it("omits Acceptance Criteria block when criteria array is empty", async () => {
    const { runner, capturedPrompts } = makeCapturingRunner(tmp);

    await runner.runSpec("F-001", "Empty Criteria Feature", []);

    // With zero criteria the block builder returns "" so the heading won't appear
    expect(capturedPrompts[0]).not.toContain("Acceptance Criteria (must all be satisfied)");
  });
});

// ---------------------------------------------------------------------------
// runPlan – acceptanceCriteria in prompt
// ---------------------------------------------------------------------------

describe("runPlan – acceptanceCriteria in prompt", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    makeTechStack(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("includes all criteria in the plan prompt", async () => {
    seedSpec(tmp, "F-002");
    const criteria = ["must do X", "must do Y"];
    const { runner, capturedPrompts } = makeCapturingRunner(tmp);

    await runner.runPlan("F-002", "Plan Feature", criteria);

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toContain("must do X");
    expect(capturedPrompts[0]).toContain("must do Y");
  });

  it("includes Acceptance Criteria section header in plan prompt", async () => {
    seedSpec(tmp, "F-002");
    const { runner, capturedPrompts } = makeCapturingRunner(tmp);

    await runner.runPlan("F-002", "Plan Feature", ["must validate input"]);

    expect(capturedPrompts[0]).toContain("Acceptance Criteria");
    expect(capturedPrompts[0]).toContain("must validate input");
  });

  it("criteria appear as bullet items in the plan prompt", async () => {
    seedSpec(tmp, "F-002");
    const { runner, capturedPrompts } = makeCapturingRunner(tmp);

    await runner.runPlan("F-002", "Bullets Feature", ["criterion alpha", "criterion beta"]);

    expect(capturedPrompts[0]).toContain("- criterion alpha");
    expect(capturedPrompts[0]).toContain("- criterion beta");
  });

  it("throws when spec.md is missing (BUG#12 guard)", async () => {
    // No seedSpec call — spec.md does not exist
    const { runner } = makeCapturingRunner(tmp);

    await expect(runner.runPlan("F-NOSPEC", "No Spec Feature", ["criterion"])).rejects.toThrow(
      /spec\.md not found/
    );
  });
});

// ---------------------------------------------------------------------------
// runTasks – acceptanceCriteria in prompt
// ---------------------------------------------------------------------------

describe("runTasks – acceptanceCriteria in prompt", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    makeTechStack(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("includes all criteria in the tasks prompt", async () => {
    seedSpec(tmp, "F-003");
    const criteria = ["must do X", "must do Y"];
    const { runner, capturedPrompts } = makeCapturingRunner(tmp);

    await runner.runTasks("F-003", "Tasks Feature", criteria);

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toContain("must do X");
    expect(capturedPrompts[0]).toContain("must do Y");
  });

  it("criteria appear with bullet formatting in tasks prompt", async () => {
    seedSpec(tmp, "F-003");
    const { runner, capturedPrompts } = makeCapturingRunner(tmp);

    await runner.runTasks("F-003", "Bullet Tasks Feature", ["handle errors gracefully"]);

    expect(capturedPrompts[0]).toContain("- handle errors gracefully");
  });

  it("includes Acceptance Criteria header in tasks prompt", async () => {
    seedSpec(tmp, "F-003");
    const { runner, capturedPrompts } = makeCapturingRunner(tmp);

    await runner.runTasks("F-003", "AC Header Feature", ["must support pagination"]);

    expect(capturedPrompts[0]).toContain("Acceptance Criteria");
  });

  it("handles empty criteria gracefully in tasks prompt (no header emitted)", async () => {
    seedSpec(tmp, "F-003");
    const { runner, capturedPrompts } = makeCapturingRunner(tmp);

    await runner.runTasks("F-003", "Empty Tasks Feature", []);

    expect(capturedPrompts[0]).not.toContain("Acceptance Criteria (must all be satisfied)");
  });
});

// ---------------------------------------------------------------------------
// runImplement – acceptanceCriteria in prompt
// ---------------------------------------------------------------------------

describe("runImplement – acceptanceCriteria in prompt", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    makeTechStack(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("includes all criteria in the implement prompt", async () => {
    seedSpec(tmp, "F-004");
    const criteria = ["must do X", "must do Y"];

    const capturedPrompts: string[] = [];
    const { runner } = makeCapturingRunner(tmp);
    runner.callClaude = async (prompt) => {
      capturedPrompts.push(prompt);
      return `<<<FILE: src/features/f-004/index.ts>>>\nexport const x = 1;\n<<<END_FILE>>>`;
    };

    await runner.runImplement("F-004", "Implement Feature", criteria);

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toContain("must do X");
    expect(capturedPrompts[0]).toContain("must do Y");
  });

  it("criteria appear as bullet items in implement prompt", async () => {
    seedSpec(tmp, "F-004");
    const capturedPrompts: string[] = [];
    const { runner } = makeCapturingRunner(tmp);
    runner.callClaude = async (prompt) => {
      capturedPrompts.push(prompt);
      return `<<<FILE: src/features/f-004/index.ts>>>\nexport const z = 3;\n<<<END_FILE>>>`;
    };

    await runner.runImplement("F-004", "Bullet Impl Feature", ["process events asynchronously"]);

    expect(capturedPrompts[0]).toContain("- process events asynchronously");
  });

  it("implement prompt includes Acceptance Criteria header when criteria provided", async () => {
    seedSpec(tmp, "F-004");
    const capturedPrompts: string[] = [];
    const { runner } = makeCapturingRunner(tmp);
    runner.callClaude = async (prompt) => {
      capturedPrompts.push(prompt);
      return `<<<FILE: src/features/f-004/index.ts>>>\nexport const a = 1;\n<<<END_FILE>>>`;
    };

    await runner.runImplement("F-004", "AC Impl Feature", ["must log all errors"]);

    expect(capturedPrompts[0]).toContain("Acceptance Criteria");
    expect(capturedPrompts[0]).toContain("must log all errors");
  });
});
