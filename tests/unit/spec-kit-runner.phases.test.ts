/**
 * Tests for BUG#2 fix: constitution, clarify, and analyze are real phases with
 * proper skip logic and artifact creation.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SpecKitRunner } from "../../src/core/spec-kit-runner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "spec-kit-phases-"));
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
 * Construct a SpecKitRunner with callClaude mocked to return a fixed response.
 * Because the constructor calls spawnSync for `claude --version`, this helper
 * patches the constructor result by attempting construction and catching the
 * version-check error — then replaces callClaude.
 *
 * In the mocked test file pattern the whole child_process is mocked at
 * module level. Here we lean on the fact that the runner object exposes
 * callClaude as a public property that can be replaced after construction.
 */
function makeRunner(tmp: string, response = "mock response"): SpecKitRunner {
  let runner: SpecKitRunner;
  try {
    runner = new SpecKitRunner(tmp);
  } catch (err) {
    if ((err as Error).message.includes("claude CLI")) {
      // claude not installed in this environment — bypass version check via Object.create
      runner = Object.create(SpecKitRunner.prototype) as SpecKitRunner;
      (runner as unknown as Record<string, unknown>)["root"] = tmp;
      (runner as unknown as Record<string, unknown>)["claudePath"] = "claude";
      (runner as unknown as Record<string, unknown>)["snapshotContent"] = null;
      // Load tech-stack synchronously from the already-written file
      const tsPath = join(tmp, "docs", "tech-stack.md");
      (runner as unknown as Record<string, unknown>)["techStack"] = existsSync(tsPath)
        ? readFileSync(tsPath, "utf8").trim()
        : "TypeScript";
    } else {
      throw err;
    }
  }
  runner.callClaude = async (_prompt: string) => response;
  return runner;
}

// ---------------------------------------------------------------------------
// runConstitution
// ---------------------------------------------------------------------------

describe("runConstitution – skip / create logic", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    makeTechStack(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null (skips) when .speckit/constitution.md already exists", async () => {
    const constitutionPath = join(tmp, ".speckit", "constitution.md");
    mkdirSync(join(tmp, ".speckit"), { recursive: true });
    writeFileSync(constitutionPath, "# Existing Constitution", "utf8");

    const runner = makeRunner(tmp, "# New Constitution (should not be written)");
    const result = await runner.runConstitution("F-001", "My Feature");

    expect(result).toBeNull();
    // Content should be unchanged
    expect(readFileSync(constitutionPath, "utf8")).toBe("# Existing Constitution");
  });

  it("creates .speckit/constitution.md when it does not exist", async () => {
    const runner = makeRunner(tmp, "# Project Constitution\n\n## Coding Standards\n- Use TypeScript strict mode.");

    const result = await runner.runConstitution("F-002", "New Feature");

    const constitutionPath = join(tmp, ".speckit", "constitution.md");
    expect(result).toBe(constitutionPath);
    expect(existsSync(constitutionPath)).toBe(true);
    expect(readFileSync(constitutionPath, "utf8")).toContain("Project Constitution");
  });

  it("writes the AI response verbatim to .speckit/constitution.md", async () => {
    const constitutionContent = "# Constitution\n\n## Architecture\n- Layered architecture.\n";
    const runner = makeRunner(tmp, constitutionContent);

    await runner.runConstitution("F-003", "Arch Feature");

    const written = readFileSync(join(tmp, ".speckit", "constitution.md"), "utf8");
    expect(written).toBe(constitutionContent);
  });

  it("uses command file content when .claude/commands/speckit.constitution.md exists", async () => {
    const commandsDir = join(tmp, ".claude", "commands");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(
      join(commandsDir, "speckit.constitution.md"),
      "Custom constitution instructions.",
      "utf8"
    );

    let capturedPrompt = "";
    const runner = makeRunner(tmp, "# Constitution");
    runner.callClaude = async (prompt) => {
      capturedPrompt = prompt;
      return "# Constitution";
    };

    await runner.runConstitution("F-004", "Cmd Feature");

    expect(capturedPrompt).toContain("Custom constitution instructions.");
  });
});

// ---------------------------------------------------------------------------
// runClarify
// ---------------------------------------------------------------------------

describe("runClarify – skip / append logic", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    makeTechStack(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null (skips) when spec.md does not exist", async () => {
    const runner = makeRunner(tmp, "clarifications that should not be written");
    const result = await runner.runClarify("F-NOSPEC", "Missing Spec Feature");
    expect(result).toBeNull();
  });

  it("appends ## Clarifications section to spec.md when spec exists", async () => {
    const specsDir = join(tmp, "docs", "specs", "f-001");
    mkdirSync(specsDir, { recursive: true });
    const originalSpec = "# Feature Spec\n\nSome description without clarifications.\n";
    writeFileSync(join(specsDir, "spec.md"), originalSpec, "utf8");

    const runner = makeRunner(
      tmp,
      "All terms are well defined. No open decisions found."
    );

    const result = await runner.runClarify("F-001", "Clarify Feature");

    expect(result).toBe(join(specsDir, "spec.md"));
    const updated = readFileSync(join(specsDir, "spec.md"), "utf8");
    expect(updated).toContain("## Clarifications");
    expect(updated).toContain("All terms are well defined");
    // Original content still present
    expect(updated).toContain("Feature Spec");
  });

  it("does NOT duplicate ## Clarifications if section already present", async () => {
    const specsDir = join(tmp, "docs", "specs", "f-002");
    mkdirSync(specsDir, { recursive: true });
    const specWithClarifications = "# Spec\n\nContent.\n\n## Clarifications\nAlready answered.\n";
    writeFileSync(join(specsDir, "spec.md"), specWithClarifications, "utf8");

    const runner = makeRunner(tmp, "New clarification text.");

    await runner.runClarify("F-002", "Already Clarified Feature");

    const content = readFileSync(join(specsDir, "spec.md"), "utf8");
    // Should not add a second Clarifications block
    const matches = (content.match(/## Clarifications/g) ?? []).length;
    expect(matches).toBe(1);
  });

  it("returns the spec.md path on success", async () => {
    const specsDir = join(tmp, "docs", "specs", "f-003");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec\n", "utf8");

    const runner = makeRunner(tmp, "Clarification response");
    const result = await runner.runClarify("F-003", "Return Path Feature");

    expect(result).toBe(join(specsDir, "spec.md"));
  });
});

// ---------------------------------------------------------------------------
// runAnalyze
// ---------------------------------------------------------------------------

describe("runAnalyze – skip / write logic", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    makeTechStack(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null when no artifacts exist (spec, plan, tasks all missing)", async () => {
    const runner = makeRunner(tmp, "should not be called");
    const result = await runner.runAnalyze("F-EMPTY", "Empty Feature");
    expect(result).toBeNull();
  });

  it("writes analysis-report.md when at least spec.md exists", async () => {
    const specsDir = join(tmp, "docs", "specs", "f-001");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec\n", "utf8");

    const runner = makeRunner(tmp, "# Analysis Report\nAll consistent.");

    const result = await runner.runAnalyze("F-001", "Analyze Feature");

    const reportPath = join(specsDir, "analysis-report.md");
    expect(result).toBe(reportPath);
    expect(existsSync(reportPath)).toBe(true);
    expect(readFileSync(reportPath, "utf8")).toContain("Analysis Report");
  });

  it("writes analysis-report.md when all three artifacts exist", async () => {
    const specsDir = join(tmp, "docs", "specs", "f-002");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec\n", "utf8");
    writeFileSync(join(specsDir, "plan.md"), "# Plan\n", "utf8");
    writeFileSync(join(specsDir, "tasks.md"), "# Tasks\n", "utf8");

    const runner = makeRunner(tmp, "# Analysis\nNo gaps found.");

    const result = await runner.runAnalyze("F-002", "Full Analyze Feature");
    expect(result).toBeTruthy();
    expect(existsSync(join(specsDir, "analysis-report.md"))).toBe(true);
  });

  it("returns the analysis-report.md path on success", async () => {
    const specsDir = join(tmp, "docs", "specs", "f-003");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "plan.md"), "# Plan\n", "utf8");

    const runner = makeRunner(tmp, "Report content.");
    const result = await runner.runAnalyze("F-003", "Report Path Feature");

    expect(result).toBe(join(specsDir, "analysis-report.md"));
  });
});

// ---------------------------------------------------------------------------
// runPhases – constitution inclusion logic
// ---------------------------------------------------------------------------

describe("runPhases – constitution phase gating", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    makeTechStack(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("includes constitution phase when .speckit/constitution.md is missing", async () => {
    const constitutionPath = join(tmp, ".speckit", "constitution.md");
    // Ensure constitution does NOT exist
    expect(existsSync(constitutionPath)).toBe(false);

    const responses = [
      "# Constitution\nCoding standards.",               // constitution
      "# Feature Specification: F\nSpec content.",       // spec
      "Clarifications: none.",                            // clarify
      "# Implementation Plan: F\nPlan content.",         // plan
      "# Tasks: F\n- [ ] T001 Do work",                  // tasks
      "# Analysis Report\nAll good.",                    // analyze
      `<<<FILE: src/features/f-new/index.ts>>>\nexport const x = 1;\n<<<END_FILE>>>`, // implement
    ];

    let callCount = 0;
    const runner = makeRunner(tmp, "");
    runner.callClaude = async (_prompt) => responses[callCount++ % responses.length];

    const result = await runner.runPhases("F-NEW", "New Feature", [], "constitution");

    expect(result.success).toBe(true);
    // Constitution file should have been created
    expect(existsSync(constitutionPath)).toBe(true);
  });

  it("skips constitution phase when .speckit/constitution.md already exists", async () => {
    const constitutionPath = join(tmp, ".speckit", "constitution.md");
    mkdirSync(join(tmp, ".speckit"), { recursive: true });
    writeFileSync(constitutionPath, "# Existing Constitution", "utf8");

    const responses = [
      "# Feature Specification: F\nSpec content.",       // spec
      "Clarifications: none.",                            // clarify
      "# Implementation Plan: F\nPlan content.",         // plan
      "# Tasks: F\n- [ ] T001 Do work",                  // tasks
      "# Analysis Report\nAll good.",                    // analyze
      `<<<FILE: src/features/f-exist/index.ts>>>\nexport const x = 1;\n<<<END_FILE>>>`, // implement
    ];

    let callCount = 0;
    const runner = makeRunner(tmp, "");
    runner.callClaude = async (_prompt) => responses[callCount++ % responses.length];

    const result = await runner.runPhases("F-EXIST", "Existing Constitution Feature", [], "spec");

    expect(result.success).toBe(true);
    // Constitution content should be unchanged
    expect(readFileSync(constitutionPath, "utf8")).toBe("# Existing Constitution");
  });

  it("runPhases returns success:false when a phase throws", async () => {
    const runner = makeRunner(tmp, "");
    runner.callClaude = async () => {
      throw new Error("Simulated API failure");
    };

    const result = await runner.runPhases("F-FAIL", "Failing Feature", [], "spec");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Simulated API failure");
  });

  it("runPhases handles qa and done phases as no-ops (returns success)", async () => {
    const runner = makeRunner(tmp, "irrelevant");
    const qaResult = await runner.runPhases("F-QA", "QA Feature", [], "qa");
    expect(qaResult.success).toBe(true);

    const doneResult = await runner.runPhases("F-DONE", "Done Feature", [], "done");
    expect(doneResult.success).toBe(true);
  });
});
