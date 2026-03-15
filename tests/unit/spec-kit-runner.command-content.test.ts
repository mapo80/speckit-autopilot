/**
 * Tests for BUG#3 fix: commandContent (from .claude/commands/*.md) is now
 * included in prompts for all phases. When the file is absent a fallback
 * string is used instead.
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
  return mkdtempSync(join(tmpdir(), "spec-kit-cmd-content-"));
}

function makeTechStack(tmp: string): void {
  mkdirSync(join(tmp, "docs"), { recursive: true });
  writeFileSync(
    join(tmp, "docs", "tech-stack.md"),
    "# Tech Stack\n\n## Backend\n- Language / Runtime: TypeScript\n",
    "utf8"
  );
}

function makeRunner(tmp: string): { runner: SpecKitRunner; capturedPrompts: string[] } {
  let runner: SpecKitRunner;
  const capturedPrompts: string[] = [];

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
    return "# Response\nContent.";
  };

  return { runner, capturedPrompts };
}

function writeCommandFile(tmp: string, name: string, content: string): void {
  const dir = join(tmp, ".claude", "commands");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), content, "utf8");
}

function seedSpec(tmp: string, featureId: string): void {
  const specsDir = join(tmp, "docs", "specs", featureId.toLowerCase());
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, "spec.md"), "# Spec\nExisting specification content.\n", "utf8");
  writeFileSync(join(specsDir, "plan.md"), "# Plan\nExisting plan content.\n", "utf8");
  writeFileSync(join(specsDir, "tasks.md"), "# Tasks\n- [ ] T001 Do work\n", "utf8");
}

// ---------------------------------------------------------------------------
// speckit.specify command content in spec prompt
// ---------------------------------------------------------------------------

describe("runSpec – commandContent in prompt", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    makeTechStack(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("includes command file content in spec prompt when speckit.specify.md exists", async () => {
    writeCommandFile(tmp, "speckit.specify", "SPECIFY COMMAND: Use BDD format with Given/When/Then.");

    const { runner, capturedPrompts } = makeRunner(tmp);
    await runner.runSpec("F-001", "Test Feature", []);

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toContain("SPECIFY COMMAND: Use BDD format with Given/When/Then.");
  });

  it("includes fallback text in spec prompt when speckit.specify.md is absent", async () => {
    // No command file written
    const { runner, capturedPrompts } = makeRunner(tmp);
    await runner.runSpec("F-001", "Test Feature", []);

    expect(capturedPrompts).toHaveLength(1);
    // The fallback string defined in runSpec
    expect(capturedPrompts[0]).toContain("Create a feature specification");
  });

  it("command content appears in ## SpecKit Instructions section", async () => {
    writeCommandFile(tmp, "speckit.specify", "Unique-marker-XYZ-specify.");

    const { runner, capturedPrompts } = makeRunner(tmp);
    await runner.runSpec("F-001", "Test Feature", []);

    expect(capturedPrompts[0]).toContain("SpecKit Instructions");
    expect(capturedPrompts[0]).toContain("Unique-marker-XYZ-specify.");
  });
});

// ---------------------------------------------------------------------------
// speckit.plan command content in plan prompt
// ---------------------------------------------------------------------------

describe("runPlan – commandContent in prompt", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    makeTechStack(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("includes command file content in plan prompt when speckit.plan.md exists", async () => {
    writeCommandFile(tmp, "speckit.plan", "PLAN COMMAND: Always include a risk matrix.");
    seedSpec(tmp, "F-002");

    const { runner, capturedPrompts } = makeRunner(tmp);
    await runner.runPlan("F-002", "Plan Feature");

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toContain("PLAN COMMAND: Always include a risk matrix.");
  });

  it("uses fallback text in plan prompt when speckit.plan.md is absent", async () => {
    seedSpec(tmp, "F-002");

    const { runner, capturedPrompts } = makeRunner(tmp);
    await runner.runPlan("F-002", "Plan Feature");

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toContain("Create an implementation plan");
  });
});

// ---------------------------------------------------------------------------
// speckit.tasks command content in tasks prompt
// ---------------------------------------------------------------------------

describe("runTasks – commandContent in prompt", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    makeTechStack(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("includes command file content in tasks prompt when speckit.tasks.md exists", async () => {
    writeCommandFile(tmp, "speckit.tasks", "TASKS COMMAND: Each task must have an estimated duration.");
    seedSpec(tmp, "F-003");

    const { runner, capturedPrompts } = makeRunner(tmp);
    await runner.runTasks("F-003", "Tasks Feature");

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toContain("TASKS COMMAND: Each task must have an estimated duration.");
  });

  it("uses fallback text in tasks prompt when speckit.tasks.md is absent", async () => {
    seedSpec(tmp, "F-003");

    const { runner, capturedPrompts } = makeRunner(tmp);
    await runner.runTasks("F-003", "Tasks Feature");

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toContain("Generate actionable tasks");
  });
});

// ---------------------------------------------------------------------------
// speckit.implement command content in implement prompt
// ---------------------------------------------------------------------------

describe("runImplement – commandContent in prompt", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    makeTechStack(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("includes command file content in implement prompt when speckit.implement.md exists", async () => {
    writeCommandFile(
      tmp,
      "speckit.implement",
      "IMPLEMENT COMMAND: Always add JSDoc comments to public exports."
    );
    seedSpec(tmp, "F-004");

    const { runner, capturedPrompts } = makeRunner(tmp);
    // Provide FILE blocks so runImplement does not throw (git mocking not available here)
    runner.callClaude = async (prompt) => {
      capturedPrompts.push(prompt);
      return `<<<FILE: src/features/f-004/index.ts>>>\nexport const x = 1;\n<<<END_FILE>>>`;
    };

    await runner.runImplement("F-004", "Implement Feature");

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toContain("IMPLEMENT COMMAND: Always add JSDoc comments to public exports.");
  });

  it("uses fallback text in implement prompt when speckit.implement.md is absent", async () => {
    seedSpec(tmp, "F-004");

    const { runner, capturedPrompts } = makeRunner(tmp);
    runner.callClaude = async (prompt) => {
      capturedPrompts.push(prompt);
      return `<<<FILE: src/features/f-004/index.ts>>>\nexport const x = 1;\n<<<END_FILE>>>`;
    };

    await runner.runImplement("F-004", "Implement Feature");

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toContain("Implement all tasks from tasks.md");
  });

  it("command content appears alongside the FEATURE label in implement prompt", async () => {
    writeCommandFile(tmp, "speckit.implement", "UNIQUE-IMPL-TOKEN-789.");
    seedSpec(tmp, "F-005");

    const { runner, capturedPrompts } = makeRunner(tmp);
    runner.callClaude = async (prompt) => {
      capturedPrompts.push(prompt);
      return `<<<FILE: src/features/f-005/index.ts>>>\nexport const y = 2;\n<<<END_FILE>>>`;
    };

    await runner.runImplement("F-005", "Token Feature");

    expect(capturedPrompts[0]).toContain("UNIQUE-IMPL-TOKEN-789.");
    expect(capturedPrompts[0]).toContain("FEATURE: Token Feature");
  });
});
