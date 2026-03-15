/**
 * Tests for BUG#1 fix: runImplement uses git to detect only newly written files,
 * not pre-existing brownfield files that were already on disk before the phase ran.
 *
 * Uses jest.unstable_mockModule to control child_process so we can simulate
 * git reporting zero new files (brownfield scenario) vs. one new file (greenfield).
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "spec-kit-brownfield-"));
}

// ---------------------------------------------------------------------------
// Mock child_process at module level before importing the module under test
// ---------------------------------------------------------------------------

const mockSpawnSync = jest.fn();

// Async spawn queue — each entry provides the stdout the mock proc will emit
const spawnQueue: Array<{ stdout: string; exitCode: number }> = [];

function pushSpawn(stdout: string, exitCode = 0): void {
  spawnQueue.push({ stdout, exitCode });
}

function resetSpawnQueue(): void {
  spawnQueue.length = 0;
}

const mockSpawn = jest.fn(() => {
  const response = spawnQueue.shift() ?? { stdout: "", exitCode: 0 };

  const stdoutHandlers: Array<(chunk: Buffer) => void> = [];
  const stderrHandlers: Array<(chunk: Buffer) => void> = [];
  const closeHandlers: Array<(code: number) => void> = [];
  const errorHandlers: Array<(err: Error) => void> = [];

  const proc = {
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
      on: jest.fn((event: string, handler: (chunk: Buffer) => void) => {
        if (event === "data") stderrHandlers.push(handler);
      }),
    },
    on: jest.fn((event: string, handler: (arg: number | Error) => void) => {
      if (event === "close") closeHandlers.push(handler as (code: number) => void);
      if (event === "error") errorHandlers.push(handler as (err: Error) => void);
    }),
    kill: jest.fn(),
  };
  return proc;
});

await jest.unstable_mockModule("child_process", () => ({
  spawnSync: mockSpawnSync,
  spawn: mockSpawn,
}));

const { SpecKitRunner } = await import("../../src/core/spec-kit-runner.js");

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

function makeRunner(tmp: string): SpecKitRunner {
  // Provide the mandatory constructor spawnSync call (claude --version check)
  mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: "claude 1.0.0", stderr: "" });

  const runner = new SpecKitRunner(tmp);
  // Replace callClaude with a stub that returns text without FILE blocks,
  // simulating a response that relies on tool_use rather than <<<FILE:>>> output.
  runner.callClaude = async (_prompt: string) => "The implementation is complete.";
  return runner;
}

function seedArtifacts(tmp: string, featureId: string): void {
  const specsDir = join(tmp, "docs", "specs", featureId.toLowerCase());
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, "spec.md"), "# Spec", "utf8");
  writeFileSync(join(specsDir, "plan.md"), "# Plan", "utf8");
  writeFileSync(join(specsDir, "tasks.md"), "# Tasks\n- [ ] T001 Do the work", "utf8");
}

// ---------------------------------------------------------------------------
// BUG#1: Brownfield — git shows NO new files → should throw, not return stale files
// ---------------------------------------------------------------------------

describe("runImplement – brownfield: pre-existing src/ files are NOT returned", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    mkdirSync(join(tmp, "docs"), { recursive: true });
    writeFileSync(
      join(tmp, "docs", "tech-stack.md"),
      "# Tech Stack\n\n## Backend\n- Language / Runtime: TypeScript\n",
      "utf8"
    );
    mockSpawnSync.mockReset();
    mockSpawn.mockClear();
    resetSpawnQueue();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("throws 'No source files generated' when git shows no new src/ files and response has no FILE blocks", async () => {
    // Seed a pre-existing brownfield .ts file in src/
    const srcDir = join(tmp, "src", "existing");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "preexisting.ts"), "export const old = true;", "utf8");

    seedArtifacts(tmp, "F-BF");

    const runner = makeRunner(tmp);

    // runImplement calls spawnSync twice for git:
    //   1. git diff --name-only HEAD  → empty (no changed tracked files)
    //   2. git ls-files --others ...  → empty (no new untracked files in src/)
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" }) // git diff
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" }); // git ls-files

    // The pre-existing file must NOT be returned — the phase should throw instead
    await expect(runner.runImplement("F-BF", "Brownfield Feature")).rejects.toThrow(
      /No source files generated/
    );
  });

  it("does not include pre-existing .ts files in the returned paths", async () => {
    // Seed pre-existing brownfield files
    const srcDir = join(tmp, "src", "legacy");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "service.ts"), "export class LegacyService {}", "utf8");
    writeFileSync(join(srcDir, "util.ts"), "export function legacyUtil() {}", "utf8");

    seedArtifacts(tmp, "F-BF2");
    const runner = makeRunner(tmp);

    // git sees no newly written files
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });

    let thrown = false;
    let writtenPaths: string[] = [];
    try {
      writtenPaths = await runner.runImplement("F-BF2", "Brownfield Feature 2");
    } catch (_err) {
      thrown = true;
    }

    if (!thrown) {
      // If it somehow succeeded (e.g. fallback path extracted files), verify
      // the legacy files are NOT in the returned paths
      expect(writtenPaths).not.toContain(join(tmp, "src", "legacy", "service.ts"));
      expect(writtenPaths).not.toContain(join(tmp, "src", "legacy", "util.ts"));
    }
    // In the correct brownfield fix the method should throw
    expect(thrown).toBe(true);
  });

  it("succeeds and returns newly written .ts paths when git ls-files shows new src/ file", async () => {
    seedArtifacts(tmp, "F-NEW");
    const runner = makeRunner(tmp);

    // git diff finds nothing, but git ls-files finds a brand-new file
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" }) // git diff
      .mockReturnValueOnce({
        status: 0,
        stdout: "src/features/f-new/index.ts\n",
        stderr: "",
      }); // git ls-files

    const written = await runner.runImplement("F-NEW", "New Feature");

    expect(written.length).toBe(1);
    expect(written[0]).toContain("src/features/f-new/index.ts");
  });

  it("succeeds and returns paths when git diff HEAD shows changed src/ file", async () => {
    seedArtifacts(tmp, "F-DIFF");
    const runner = makeRunner(tmp);

    // git diff HEAD returns a modified file
    mockSpawnSync
      .mockReturnValueOnce({
        status: 0,
        stdout: "src/features/f-diff/handler.ts\n",
        stderr: "",
      }) // git diff
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" }); // git ls-files

    const written = await runner.runImplement("F-DIFF", "Diff Feature");

    expect(written.length).toBe(1);
    expect(written[0]).toContain("src/features/f-diff/handler.ts");
  });

  it("falls back to FILE block extraction when git returns nothing and response has FILE blocks", async () => {
    seedArtifacts(tmp, "F-FALLBACK");
    const runner = makeRunner(tmp);

    // Provide a response WITH <<<FILE:>>> blocks this time
    runner.callClaude = async () =>
      `<<<FILE: src/features/f-fallback/index.ts>>>\nexport const x = 1;\n<<<END_FILE>>>`;

    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" }) // git diff
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" }); // git ls-files

    const written = await runner.runImplement("F-FALLBACK", "Fallback Feature");

    expect(written.length).toBe(1);
    expect(existsSync(join(tmp, "src", "features", "f-fallback", "index.ts"))).toBe(true);
  });
});
