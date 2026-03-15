/**
 * BUG#6 regression: runImplement must throw "No source files generated" when:
 *   - The claude response contains no <<<FILE:>>> blocks, AND
 *   - git diff/ls-files show no new source files.
 *
 * Also covers runPhases error propagation: when runImplement throws,
 * runPhases must return { success: false, phase: "implement" }.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "skr-no-files-"));
}

// ---------------------------------------------------------------------------
// Mock child_process before importing module under test
// ---------------------------------------------------------------------------

const mockSpawnSync = jest.fn();

const spawnResponseQueue: Array<{ stdout: string; exitCode: number }> = [];

function pushSpawnResponse(stdout: string, exitCode = 0): void {
  spawnResponseQueue.push({ stdout, exitCode });
}

function resetSpawnResponses(): void {
  spawnResponseQueue.length = 0;
}

const mockSpawn = jest.fn(() => {
  const response = spawnResponseQueue.shift() ?? { stdout: "", exitCode: 0 };
  const stdoutHandlers: Array<(chunk: Buffer) => void> = [];
  const closeHandlers: Array<(code: number | null) => void> = [];

  return {
    stdin: {
      write: jest.fn(),
      end: jest.fn(() => {
        setImmediate(() => {
          for (const h of stdoutHandlers) h(Buffer.from(response.stdout));
          for (const h of closeHandlers) h(response.exitCode);
        });
      }),
    },
    stdout: {
      on: jest.fn((event: string, handler: (chunk: Buffer) => void) => {
        if (event === "data") stdoutHandlers.push(handler);
      }),
    },
    stderr: {
      on: jest.fn((_event: string, _handler: unknown) => { /* noop */ }),
    },
    on: jest.fn((event: string, handler: (code: number | null) => void) => {
      if (event === "close") closeHandlers.push(handler);
      if (event === "error") { /* noop */ }
    }),
    kill: jest.fn(),
  };
});

await jest.unstable_mockModule("child_process", () => ({
  spawnSync: mockSpawnSync,
  spawn: mockSpawn,
}));

const { SpecKitRunner } = await import("../../src/core/spec-kit-runner.js");

// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------

function makeRunner(tmp: string): InstanceType<typeof SpecKitRunner> {
  // Constructor --version check
  mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: "claude 1.0.0", stderr: "" });
  return new SpecKitRunner(tmp);
}

function writeSpecArtifacts(tmp: string, featureId: string): void {
  const specsDir = join(tmp, "docs", "specs", featureId.toLowerCase());
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, "spec.md"), "# Spec\n\nSpec content.", "utf8");
  writeFileSync(join(specsDir, "plan.md"), "# Plan\n\nPlan content.", "utf8");
  writeFileSync(join(specsDir, "tasks.md"), "# Tasks\n\n- [ ] T001", "utf8");
}

function mockEmptyGitDiff(): void {
  // git diff --name-only HEAD → empty
  mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });
  // git ls-files --others → empty
  mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });
}

// ---------------------------------------------------------------------------
// runImplement – no files generated
// ---------------------------------------------------------------------------

describe("SpecKitRunner.runImplement – no source files throws (BUG#6)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    mkdirSync(join(tmp, "docs"), { recursive: true });
    writeFileSync(join(tmp, "docs", "tech-stack.md"), "# Tech Stack\n\n## Backend\n- Language / Runtime: TypeScript\n", "utf8");
    mockSpawnSync.mockReset();
    mockSpawn.mockClear();
    resetSpawnResponses();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("throws 'No source files generated' when response has no FILE blocks and git is empty", async () => {
    const runner = makeRunner(tmp);
    writeSpecArtifacts(tmp, "F-001");

    // Claude returns prose with no <<<FILE:>>> blocks
    pushSpawnResponse("I analyzed the requirements and here is my plan.", 0);
    mockEmptyGitDiff();

    await expect(
      runner.runImplement("F-001", "My Feature", [])
    ).rejects.toThrow(/No source files generated/);
  });

  it("error message includes the feature title", async () => {
    const runner = makeRunner(tmp);
    writeSpecArtifacts(tmp, "F-001");

    pushSpawnResponse("No files here, just text.", 0);
    mockEmptyGitDiff();

    await expect(
      runner.runImplement("F-001", "The Missing Files Feature", [])
    ).rejects.toThrow(/The Missing Files Feature/);
  });

  it("error message includes the feature ID", async () => {
    const runner = makeRunner(tmp);
    writeSpecArtifacts(tmp, "F-001");

    pushSpawnResponse("Analysis complete.", 0);
    mockEmptyGitDiff();

    await expect(
      runner.runImplement("F-001", "Some Feature", [])
    ).rejects.toThrow(/F-001/);
  });

  it("error message includes hint about <<<FILE: path>>> blocks", async () => {
    const runner = makeRunner(tmp);
    writeSpecArtifacts(tmp, "F-001");

    pushSpawnResponse("Here is what I think you should do.", 0);
    mockEmptyGitDiff();

    await expect(
      runner.runImplement("F-001", "Feature", [])
    ).rejects.toThrow(/<<<FILE/);
  });

  it("succeeds when response contains valid <<<FILE:>>> blocks", async () => {
    const runner = makeRunner(tmp);
    writeSpecArtifacts(tmp, "F-002");

    const implementResponse = [
      "Here is the implementation:",
      "",
      "<<<FILE: src/features/f-002/index.ts>>>",
      "export const hello = () => 'world';",
      "<<<END_FILE>>>",
    ].join("\n");

    pushSpawnResponse(implementResponse, 0);
    mockEmptyGitDiff();

    const paths = await runner.runImplement("F-002", "Feature Two", []);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain("f-002");
  });

  it("succeeds when git diff returns source files (tool_use path)", async () => {
    const runner = makeRunner(tmp);
    writeSpecArtifacts(tmp, "F-003");

    // Claude returns no FILE blocks (tool_use wrote files directly)
    pushSpawnResponse("Files have been written via tool_use.", 0);

    // git diff returns a source file → hasNewFiles:true
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: "src/features/f-003/index.ts\n", stderr: "" })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });

    const paths = await runner.runImplement("F-003", "Feature Three", []);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain("f-003");
  });
});

// ---------------------------------------------------------------------------
// runPhases – implement failure propagation
// ---------------------------------------------------------------------------

describe("SpecKitRunner.runPhases – implement phase failure propagation", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    mkdirSync(join(tmp, "docs"), { recursive: true });
    writeFileSync(join(tmp, "docs", "tech-stack.md"), "# Tech Stack\n\n## Backend\n- Language / Runtime: TypeScript\n", "utf8");
    mockSpawnSync.mockReset();
    mockSpawn.mockClear();
    resetSpawnResponses();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns success:false and phase:'implement' when implement has no files", async () => {
    const runner = makeRunner(tmp);
    writeSpecArtifacts(tmp, "F-001");

    // spec already exists so startFromPhase:"implement" skips earlier phases
    // Claude returns no FILE blocks
    pushSpawnResponse("Just some prose without file blocks.", 0);
    mockEmptyGitDiff();

    const result = await runner.runPhases("F-001", "Test Feature", [], "implement");

    expect(result.success).toBe(false);
    expect(result.phase).toBe("implement");
  });

  it("error field in runPhases result contains 'No source files generated'", async () => {
    const runner = makeRunner(tmp);
    writeSpecArtifacts(tmp, "F-001");

    pushSpawnResponse("Analysis only, no code.", 0);
    mockEmptyGitDiff();

    const result = await runner.runPhases("F-001", "Test Feature", [], "implement");

    expect(result.error).toMatch(/No source files generated/);
  });

  it("returns success:true when all phases complete with FILE blocks", async () => {
    const runner = makeRunner(tmp);

    // Spec artifacts for full run from "spec"
    const specsDir = join(tmp, "docs", "specs", "f-004");
    mkdirSync(specsDir, { recursive: true });

    const specContent = "# Spec\n\nSpec for F-004.";
    const planContent = "# Plan\n\nPlan for F-004.";

    // Responses for: spec, clarify, plan, tasks, analyze, implement
    pushSpawnResponse(specContent, 0);
    pushSpawnResponse("All terms are clear.", 0);
    pushSpawnResponse(planContent, 0);
    pushSpawnResponse("# Tasks\n\n- [ ] T001 src/features/f-004/index.ts", 0);
    pushSpawnResponse("# Analysis\n\nAll consistent.", 0);
    pushSpawnResponse(
      "Implementation:\n<<<FILE: src/features/f-004/index.ts>>>\nexport const x = 42;\n<<<END_FILE>>>",
      0
    );

    // git diff + ls-files for runImplement (no tool_use files)
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });

    const result = await runner.runPhases("F-004", "Feature Four", [], "spec");

    expect(result.success).toBe(true);
  });

  it("returns success:false with phase:'plan' when spec.md missing and starting from 'plan'", async () => {
    // runPlan throws when spec.md is absent → runPhases should return plan failure
    const runner = makeRunner(tmp);

    const result = await runner.runPhases("F-005", "Feature Five", [], "plan");

    expect(result.success).toBe(false);
    expect(result.phase).toBe("plan");
    expect(result.error).toMatch(/spec\.md not found/);
  });
});
