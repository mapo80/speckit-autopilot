/**
 * Mocked tests for spec-kit-runner.ts branches that require controlling
 * spawnSync output (git diff, specify init).
 *
 * Uses jest.unstable_mockModule for ESM-compatible module mocking.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "spec-kit-mock-"));
}

// ---------------------------------------------------------------------------
// Mock child_process before importing module under test
// ---------------------------------------------------------------------------

const mockSpawnSync = jest.fn();

// Queue of responses for mockSpawn. Each call pops one entry.
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
  const stderrHandlers: Array<(chunk: Buffer) => void> = [];
  const closeHandlers: Array<(code: number) => void> = [];

  const proc = {
    stdin: {
      write: jest.fn(),
      end: jest.fn(() => {
        // Emit stdout data and close asynchronously
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
    on: jest.fn((event: string, handler: (code: number) => void) => {
      if (event === "close") closeHandlers.push(handler);
    }),
    kill: jest.fn(),
  };
  return proc;
});

await jest.unstable_mockModule("child_process", () => ({
  spawnSync: mockSpawnSync,
  spawn: mockSpawn,
}));

const { verifyImplementationProducedCode, ensureSpecKitInitialized, SpecKitRunner } = await import(
  "../../src/core/spec-kit-runner.js"
);

// ---------------------------------------------------------------------------
// verifyImplementationProducedCode – git diff path (lines 357, 363-368)
// ---------------------------------------------------------------------------

describe("verifyImplementationProducedCode – git diff returns src/ files", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTmp();
    mockSpawnSync.mockReset();
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns hasNewFiles:true when git diff returns src/ source files (lines 357, 364)", () => {
    // git diff --name-only HEAD returns a src/ file
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: "src/features/f-001/index.ts\n", stderr: "" })
      // git ls-files --others returns nothing
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });

    const result = verifyImplementationProducedCode(tmp, "F-001");
    expect(result.hasNewFiles).toBe(true);
    expect(result.changedFiles).toContain("src/features/f-001/index.ts");
    expect(result.diffSummary).toContain("source file(s) changed via git");
  });

  it("returns hasNewFiles:true when git ls-files returns src/ file (line 364)", () => {
    // git diff returns nothing
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })
      // git ls-files returns a new untracked src/ file
      .mockReturnValueOnce({ status: 0, stdout: "src/features/f-002/index.ts\n", stderr: "" });

    const result = verifyImplementationProducedCode(tmp, "F-002");
    expect(result.hasNewFiles).toBe(true);
    expect(result.changedFiles).toContain("src/features/f-002/index.ts");
  });

  it("filters out test files from git diff output (line 357-360)", () => {
    // git diff returns a mix of test and source files
    mockSpawnSync
      .mockReturnValueOnce({
        status: 0,
        stdout: "src/features/f-003/index.ts\nsrc/features/f-003/index.test.ts\nsrc/features/f-003/index.spec.ts\n",
        stderr: "",
      })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });

    const result = verifyImplementationProducedCode(tmp, "F-003");
    // Only non-test file should be included
    expect(result.changedFiles).toContain("src/features/f-003/index.ts");
    expect(result.changedFiles).not.toContain("src/features/f-003/index.test.ts");
    expect(result.changedFiles).not.toContain("src/features/f-003/index.spec.ts");
    expect(result.hasNewFiles).toBe(true);
  });

  it("filters out files not starting with src/", () => {
    mockSpawnSync
      .mockReturnValueOnce({
        status: 0,
        stdout: "docs/something.md\nlib/helper.ts\nsrc/features/f-004/index.ts\n",
        stderr: "",
      })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });

    const result = verifyImplementationProducedCode(tmp, "F-004");
    expect(result.changedFiles.every((f) => f.startsWith("src/"))).toBe(true);
    expect(result.changedFiles).toContain("src/features/f-004/index.ts");
  });

  it("falls back to spec artifacts when git shows no src/ changes", () => {
    // git returns nothing useful
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" });

    // Create spec artifacts
    const specsDir = join(tmp, "docs", "specs", "f-005");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec", "utf8");

    const result = verifyImplementationProducedCode(tmp, "F-005");
    // Spec artifact exists so hasNewFiles might be true, but no application code
    expect(result.diffSummary).toContain("spec artifact");
  });
});

// ---------------------------------------------------------------------------
// ensureSpecKitInitialized – ok:true after specify init succeeds (line 59)
// ---------------------------------------------------------------------------

describe("ensureSpecKitInitialized – mocked specify init succeeds", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTmp();
    mockSpawnSync.mockReset();
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns ok:true when specify init exits 0 (line 59)", () => {
    // Dirs don't pre-exist, so specify init is called
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "success", stderr: "" });

    const result = ensureSpecKitInitialized(tmp);
    // specify exits 0 → returns ok:true
    expect(result.ok).toBe(true);
  });

  it("returns ok:true when specify init exits non-zero but bundled template rescues", () => {
    // specify init fails, but copyBundledTemplate copies from the bundled template dir
    mockSpawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "init failed" });

    const result = ensureSpecKitInitialized(tmp);
    // Bundled template exists in the repo → rescue succeeds → ok:true
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SpecKitRunner – CLI mode (mocked spawnSync)
// ---------------------------------------------------------------------------

describe("SpecKitRunner – CLI mode via claude --print", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTmp();
    mkdirSync(join(tmp, "docs"), { recursive: true });
    mockSpawnSync.mockReset();
    mockSpawn.mockClear();
    resetSpawnResponses();
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function setupCliMock(responses: string[]): void {
    // Constructor check uses spawnSync for --version
    mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: "claude 1.0.0", stderr: "" });
    // Phase calls use async spawn
    for (const response of responses) {
      pushSpawnResponse(response, 0);
    }
  }

  it("selects CLI mode when no API key is provided and claude --version succeeds", () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "claude 1.0.0", stderr: "" });
    const runner = new SpecKitRunner(tmp);
    expect(runner.getMode()).toBe("cli");
  });

  it("selects SDK mode when apiKey is provided", () => {
    const runner = new SpecKitRunner(tmp, "test-api-key");
    expect(runner.getMode()).toBe("sdk");
  });

  it("throws when no API key and claude --version fails", () => {
    mockSpawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "not found" });
    expect(() => new SpecKitRunner(tmp)).toThrow(/claude CLI/);
  });

  it("writes spec.md via CLI mode", async () => {
    setupCliMock([
      "# Feature Specification: Task CRUD\n\nUsers can create, read, update, delete tasks.\n\n## Acceptance Scenarios\n- User creates task"
    ]);
    const runner = new SpecKitRunner(tmp);
    await runner.runSpec("F-001", "Task CRUD", ["Create tasks", "Delete tasks"]);
    const specPath = join(tmp, "docs", "specs", "f-001", "spec.md");
    expect(existsSync(specPath)).toBe(true);
  });

  it("throws when claude --print returns non-zero", async () => {
    // Constructor --version check
    mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: "claude 1.0.0", stderr: "" });
    // claude --print fails via spawn
    pushSpawnResponse("", 1);

    const runner = new SpecKitRunner(tmp);
    await expect(runner.runSpec("F-001", "Task CRUD", [])).rejects.toThrow(/claude CLI failed/);
  });

  it("throws when claude --print returns empty output", async () => {
    // Constructor --version check
    mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: "claude 1.0.0", stderr: "" });
    // claude --print returns empty via spawn
    pushSpawnResponse("", 0);

    const runner = new SpecKitRunner(tmp);
    await expect(runner.runSpec("F-001", "Task CRUD", [])).rejects.toThrow(/empty response/);
  });

  it("runs all phases (spec→plan→tasks→implement) via CLI and writes files", async () => {
    const specResponse = "# Feature Specification: Task CRUD\n\nUsers can create and manage tasks.";
    const planResponse = "# Implementation Plan: Task CRUD\n\n## Summary\nBuild CRUD operations.";
    const tasksResponse = "# Tasks: Task CRUD\n\n- [ ] T001 Create src/features/f-001/index.ts";
    const implementResponse = `Here is the implementation:

<<<FILE: src/features/f-001/index.ts>>>
export interface Task { id: string; title: string; }
export function createTask(title: string): Task { return { id: Date.now().toString(), title }; }
<<<END_FILE>>>`;

    setupCliMock([specResponse, planResponse, tasksResponse, implementResponse]);

    const runner = new SpecKitRunner(tmp);
    const result = await runner.runPhases("F-001", "Task CRUD", ["Must support CRUD"], "spec");

    expect(result.success).toBe(true);
    expect(existsSync(join(tmp, "docs", "specs", "f-001", "spec.md"))).toBe(true);
    expect(existsSync(join(tmp, "docs", "specs", "f-001", "plan.md"))).toBe(true);
    expect(existsSync(join(tmp, "docs", "specs", "f-001", "tasks.md"))).toBe(true);
    expect(existsSync(join(tmp, "src", "features", "f-001", "index.ts"))).toBe(true);
  });
});
