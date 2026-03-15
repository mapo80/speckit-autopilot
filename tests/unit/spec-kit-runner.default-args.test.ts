/**
 * Tests targeting the remaining uncovered branches in spec-kit-runner.ts:
 * - default-arg branches for snapshotContent=null and acceptanceCriteria=[] params
 * - line 731: activePhases fallback (startIdx=-1, not qa/done)
 * - line 541: empty techStack branch in runConstitution
 * - augmentedPath: PATH already contains all search paths
 * - verifyImplementationProducedCode: result.stdout ?? "" null coalescing
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Mock child_process
// ---------------------------------------------------------------------------

const mockSpawnSync = jest.fn();
const mockSpawn = jest.fn(() => {
  const closeHandlers: Array<(code: number) => void> = [];
  const stdoutHandlers: Array<(chunk: Buffer) => void> = [];
  const proc = {
    stdin: { write: jest.fn(), end: jest.fn(() => {
      setImmediate(() => {
        for (const h of stdoutHandlers) h(Buffer.from("# Response\nContent."));
        for (const h of closeHandlers) h(0);
      });
    }) },
    stdout: { on: jest.fn((e: string, h: (c: Buffer) => void) => { if (e === "data") stdoutHandlers.push(h); }) },
    stderr: { on: jest.fn() },
    on: jest.fn((e: string, h: (code: number) => void) => { if (e === "close") closeHandlers.push(h); }),
    kill: jest.fn(),
  };
  return proc;
});

await jest.unstable_mockModule("child_process", () => ({
  spawnSync: mockSpawnSync,
  spawn: mockSpawn,
}));

const { SpecKitRunner, augmentedPath, verifyImplementationProducedCode } = await import(
  "../../src/core/spec-kit-runner.js"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "skr-default-args-"));
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
  mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: "claude 1.0.0", stderr: "" });
  return new SpecKitRunner(root);
}

// ---------------------------------------------------------------------------
// runPhases – startIdx = -1 and NOT qa/done → activePhases = phases (line 731 else branch)
// ---------------------------------------------------------------------------

describe("runPhases – startFromPhase not in phases and not qa/done → use full phases (line 731)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    setupTechStack(tmp);
    // Put constitution.md so it's not in phases
    mkdirSync(join(tmp, ".speckit"), { recursive: true });
    writeFileSync(join(tmp, ".speckit", "constitution.md"), "# Constitution\n", "utf8");
    mockSpawnSync.mockReset();
    mockSpawn.mockClear();
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("runs from beginning when startFromPhase is unknown (e.g. 'constitution' but it's not in phases)", async () => {
    // With constitution.md present, phases = [spec, clarify, plan, tasks, analyze, implement]
    // "constitution" is not in this list AND not "qa"/"done"
    // So startIdx = -1 and activePhases = phases (the else branch at line 731)

    const runner = makeRunner(tmp);
    let callCount = 0;
    runner.callClaude = jest.fn(async () => {
      callCount++;
      return "# Response\nContent.";
    }) as typeof runner.callClaude;

    // Mock git calls for implement
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });

    const result = await runner.runPhases("F-001", "Test", [], "constitution");
    // constitution not in phases (constitution.md exists), startIdx=-1
    // activePhases = phases = [spec, clarify, plan, tasks, analyze, implement]
    // All 6 phases run, but implement will fail (no <<<FILE:>>> blocks)
    expect(result.success).toBe(false);
    expect(result.phase).toBe("implement");
    // callClaude called for spec, clarify, plan, tasks, analyze = 5 times minimum
    expect(callCount).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// runConstitution – empty techStack → no techBlock (line 541 else branch)
// ---------------------------------------------------------------------------

describe("runConstitution – empty techStack omits tech block (line 541)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    mockSpawnSync.mockReset();
    mockSpawn.mockClear();
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("omits '## Tech Stack' block when tech-stack.md content is empty after trim", async () => {
    mkdirSync(join(tmp, "docs"), { recursive: true });
    // Write tech-stack.md with only whitespace
    writeFileSync(join(tmp, "docs", "tech-stack.md"), "   \n  \n   ", "utf8");

    const runner = makeRunner(tmp);
    let capturedPrompt = "";
    runner.callClaude = jest.fn(async (prompt: string) => {
      capturedPrompt = prompt;
      return "# Project Constitution\n\nStandards.";
    }) as typeof runner.callClaude;

    await runner.runConstitution("F-001", "Test");
    expect(capturedPrompt).not.toContain("## Tech Stack");
  });
});

// ---------------------------------------------------------------------------
// augmentedPath – PATH already contains all search paths → returns existing PATH
// ---------------------------------------------------------------------------

describe("augmentedPath – no extra paths needed when PATH contains all dirs (line 421)", () => {
  it("returns PATH unchanged when all CLAUDE_SEARCH_PATHS are already included", () => {
    const home = process.env.HOME ?? "/home/user";
    const allPaths = [
      `${home}/.local/bin`,
      `${home}/.npm-global/bin`,
      "/usr/local/bin",
      "/opt/homebrew/bin",
    ].join(":");

    const originalPath = process.env.PATH;
    process.env.PATH = allPaths + ":/usr/bin:/bin";
    const result = augmentedPath();
    process.env.PATH = originalPath;

    // When all paths already included, extra is empty, returns existing
    expect(result).toContain("/usr/bin:/bin");
    expect(typeof result).toBe("string");
  });

  it("adds missing search paths to PATH (ternary true branch)", () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "/usr/bin:/bin";  // minimal PATH without claude dirs
    const result = augmentedPath();
    process.env.PATH = originalPath;

    expect(result.length).toBeGreaterThan("/usr/bin:/bin".length);
  });
});

// ---------------------------------------------------------------------------
// verifyImplementationProducedCode – null stdout from spawnSync (line 342 null coalescing)
// ---------------------------------------------------------------------------

describe("verifyImplementationProducedCode – null stdout from find command (line 342)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    mockSpawnSync.mockReset();
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("handles null stdout from find command by treating as empty (line 342)", () => {
    // Create the featureDir so the `find` command branch is reached
    const featureDir = join(tmp, "src", "features", "f-001");
    mkdirSync(featureDir, { recursive: true });

    // Mock find (returns null stdout), then git diff and git ls-files for fallback
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: null, stderr: "" })  // find
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })    // git diff
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });   // git ls-files

    const result = verifyImplementationProducedCode(tmp, "F-001");
    // null stdout treated as "" → no files found in featureDir → falls through
    expect(result.hasNewFiles).toBe(false);
  });

  it("handles null stdout from git commands (lines 377-378)", () => {
    // No featureDir, so falls through to git diff path
    // Mock git diff and git ls-files to return null stdout
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: null, stderr: "" })  // git diff
      .mockReturnValueOnce({ status: 0, stdout: null, stderr: "" }); // git ls-files

    const result = verifyImplementationProducedCode(tmp, "F-001");
    // null stdout treated as "" → no files found
    expect(result.hasNewFiles).toBe(false);
    expect(result.diffSummary).toBe("No application code produced");
  });
});

// ---------------------------------------------------------------------------
// runTasks / runImplement – default args when spec.md and plan.md are absent
// These cover the fallback ?? "..." branches at lines 617-618, 640-642
// ---------------------------------------------------------------------------

describe("runTasks – fallback ?? branches when spec.md and plan.md absent (lines 617-618)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    setupTechStack(tmp);
    mockSpawnSync.mockReset();
    mockSpawn.mockClear();
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("uses fallback 'Feature: <title>' when spec.md is missing", async () => {
    const runner = makeRunner(tmp);
    let capturedPrompt = "";
    runner.callClaude = jest.fn(async (prompt: string) => {
      capturedPrompt = prompt;
      return "# Tasks: Missing Spec\n\n- [ ] T001 Create index.ts";
    }) as typeof runner.callClaude;

    await runner.runTasks("F-001", "Missing Spec", []);
    expect(capturedPrompt).toContain("Feature: Missing Spec");
    expect(capturedPrompt).toContain("Plan for: Missing Spec");
  });
});

describe("runImplement – fallback ?? branches when spec.md/plan.md/tasks.md absent (lines 640-642)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    setupTechStack(tmp);
    mockSpawnSync.mockReset();
    mockSpawn.mockClear();
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("uses fallback text for missing spec, plan, and tasks in implement prompt", async () => {
    // Mock git for implement
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: "claude 1.0.0", stderr: "" }) // constructor
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })  // git diff
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" }); // git ls-files

    const runner = makeRunner(tmp);
    let capturedPrompt = "";
    runner.callClaude = jest.fn(async (prompt: string) => {
      capturedPrompt = prompt;
      return `<<<FILE: src/features/f-001/index.ts>>>\nexport const hello = "world";\n<<<END_FILE>>>`;
    }) as typeof runner.callClaude;

    await runner.runImplement("F-001", "Missing All", []);

    expect(capturedPrompt).toContain("Feature: Missing All");
    expect(capturedPrompt).toContain("Plan for: Missing All");
    expect(capturedPrompt).toContain("Tasks for: Missing All");
  });
});

// ---------------------------------------------------------------------------
// runPhases – default startFromPhase parameter (line 713: default-arg = "spec")
// This is called without the 4th argument to use the default
// ---------------------------------------------------------------------------

describe("runPhases – default startFromPhase arg (line 713)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    setupTechStack(tmp);
    mkdirSync(join(tmp, ".speckit"), { recursive: true });
    writeFileSync(join(tmp, ".speckit", "constitution.md"), "# Constitution\n", "utf8");
    mockSpawnSync.mockReset();
    mockSpawn.mockClear();
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("uses 'spec' as default startFromPhase when not provided", async () => {
    const runner = makeRunner(tmp);
    let callCount = 0;
    runner.callClaude = jest.fn(async () => {
      callCount++;
      return "# Response\nContent.";
    }) as typeof runner.callClaude;

    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });

    // Call runPhases WITHOUT the startFromPhase argument to use default
    const result = await (runner as unknown as {
      runPhases: (id: string, title: string, ac: string[]) => Promise<{ success: boolean; phase: string }>;
    }).runPhases("F-001", "Default Start", []);

    // Starts from "spec" by default — runs spec, clarify, plan, tasks, analyze, implement
    expect(callCount).toBeGreaterThanOrEqual(5);
    // implement fails because no FILE blocks
    expect(result.success).toBe(false);
  });
});
