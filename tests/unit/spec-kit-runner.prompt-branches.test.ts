/**
 * Tests for uncovered prompt-builder branches in spec-kit-runner.ts.
 * These test the indirectly exercised paths through runSpec/runPlan/runTasks/runImplement:
 * - buildSnapshotBlock with null vs content
 * - buildCriteriaBlock with empty vs populated array
 * - buildCommandBlock with null vs content
 * - fallback text when template files are missing
 *
 * Uses the callClaude spy approach (same pattern as spec-kit-runner-mocked.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Mock child_process so the SpecKitRunner constructor (--version check) does
// not require a real claude CLI installation.
// ---------------------------------------------------------------------------

const mockSpawnSync = jest.fn();
const mockSpawn = jest.fn();

await jest.unstable_mockModule("child_process", () => ({
  spawnSync: mockSpawnSync,
  spawn: mockSpawn,
}));

const { SpecKitRunner } = await import("../../src/core/spec-kit-runner.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "skr-prompt-"));
}

function setupTechStack(root: string): void {
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "docs", "tech-stack.md"),
    "# Tech Stack\n\n## Backend\n- Language / Runtime: TypeScript\n",
    "utf8"
  );
}

function makeRunner(root: string): InstanceType<typeof SpecKitRunner> {
  // Mock claude --version to succeed
  mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: "claude 1.0.0", stderr: "" });
  return new SpecKitRunner(root);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runSpec – prompt content without snapshot (buildSnapshotBlock null path)", () => {
  let tmp: string;
  let capturedPrompts: string[];

  beforeEach(() => {
    tmp = makeTmp();
    setupTechStack(tmp);
    capturedPrompts = [];
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("prompt does NOT contain 'CODEBASE CONTEXT' when no brownfield snapshot exists", async () => {
    const runner = makeRunner(tmp);
    runner.callClaude = jest.fn(async (prompt: string) => {
      capturedPrompts.push(prompt);
      return "# Feature Specification: Test Feature\n\nSome spec content.";
    }) as typeof runner.callClaude;

    await runner.runSpec("F-001", "Test Feature", []);
    expect(capturedPrompts.length).toBe(1);
    expect(capturedPrompts[0]).not.toContain("CODEBASE CONTEXT");
  });

  it("prompt contains 'CODEBASE CONTEXT' when brownfield snapshot exists", async () => {
    // Write a brownfield snapshot
    writeFileSync(join(tmp, "docs", "brownfield-snapshot.md"), "# Existing Codebase\n\nSome context.", "utf8");

    const runner = makeRunner(tmp);
    runner.callClaude = jest.fn(async (prompt: string) => {
      capturedPrompts.push(prompt);
      return "# Feature Specification: Test Feature\n\nSome spec content.";
    }) as typeof runner.callClaude;

    await runner.runSpec("F-001", "Test Feature", []);
    expect(capturedPrompts.length).toBe(1);
    expect(capturedPrompts[0]).toContain("CODEBASE CONTEXT");
    expect(capturedPrompts[0]).toContain("Existing Codebase");
  });
});

describe("runSpec – buildCriteriaBlock paths", () => {
  let tmp: string;
  let capturedPrompts: string[];

  beforeEach(() => {
    tmp = makeTmp();
    setupTechStack(tmp);
    capturedPrompts = [];
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("prompt does NOT contain 'Acceptance Criteria' section when criteria array is empty", async () => {
    const runner = makeRunner(tmp);
    runner.callClaude = jest.fn(async (prompt: string) => {
      capturedPrompts.push(prompt);
      return "# Feature Specification: Empty Criteria\n\nSpec.";
    }) as typeof runner.callClaude;

    await runner.runSpec("F-001", "Empty Criteria", []);
    expect(capturedPrompts[0]).not.toContain("Acceptance Criteria (must all be satisfied)");
  });

  it("prompt contains 'Acceptance Criteria' section when criteria array is populated", async () => {
    const runner = makeRunner(tmp);
    runner.callClaude = jest.fn(async (prompt: string) => {
      capturedPrompts.push(prompt);
      return "# Feature Specification: Has Criteria\n\nSpec.";
    }) as typeof runner.callClaude;

    await runner.runSpec("F-001", "Has Criteria", ["User can login", "User sees dashboard"]);
    expect(capturedPrompts[0]).toContain("Acceptance Criteria (must all be satisfied)");
    expect(capturedPrompts[0]).toContain("- User can login");
    expect(capturedPrompts[0]).toContain("- User sees dashboard");
  });
});

describe("runSpec – fallback text when specTemplate is missing (buildCommandBlock null)", () => {
  let tmp: string;
  let capturedPrompts: string[];

  beforeEach(() => {
    tmp = makeTmp();
    setupTechStack(tmp);
    capturedPrompts = [];
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("uses fallback spec template text when spec-template.md does not exist", async () => {
    const runner = makeRunner(tmp);
    runner.callClaude = jest.fn(async (prompt: string) => {
      capturedPrompts.push(prompt);
      return "# Feature Specification: No Template\n\nSpec.";
    }) as typeof runner.callClaude;

    await runner.runSpec("F-001", "No Template", []);
    // Fallback template text from buildSpecPrompt
    expect(capturedPrompts[0]).toContain("User Scenarios, Requirements, Success Criteria");
  });

  it("uses actual template content when spec-template.md exists", async () => {
    mkdirSync(join(tmp, ".specify", "templates"), { recursive: true });
    writeFileSync(
      join(tmp, ".specify", "templates", "spec-template.md"),
      "## Custom Spec Template\n### Goals\n### Non-Goals\n",
      "utf8"
    );

    const runner = makeRunner(tmp);
    runner.callClaude = jest.fn(async (prompt: string) => {
      capturedPrompts.push(prompt);
      return "# Feature Specification: With Template\n\nSpec.";
    }) as typeof runner.callClaude;

    await runner.runSpec("F-001", "With Template", []);
    expect(capturedPrompts[0]).toContain("Custom Spec Template");
    expect(capturedPrompts[0]).not.toContain("User Scenarios, Requirements, Success Criteria");
  });

  it("uses fallback command text when speckit.specify command file is missing", async () => {
    // No .claude/commands/speckit.specify.md exists
    const runner = makeRunner(tmp);
    runner.callClaude = jest.fn(async (prompt: string) => {
      capturedPrompts.push(prompt);
      return "# Feature Specification: No Command\n\nSpec.";
    }) as typeof runner.callClaude;

    await runner.runSpec("F-001", "No Command", []);
    // The command content IS part of the prompt — when command file missing,
    // the fallback text is used and included via buildCommandBlock OR in the
    // commandContent fallback string used directly
    // Note: buildCommandBlock only adds section header when commandContent is present;
    // when readCommandFile returns null, a default string is used as commandContent
    expect(capturedPrompts[0]).toContain("Create a feature specification");
  });
});

describe("runPlan – fallback text when planTemplate is missing", () => {
  let tmp: string;
  let capturedPrompts: string[];

  beforeEach(() => {
    tmp = makeTmp();
    setupTechStack(tmp);
    capturedPrompts = [];
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("uses fallback plan template text when plan-template.md does not exist", async () => {
    // Write a spec.md so runPlan doesn't throw
    const specsDir = join(tmp, "docs", "specs", "f-001");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec\nSome requirements.", "utf8");

    const runner = makeRunner(tmp);
    runner.callClaude = jest.fn(async (prompt: string) => {
      capturedPrompts.push(prompt);
      return "# Implementation Plan: No Plan Template\n\nPlan.";
    }) as typeof runner.callClaude;

    await runner.runPlan("F-001", "No Plan Template", []);
    // Fallback plan template
    expect(capturedPrompts[0]).toContain("Sections: Summary, Technical Context, Project Structure, Phases");
  });

  it("uses actual plan template when plan-template.md exists", async () => {
    const specsDir = join(tmp, "docs", "specs", "f-001");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec\nRequirements.", "utf8");

    mkdirSync(join(tmp, ".specify", "templates"), { recursive: true });
    writeFileSync(
      join(tmp, ".specify", "templates", "plan-template.md"),
      "## Custom Plan Template\n### Architecture\n### Milestones\n",
      "utf8"
    );

    const runner = makeRunner(tmp);
    runner.callClaude = jest.fn(async (prompt: string) => {
      capturedPrompts.push(prompt);
      return "# Implementation Plan: With Plan Template\n\nPlan.";
    }) as typeof runner.callClaude;

    await runner.runPlan("F-001", "With Plan Template", []);
    expect(capturedPrompts[0]).toContain("Custom Plan Template");
  });
});

describe("runImplement – prompt content with and without snapshot", () => {
  let tmp: string;
  let capturedPrompts: string[];

  beforeEach(() => {
    tmp = makeTmp();
    setupTechStack(tmp);
    capturedPrompts = [];
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("implement prompt contains 'CODEBASE CONTEXT' when snapshot exists", async () => {
    writeFileSync(join(tmp, "docs", "brownfield-snapshot.md"), "# Codebase\n\nExisting code.", "utf8");

    const specsDir = join(tmp, "docs", "specs", "f-001");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec\nReqs.", "utf8");
    writeFileSync(join(specsDir, "plan.md"), "# Plan\nPhases.", "utf8");
    writeFileSync(join(specsDir, "tasks.md"), "# Tasks\n- [ ] T001 Create src/index.ts", "utf8");

    // Mock git calls (used during implement)
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: "claude 1.0.0", stderr: "" }) // constructor
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" }) // git diff
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" }); // git ls-files

    const runner = makeRunner(tmp);
    runner.callClaude = jest.fn(async (prompt: string) => {
      capturedPrompts.push(prompt);
      return `<<<FILE: src/features/f-001/index.ts>>>\nexport const hello = "world";\n<<<END_FILE>>>`;
    }) as typeof runner.callClaude;

    await runner.runImplement("F-001", "Test", []);
    expect(capturedPrompts[0]).toContain("CODEBASE CONTEXT");
  });
});

describe("runTasks – prompt content without snapshot", () => {
  let tmp: string;
  let capturedPrompts: string[];

  beforeEach(() => {
    tmp = makeTmp();
    setupTechStack(tmp);
    capturedPrompts = [];
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("tasks prompt uses fallback spec/plan when files don't exist", async () => {
    // No spec.md or plan.md in specsDir
    const runner = makeRunner(tmp);
    runner.callClaude = jest.fn(async (prompt: string) => {
      capturedPrompts.push(prompt);
      return "# Tasks: Fallback Feature\n\n- [ ] T001 Create src/index.ts";
    }) as typeof runner.callClaude;

    await runner.runTasks("F-001", "Fallback Feature", []);
    // When spec.md is missing, fallback is "Feature: <title>"
    expect(capturedPrompts[0]).toContain("Feature: Fallback Feature");
    // When plan.md is missing, fallback is "Plan for: <title>"
    expect(capturedPrompts[0]).toContain("Plan for: Fallback Feature");
  });
});
