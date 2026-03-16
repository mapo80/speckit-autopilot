/**
 * Additional coverage tests for src/cli/audit.ts targeting uncovered lines:
 * - callClaudeForReview: success path, error path, rejection path (lines 43-60)
 * - scanGeneratedFiles: git success path with filtering (lines 77-80)
 * - collectFiles: recursive directory traversal (line 97)
 * - auditBootstrap: parse error path (line 280)
 * - auditFeature: with spec+tasks, with implementation-report.json, JSON parse error (lines 294-375)
 * - auditAll: full orchestration (lines 383-479)
 *
 * Uses jest.unstable_mockModule to mock child_process for callClaudeForReview.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import yaml from "js-yaml";

// ---------------------------------------------------------------------------
// Mock child_process for callClaudeForReview tests
// ---------------------------------------------------------------------------

const mockSpawnSync = jest.fn();

type CloseHandler = (code: number | null) => void;
type ErrorHandler = (err: Error) => void;
type DataHandler = (chunk: Buffer) => void;

let nextClaudeBehavior: {
  kind: "success" | "fail" | "error" | "empty";
  stdout?: string;
  stderr?: string;
  code?: number;
  err?: Error;
} = { kind: "success", stdout: "Review content" };

const mockSpawn = jest.fn(() => {
  const behavior = nextClaudeBehavior;
  const stdoutHandlers: DataHandler[] = [];
  const stderrHandlers: DataHandler[] = [];
  const closeHandlers: CloseHandler[] = [];
  const errorHandlers: ErrorHandler[] = [];

  const proc = {
    stdin: {
      write: jest.fn(),
      end: jest.fn(() => {
        setImmediate(() => {
          if (behavior.kind === "error") {
            for (const h of errorHandlers) h(behavior.err ?? new Error("spawn error"));
          } else {
            for (const h of stdoutHandlers) h(Buffer.from(behavior.stdout ?? ""));
            for (const h of stderrHandlers) h(Buffer.from(behavior.stderr ?? ""));
            for (const h of closeHandlers) h(behavior.code ?? (behavior.kind === "fail" ? 1 : 0));
          }
        });
      }),
    },
    stdout: { on: jest.fn((e: string, h: DataHandler) => { if (e === "data") stdoutHandlers.push(h); }) },
    stderr: { on: jest.fn((e: string, h: DataHandler) => { if (e === "data") stderrHandlers.push(h); }) },
    on: jest.fn((e: string, h: CloseHandler | ErrorHandler) => {
      if (e === "close") closeHandlers.push(h as CloseHandler);
      if (e === "error") errorHandlers.push(h as ErrorHandler);
    }),
    kill: jest.fn(),
  };
  return proc;
});

await jest.unstable_mockModule("child_process", () => ({
  spawnSync: mockSpawnSync,
  spawn: mockSpawn,
}));

const {
  callClaudeForReview,
  auditFeature,
  auditBootstrap,
  auditAll,
  scanGeneratedFiles,
} = await import("../../src/cli/audit.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "audit-coverage-"));
}

function writeTechStack(root: string): void {
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "tech-stack.md"), "# Tech Stack\n\n## Backend\n- Language / Runtime: TypeScript\n", "utf8");
}

function writeBacklogYaml(root: string, features: object[]): void {
  mkdirSync(join(root, "docs"), { recursive: true });
  const backlog = {
    version: "1",
    generatedAt: new Date().toISOString(),
    features: features.map((f) => {
      const obj = f as Record<string, unknown>;
      return {
        id: obj.id,
        title: obj.title,
        epic: "Core",
        status: obj.status ?? "open",
        priority: "medium",
        dependsOn: [],
        acceptanceCriteria: obj.acceptanceCriteria ?? [],
        estimatedComplexity: "medium",
        specKitBranch: "",
        notes: "",
      };
    }),
  };
  writeFileSync(join(root, "docs", "product-backlog.yaml"), yaml.dump(backlog), "utf8");
}

// ---------------------------------------------------------------------------
// callClaudeForReview – success and failure paths (lines 43-60)
// ---------------------------------------------------------------------------

describe("callClaudeForReview – success path (lines 43-60)", () => {
  beforeEach(() => {
    mockSpawn.mockClear();
  });

  it("resolves with trimmed stdout on exit code 0", async () => {
    nextClaudeBehavior = { kind: "success", stdout: "  Review output  " };
    const result = await callClaudeForReview("test prompt");
    expect(result).toBe("Review output");
  });

  it("resolves with stdout even when exit code is non-zero (stdout.trim() truthy)", async () => {
    nextClaudeBehavior = { kind: "fail", stdout: "Partial output", code: 1 };
    const result = await callClaudeForReview("test prompt");
    expect(result).toBe("Partial output");
  });

  it("rejects with exit code message when code != 0 and stdout is empty", async () => {
    nextClaudeBehavior = { kind: "fail", stdout: "", stderr: "some error", code: 2 };
    await expect(callClaudeForReview("test prompt")).rejects.toThrow("claude CLI exited 2: some error");
  });

  it("rejects on error event from proc", async () => {
    nextClaudeBehavior = { kind: "error", err: new Error("ENOENT: claude not found") };
    await expect(callClaudeForReview("test prompt")).rejects.toThrow("ENOENT: claude not found");
  });
});

// ---------------------------------------------------------------------------
// auditFeature – with spec + tasks (lines 294-376)
// ---------------------------------------------------------------------------

describe("auditFeature – with spec.md and tasks.md", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    writeTechStack(tmp);
    mockSpawn.mockClear();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("calls Claude and writes audit.md when spec + tasks exist", async () => {
    const specsDir = join(tmp, "docs", "specs", "f-001");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec\nUser can login.", "utf8");
    writeFileSync(join(specsDir, "tasks.md"), "# Tasks\n- [ ] T001 Create auth module", "utf8");

    const mockClaude = jest.fn(async () => "### Score: 5/5\nLooks complete.");
    const result = await auditFeature(tmp, "F-001", "Auth Login", mockClaude as (p: string) => Promise<string>);

    expect(result.skipped).toBe(false);
    expect(result.featureId).toBe("F-001");
    expect(existsSync(join(specsDir, "audit.md"))).toBe(true);
    const content = readFileSync(join(specsDir, "audit.md"), "utf8");
    expect(content).toContain("Score: 5/5");
  });

  it("writes skipped audit when neither spec.md nor tasks.md exists", async () => {
    // No files in specsDir
    const mockClaude = jest.fn(async () => "unused");
    const result = await auditFeature(tmp, "F-001", "Missing Feature", mockClaude as (p: string) => Promise<string>);

    expect(result.skipped).toBe(true);
    expect(mockClaude).not.toHaveBeenCalled();
  });

  it("writes error audit when Claude throws", async () => {
    const specsDir = join(tmp, "docs", "specs", "f-001");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec\nReqs.", "utf8");

    const mockClaude = jest.fn(async () => { throw new Error("Claude timeout"); });
    const result = await auditFeature(tmp, "F-001", "Error Feature", mockClaude as (p: string) => Promise<string>);

    expect(result.error).toContain("Claude timeout");
    expect(existsSync(join(tmp, "docs", "specs", "f-001", "audit.md"))).toBe(true);
  });

  it("reads implementation-report.json when it exists", async () => {
    const specsDir = join(tmp, "docs", "specs", "f-001");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec\nReqs.", "utf8");
    writeFileSync(join(specsDir, "implementation-report.json"), JSON.stringify({
      featureId: "F-001",
      changedFiles: ["src/index.ts", "src/auth.ts"],
      newFileCount: 2,
    }), "utf8");

    let capturedPrompt = "";
    const mockClaude = jest.fn(async (prompt: string) => {
      capturedPrompt = prompt;
      return "### Score: 4/5\nAlmost done.";
    });
    await auditFeature(tmp, "F-001", "Impl Report Feature", mockClaude as (p: string) => Promise<string>);

    expect(capturedPrompt).toContain("src/index.ts");
    expect(capturedPrompt).toContain("src/auth.ts");
  });

  it("handles corrupted implementation-report.json gracefully (line 318)", async () => {
    const specsDir = join(tmp, "docs", "specs", "f-001");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec\nReqs.", "utf8");
    writeFileSync(join(specsDir, "implementation-report.json"), "NOT VALID JSON {{{{", "utf8");

    let capturedPrompt = "";
    const mockClaude = jest.fn(async (prompt: string) => {
      capturedPrompt = prompt;
      return "### Score: 3/5\nOK.";
    });
    const result = await auditFeature(tmp, "F-001", "Corrupt Report", mockClaude as (p: string) => Promise<string>);

    // Should still work, with fallback message for file list
    expect(result.skipped).toBe(false);
    expect(capturedPrompt).toContain("Failed to parse implementation-report.json");
  });
});

// ---------------------------------------------------------------------------
// auditBootstrap – parse error path (line 280)
// ---------------------------------------------------------------------------

describe("auditBootstrap – parse error path (line 280)", () => {
  let tmp: string;

  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns valid=false with error message when backlog YAML is malformed", () => {
    mkdirSync(join(tmp, "docs"), { recursive: true });
    // Write a YAML file that parses but fails backlog schema validation
    writeFileSync(join(tmp, "docs", "product-backlog.yaml"), "invalidRootKey: oops\n", "utf8");

    const result = auditBootstrap(tmp);

    // Schema validation fails → parse error path
    expect(result.valid).toBe(false);
    expect(result.warnings.some((w: string) => w.includes("Failed to parse backlog"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scanGeneratedFiles – git success path returns filtered results (lines 77-80)
// ---------------------------------------------------------------------------

describe("scanGeneratedFiles – git success path filtering (lines 77-80)", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  it("filters out docs/, node_modules/, and dotfiles from git output", () => {
    mockSpawnSync.mockReturnValueOnce({
      status: 0,
      stdout: "src/index.ts\ndocs/product.md\nnode_modules/lib/index.js\n.env\nlib/helper.ts\n",
      stderr: "",
    });

    const root = makeTmp();
    const files = scanGeneratedFiles(root);
    rmSync(root, { recursive: true, force: true });

    expect(files).toContain("src/index.ts");
    expect(files).toContain("lib/helper.ts");
    expect(files).not.toContain("docs/product.md");
    expect(files).not.toContain("node_modules/lib/index.js");
    expect(files).not.toContain(".env");
  });

  it("returns empty array when git output is empty", () => {
    mockSpawnSync.mockReturnValueOnce({
      status: 0,
      stdout: "\n\n",
      stderr: "",
    });

    const root = makeTmp();
    const files = scanGeneratedFiles(root);
    rmSync(root, { recursive: true, force: true });

    expect(files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// auditAll – full orchestration (lines 383-479)
// ---------------------------------------------------------------------------

describe("auditAll – full orchestration", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    mockSpawn.mockClear();
    mockSpawnSync.mockReset();
    // Mock git for scanGeneratedFiles call at end of auditAll
    mockSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "" });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("creates audit-report.md without backlog (no feature audits)", async () => {
    writeTechStack(tmp);
    // No product-backlog.yaml

    await auditAll(tmp);

    const reportPath = join(tmp, "docs", "audit-report.md");
    expect(existsSync(reportPath)).toBe(true);
    const content = readFileSync(reportPath, "utf8");
    expect(content).toContain("Audit Report");
    expect(content).toContain("No backlog found");
  });

  it("creates audit-report.md with empty backlog (no done features to audit)", async () => {
    writeTechStack(tmp);
    writeBacklogYaml(tmp, [
      { id: "open-feature", title: "Open Feature", status: "open", acceptanceCriteria: ["works"] },
    ]);
    writeFileSync(join(tmp, "docs", "autopilot-state.json"), JSON.stringify({ status: "running" }), "utf8");

    await auditAll(tmp);

    const reportPath = join(tmp, "docs", "audit-report.md");
    expect(existsSync(reportPath)).toBe(true);
    const content = readFileSync(reportPath, "utf8");
    expect(content).toContain("Feature Audits");
    expect(content).toContain("0 features");
  });

  it("runs feature audits for done features using custom callClaude", async () => {
    writeTechStack(tmp);
    writeBacklogYaml(tmp, [
      { id: "done-feature", title: "Done Feature", status: "done", acceptanceCriteria: ["works"] },
    ]);
    writeFileSync(join(tmp, "docs", "autopilot-state.json"), JSON.stringify({ status: "running" }), "utf8");

    // Write spec + tasks for done-feature so audit doesn't get skipped
    const specsDir = join(tmp, "docs", "specs", "done-feature");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec\nReqs.", "utf8");

    // auditAll uses callClaudeForReview by default (spawn mocked above)
    // Set spawn to return a score
    nextClaudeBehavior = { kind: "success", stdout: "### Score: 4/5\nComplete." };

    await auditAll(tmp);

    const reportPath = join(tmp, "docs", "audit-report.md");
    expect(existsSync(reportPath)).toBe(true);
    const content = readFileSync(reportPath, "utf8");
    expect(content).toContain("done-feature");
  });

  it("includes structural gaps section in report", async () => {
    writeTechStack(tmp);
    // No README.md → gap detected
    writeBacklogYaml(tmp, []);

    await auditAll(tmp);

    const reportPath = join(tmp, "docs", "audit-report.md");
    const content = readFileSync(reportPath, "utf8");
    expect(content).toContain("Structural Gaps");
  });

  it("includes 'No structural gaps detected' when no gaps found", async () => {
    writeTechStack(tmp);
    writeFileSync(join(tmp, "README.md"), "# Project\n", "utf8");
    writeBacklogYaml(tmp, []);

    await auditAll(tmp);

    const reportPath = join(tmp, "docs", "audit-report.md");
    const content = readFileSync(reportPath, "utf8");
    expect(content).toContain("No structural gaps detected");
  });
});

// ---------------------------------------------------------------------------
// scanGeneratedFiles – git fallback path with subdirectories (line 97)
// ---------------------------------------------------------------------------

describe("scanGeneratedFiles – fallback collectFiles with subdirectories (line 97)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    mockSpawnSync.mockReset();
    // Make git fail so fallback runs
    mockSpawnSync.mockReturnValueOnce({ status: 1, stdout: "", stderr: "not a git repo" });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("recursively collects files from nested subdirectories (line 97)", () => {
    // Create nested directory structure
    mkdirSync(join(tmp, "src", "features", "auth"), { recursive: true });
    mkdirSync(join(tmp, "src", "features", "dashboard"), { recursive: true });
    writeFileSync(join(tmp, "src", "index.ts"), "export {};", "utf8");
    writeFileSync(join(tmp, "src", "features", "auth", "auth.ts"), "export {};", "utf8");
    writeFileSync(join(tmp, "src", "features", "dashboard", "dash.ts"), "export {};", "utf8");

    const files = scanGeneratedFiles(tmp);

    // Should find files in nested directories
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.some((f) => f.includes("auth.ts"))).toBe(true);
    expect(files.some((f) => f.includes("dash.ts"))).toBe(true);
  });
});
