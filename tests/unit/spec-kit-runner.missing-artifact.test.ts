/**
 * BUG#12 regression: runPlan must throw when spec.md is missing rather than
 * silently falling back to empty content.
 *
 * Also covers the runPhases error-propagation path: when runPlan throws,
 * runPhases must return { success: false, phase: "plan" }.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "skr-missing-artifact-"));
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
  const response = spawnResponseQueue.shift() ?? { stdout: "default response", exitCode: 0 };
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
// Tests
// ---------------------------------------------------------------------------

describe("SpecKitRunner.runPlan – missing spec.md throws (BUG#12)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    mkdirSync(join(tmp, "docs"), { recursive: true });
    writeFileSync(join(tmp, "docs", "tech-stack.md"), "# Tech Stack\n\n## Backend\n- Language / Runtime: TypeScript\n", "utf8");
    mockSpawnSync.mockReset();
    mockSpawn.mockClear();
    resetSpawnResponses();
    // Constructor --version check
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "claude 1.0.0", stderr: "" });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("throws 'spec.md not found' when spec.md does not exist", async () => {
    const runner = new SpecKitRunner(tmp);
    // No spec.md written — runPlan must throw
    await expect(
      runner.runPlan("F-001", "My Feature", [])
    ).rejects.toThrow(/spec\.md not found/);
  });

  it("throws with the feature title in the error message", async () => {
    const runner = new SpecKitRunner(tmp);
    await expect(
      runner.runPlan("F-001", "The Missing Spec Feature", [])
    ).rejects.toThrow(/The Missing Spec Feature/);
  });

  it("throws with the feature ID in the error message", async () => {
    const runner = new SpecKitRunner(tmp);
    await expect(
      runner.runPlan("F-999", "Another Feature", [])
    ).rejects.toThrow(/F-999/);
  });

  it("succeeds when spec.md exists", async () => {
    const runner = new SpecKitRunner(tmp);

    // Create spec.md first
    const specsDir = join(tmp, "docs", "specs", "f-001");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec\n\nSome spec content.", "utf8");

    // runPlan will call claude — provide a response
    pushSpawnResponse("# Implementation Plan\n\n## Summary\nBuild feature F-001.", 0);

    const planPath = await runner.runPlan("F-001", "My Feature", []);
    expect(planPath).toContain("plan.md");
  });

  it("writes plan.md when spec.md exists and claude responds", async () => {
    const runner = new SpecKitRunner(tmp);

    const specsDir = join(tmp, "docs", "specs", "f-002");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec\n\nSpec content for F-002.", "utf8");

    pushSpawnResponse("# Plan\n\n## Architecture\n- Use layered architecture.", 0);

    await runner.runPlan("F-002", "Feature Two", []);

    const { existsSync } = await import("fs");
    expect(existsSync(join(specsDir, "plan.md"))).toBe(true);
  });
});

describe("SpecKitRunner.runPhases – plan failure propagates correctly", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    mkdirSync(join(tmp, "docs"), { recursive: true });
    writeFileSync(join(tmp, "docs", "tech-stack.md"), "# Tech Stack\n\n## Backend\n- Language / Runtime: TypeScript\n", "utf8");
    mockSpawnSync.mockReset();
    mockSpawn.mockClear();
    resetSpawnResponses();
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "claude 1.0.0", stderr: "" });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns success:false and phase:'plan' when spec.md missing and startFromPhase='plan'", async () => {
    const runner = new SpecKitRunner(tmp);

    // Start from plan — spec.md is absent → runPlan throws
    const result = await runner.runPhases("F-001", "Test Feature", [], "plan");

    expect(result.success).toBe(false);
    expect(result.phase).toBe("plan");
  });

  it("error message in runPhases result contains 'spec.md not found'", async () => {
    const runner = new SpecKitRunner(tmp);

    const result = await runner.runPhases("F-001", "Test Feature", [], "plan");

    expect(result.error).toMatch(/spec\.md not found/);
  });

  it("runs successfully when starting from 'plan' and spec.md exists", async () => {
    const runner = new SpecKitRunner(tmp);

    const specsDir = join(tmp, "docs", "specs", "f-003");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec\n\nContent.", "utf8");

    // plan response
    pushSpawnResponse("# Plan\n\n## Summary\nImplementation plan.", 0);
    // tasks response
    pushSpawnResponse("# Tasks\n\n- [ ] T001 src/index.ts", 0);
    // analyze response
    pushSpawnResponse("# Analysis\n\nAll consistent.", 0);
    // implement response with FILE blocks (so runImplement finds files)
    pushSpawnResponse(
      `Implementing:\n<<<FILE: src/features/f-003/index.ts>>>\nexport const x = 1;\n<<<END_FILE>>>`,
      0
    );
    // git diff + git ls-files for runImplement
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });

    const result = await runner.runPhases("F-003", "Feature Three", [], "plan");

    expect(result.success).toBe(true);
  });
});
