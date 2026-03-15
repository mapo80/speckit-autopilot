/**
 * Tests for the uncovered error paths in callClaudeCli (spec-kit-runner.ts lines 493-494, 508-510):
 * - error event path (lines 508-510): proc.on("error") fires with ENOENT
 * - timeout path (lines 493-494): timer fires before proc closes
 *
 * Uses jest.unstable_mockModule to mock child_process before importing.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Mock child_process
// ---------------------------------------------------------------------------

const mockSpawnSync = jest.fn();

type ProcEventHandler = (arg?: unknown) => void;

// A factory that produces procs with controllable event emission
type ProcBehavior =
  | { kind: "error"; err: Error }
  | { kind: "timeout" };  // never fires close or error

let nextProcBehavior: ProcBehavior = { kind: "timeout" };

const mockSpawn = jest.fn(() => {
  const behavior = nextProcBehavior;

  const stdoutHandlers: Array<(chunk: Buffer) => void> = [];
  const stderrHandlers: Array<(chunk: Buffer) => void> = [];
  const closeHandlers: Array<(code: number) => void> = [];
  const errorHandlers: Array<(err: Error) => void> = [];

  const proc = {
    stdin: {
      write: jest.fn(),
      end: jest.fn(() => {
        if (behavior.kind === "error") {
          setImmediate(() => {
            for (const h of errorHandlers) h(behavior.err);
          });
        }
        // For "timeout" kind: never fire any event
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
    on: jest.fn((event: string, handler: ProcEventHandler) => {
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
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "skr-cli-err-"));
}

function makeRunner(root: string): InstanceType<typeof SpecKitRunner> {
  mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: "claude 1.0.0", stderr: "" });
  return new SpecKitRunner(root);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("callClaudeCli – error event path (lines 508-510)", () => {
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
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    jest.useRealTimers();
  });

  it("rejects with 'claude CLI error: ENOENT' when proc emits error event", async () => {
    nextProcBehavior = { kind: "error", err: new Error("ENOENT") };
    const runner = makeRunner(tmp);

    await expect(runner.runSpec("F-001", "Test", [])).rejects.toThrow("claude CLI error: ENOENT");
  });

  it("rejects with error message matching proc error text", async () => {
    nextProcBehavior = { kind: "error", err: new Error("spawn claude ENOENT") };
    const runner = makeRunner(tmp);

    await expect(runner.runSpec("F-001", "Test", [])).rejects.toThrow(/claude CLI error:.*spawn claude ENOENT/);
  });
});

describe("callClaudeCli – timeout path (lines 492-494)", () => {
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
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    jest.useRealTimers();
  });

  it("rejects with 'claude CLI timed out' when timer fires before close event", async () => {
    nextProcBehavior = { kind: "timeout" }; // never fires close or error
    jest.useFakeTimers();

    const runner = makeRunner(tmp);
    const promise = runner.runSpec("F-001", "Hanging Feature", []);

    // Advance time past the 1_500_000 ms timeout in callClaudeCli
    jest.advanceTimersByTime(1_500_001);

    await expect(promise).rejects.toThrow("claude CLI timed out after 25 minutes");
  });
});
