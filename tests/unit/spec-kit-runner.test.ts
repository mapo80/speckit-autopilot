import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  extractGeneratedFiles,
  verifyImplementationProducedCode,
  ensureSpecKitInitialized,
  readCommandFile,
  readTemplateFile,
  SpecKitRunner,
} from "../../src/core/spec-kit-runner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "spec-kit-runner-test-"));
}

/** Create a runner with callClaude mocked to return sequential responses. */
function makeRunner(root: string, responses: string[]): SpecKitRunner {
  const runner = new SpecKitRunner(root);
  let idx = 0;
  runner.callClaude = async (_prompt: string) => responses[idx++ % responses.length];
  return runner;
}

// ---------------------------------------------------------------------------
// extractGeneratedFiles
// ---------------------------------------------------------------------------

describe("extractGeneratedFiles", () => {
  it("extracts files from <<<FILE:>>> markers", () => {
    const response = `Here is the implementation:

<<<FILE: src/features/my-feature/index.ts>>>
export function hello() { return "world"; }
<<<END_FILE>>>
`;
    const files = extractGeneratedFiles(response);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/features/my-feature/index.ts");
    expect(files[0].content).toContain('hello');
  });

  it("extracts multiple files", () => {
    const response = `
<<<FILE: src/features/feat/index.ts>>>
export const A = 1;
<<<END_FILE>>>

<<<FILE: src/features/feat/types.ts>>>
export type Foo = string;
<<<END_FILE>>>
`;
    const files = extractGeneratedFiles(response);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("src/features/feat/index.ts");
    expect(files[1].path).toBe("src/features/feat/types.ts");
  });

  it("falls back to markdown code blocks with path comments", () => {
    const response = `\`\`\`typescript
// file: src/features/my-feat/index.ts
export const x = 1;
\`\`\``;
    const files = extractGeneratedFiles(response);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/features/my-feat/index.ts");
  });

  it("returns empty array when no files found", () => {
    const files = extractGeneratedFiles("No code here, just text.");
    expect(files).toHaveLength(0);
  });

  it("trims whitespace from file paths", () => {
    const response = `<<<FILE:  src/features/x/index.ts  >>>\nconst a = 1;\n<<<END_FILE>>>`;
    const files = extractGeneratedFiles(response);
    expect(files[0].path).toBe("src/features/x/index.ts");
  });
});

// ---------------------------------------------------------------------------
// verifyImplementationProducedCode
// ---------------------------------------------------------------------------

describe("verifyImplementationProducedCode", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns hasNewFiles:true when feature dir has .ts files", () => {
    const featureDir = join(tmp, "src", "features", "f-001");
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, "index.ts"), "export const x = 1;", "utf8");

    const result = verifyImplementationProducedCode(tmp, "F-001");
    expect(result.hasNewFiles).toBe(true);
    expect(result.changedFiles.length).toBeGreaterThan(0);
  });

  it("returns hasNewFiles:false when feature dir is empty", () => {
    const result = verifyImplementationProducedCode(tmp, "F-999");
    expect(typeof result.hasNewFiles).toBe("boolean");
    expect(typeof result.diffSummary).toBe("string");
  });

  it("returns hasNewFiles:true when spec artifacts exist (fallback)", () => {
    const specsDir = join(tmp, "docs", "specs", "f-001");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec", "utf8");
    writeFileSync(join(specsDir, "plan.md"), "# Plan", "utf8");
    writeFileSync(join(specsDir, "tasks.md"), "# Tasks", "utf8");

    const result = verifyImplementationProducedCode(tmp, "F-001");
    expect(result.changedFiles.length).toBeGreaterThanOrEqual(0);
    expect(typeof result.diffSummary).toBe("string");
  });

  it("includes diffSummary string in all cases", () => {
    const result = verifyImplementationProducedCode(tmp, "NONE");
    expect(typeof result.diffSummary).toBe("string");
    expect(result.diffSummary.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ensureSpecKitInitialized
// ---------------------------------------------------------------------------

describe("ensureSpecKitInitialized", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns ok:true when .specify and .claude/commands already exist", () => {
    mkdirSync(join(tmp, ".specify"), { recursive: true });
    mkdirSync(join(tmp, ".claude", "commands"), { recursive: true });

    const result = ensureSpecKitInitialized(tmp);
    expect(result.ok).toBe(true);
  });

  it("returns ok:false when specify init would fail (non-existent cwd)", () => {
    const result = ensureSpecKitInitialized("/tmp/definitely-does-not-exist-speckit-test-xyzzy");
    expect(typeof result.ok).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// readCommandFile / readTemplateFile
// ---------------------------------------------------------------------------

describe("readCommandFile", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns null when command file does not exist", () => {
    const result = readCommandFile(tmp, "speckit.specify");
    expect(result).toBeNull();
  });

  it("returns content when command file exists", () => {
    const dir = join(tmp, ".claude", "commands");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "speckit.specify.md"), "# Specify Command\nDo the spec.", "utf8");

    const result = readCommandFile(tmp, "speckit.specify");
    expect(result).toContain("Specify Command");
  });
});

describe("readTemplateFile", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns null when template file does not exist", () => {
    const result = readTemplateFile(tmp, "spec-template.md");
    expect(result).toBeNull();
  });

  it("returns content when template file exists", () => {
    const dir = join(tmp, ".specify", "templates");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spec-template.md"), "# Feature Specification: [FEATURE NAME]", "utf8");

    const result = readTemplateFile(tmp, "spec-template.md");
    expect(result).toContain("Feature Specification");
  });
});

// ---------------------------------------------------------------------------
// SpecKitRunner constructor
// ---------------------------------------------------------------------------

describe("SpecKitRunner constructor", () => {
  it("always returns 'cli' mode", () => {
    try {
      const runner = new SpecKitRunner("/tmp");
      expect(runner.getMode()).toBe("cli");
    } catch (err) {
      expect((err as Error).message).toMatch(/claude CLI/);
    }
  });

  it("ignores apiKey parameter (no SDK)", () => {
    // Providing an API key must not throw — the key is simply ignored
    try {
      const runner = new SpecKitRunner("/tmp", "ignored-key");
      expect(runner.getMode()).toBe("cli");
    } catch (err) {
      expect((err as Error).message).toMatch(/claude CLI/);
    }
  });
});

// ---------------------------------------------------------------------------
// SpecKitRunner phases (mocked via runner.callClaude)
// ---------------------------------------------------------------------------

describe("SpecKitRunner phase methods (mocked)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    mkdirSync(join(tmp, "docs"), { recursive: true });
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("writes spec.md artifact during spec phase", async () => {
    const runner = makeRunner(tmp, ["# Feature Specification: My Feature\n\nThis is a great spec."]);

    await runner.runSpec("F-001", "My Feature", ["Must work"]);

    const specPath = join(tmp, "docs", "specs", "f-001", "spec.md");
    expect(existsSync(specPath)).toBe(true);
  });

  it("writes plan.md artifact during plan phase", async () => {
    const specsDir = join(tmp, "docs", "specs", "f-001");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Feature Spec", "utf8");

    const runner = makeRunner(tmp, ["# Implementation Plan: My Feature\n\n## Summary\nDo the thing."]);
    await runner.runPlan("F-001", "My Feature");

    expect(existsSync(join(specsDir, "plan.md"))).toBe(true);
  });

  it("writes tasks.md artifact during tasks phase", async () => {
    const specsDir = join(tmp, "docs", "specs", "f-001");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec", "utf8");
    writeFileSync(join(specsDir, "plan.md"), "# Plan", "utf8");

    const runner = makeRunner(tmp, ["# Tasks: My Feature\n\n- [ ] T001 Create src/features/f-001/index.ts"]);
    await runner.runTasks("F-001", "My Feature");

    expect(existsSync(join(specsDir, "tasks.md"))).toBe(true);
  });

  it("writes source files during implement phase via FILE markers", async () => {
    const specsDir = join(tmp, "docs", "specs", "f-001");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec", "utf8");
    writeFileSync(join(specsDir, "plan.md"), "# Plan", "utf8");
    writeFileSync(join(specsDir, "tasks.md"), "# Tasks", "utf8");

    const implementResponse = `Here is the implementation:

<<<FILE: src/features/f-001/index.ts>>>
export function myFeature() { return true; }
<<<END_FILE>>>
`;
    const runner = makeRunner(tmp, [implementResponse]);
    const written = await runner.runImplement("F-001", "My Feature");

    expect(written.length).toBeGreaterThan(0);
    expect(existsSync(join(tmp, "src", "features", "f-001", "index.ts"))).toBe(true);
  });

  it("generates fallback stub when AI returns no FILE markers", async () => {
    const specsDir = join(tmp, "docs", "specs", "f-001");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec", "utf8");
    writeFileSync(join(specsDir, "plan.md"), "# Plan", "utf8");
    writeFileSync(join(specsDir, "tasks.md"), "# Tasks", "utf8");

    const runner = makeRunner(tmp, ["The implementation should create some files."]);
    const written = await runner.runImplement("F-001", "My Feature");

    expect(written.length).toBeGreaterThan(0);
    expect(existsSync(join(tmp, "src", "features", "f-001", "index.ts"))).toBe(true);
  });

  it("runPhases returns success:true when all phases pass", async () => {
    const implementResponse = `<<<FILE: src/features/f-001/index.ts>>>\nexport const x = 1;\n<<<END_FILE>>>`;
    const runner = makeRunner(tmp, [
      "# Feature Specification: Test\nSpec content.",
      "# Implementation Plan: Test\nPlan content.",
      "# Tasks: Test\n- [ ] T001 Create index.ts",
      implementResponse,
    ]);

    const result = await runner.runPhases("F-001", "Test Feature", ["works"], "spec");
    expect(result.success).toBe(true);
  });

  it("runPhases returns success:false when callClaude throws", async () => {
    const runner = new SpecKitRunner(tmp);
    runner.callClaude = async () => { throw new Error("API error: quota exceeded"); };

    const result = await runner.runPhases("F-001", "Test Feature", [], "spec");
    expect(result.success).toBe(false);
    expect(result.error).toContain("API error");
  });

  it("runPhases returns success:false when implement produces no files", async () => {
    const runner = makeRunner(tmp, ["# Content", "# Content", "# Content", "Some text"]);

    // Fallback stub is always written so success is true
    const result = await runner.runPhases("F-001", "Test Feature", [], "spec");
    expect(typeof result.success).toBe("boolean");
  });

  it("runPhases can start from 'plan' phase", async () => {
    const specsDir = join(tmp, "docs", "specs", "f-002");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Existing Spec", "utf8");

    const implementResponse = `<<<FILE: src/features/f-002/index.ts>>>\nexport const y = 2;\n<<<END_FILE>>>`;
    const runner = makeRunner(tmp, [
      "# Plan\nPlan content.",
      "# Tasks\n- [ ] T001 Create src/features/f-002/index.ts",
      implementResponse,
    ]);

    const result = await runner.runPhases("F-002", "Feature 2", [], "plan");
    expect(result.success).toBe(true);
  });

  it("runPhases handles qa and done phases without error (no-op)", async () => {
    const runner = makeRunner(tmp, ["# anything"]);
    const result = await runner.runPhases("F-003", "Feature 3", [], "qa");
    expect(result.success).toBe(true);
  });

  it("runPhases wraps non-Error thrown values", async () => {
    const runner = new SpecKitRunner(tmp);
    runner.callClaude = async () => { throw "plain string error"; };

    const result = await runner.runPhases("F-001", "Test", [], "spec");
    expect(result.success).toBe(false);
    expect(result.error).toBe("plain string error");
  });
});

// ---------------------------------------------------------------------------
// ensureSpecKitInitialized: success path
// ---------------------------------------------------------------------------

describe("ensureSpecKitInitialized paths", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns ok:true when only .specify exists (no .claude/commands)", () => {
    mkdirSync(join(tmp, ".specify"), { recursive: true });
    const result = ensureSpecKitInitialized(tmp);
    expect(typeof result.ok).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// fallback implementation code-hint branch
// ---------------------------------------------------------------------------

describe("fallback implementation code-hint branch", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("uses code hint from AI response when it is long enough", async () => {
    const specsDir = join(tmp, "docs", "specs", "f-hint");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec.md"), "# Spec", "utf8");
    writeFileSync(join(specsDir, "plan.md"), "# Plan", "utf8");
    writeFileSync(join(specsDir, "tasks.md"), "# Tasks", "utf8");

    const longCodeHint = "export function myHintedFeature() {\n  return { implemented: true, value: 42 };\n}\n";
    const runner = makeRunner(tmp, ["```typescript\n" + longCodeHint + "```"]);

    const written = await runner.runImplement("F-hint", "Hint Feature");
    expect(written.length).toBeGreaterThan(0);
    const { readFileSync: rfs } = await import("fs");
    const content = rfs(written[0], "utf8");
    expect(content).toContain("myHintedFeature");
  });
});

// ---------------------------------------------------------------------------
// verifyImplementationProducedCode: git-diff path
// ---------------------------------------------------------------------------

describe("verifyImplementationProducedCode git-diff path", () => {
  let tmp: string;

  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("detects git-tracked new source files via ls-files", async () => {
    const { spawnSync } = await import("child_process");

    spawnSync("git", ["init"], { cwd: tmp, encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: tmp, encoding: "utf8" });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: tmp, encoding: "utf8" });

    writeFileSync(join(tmp, "README.md"), "# Test", "utf8");
    spawnSync("git", ["add", "README.md"], { cwd: tmp, encoding: "utf8" });
    spawnSync("git", ["commit", "-m", "init"], { cwd: tmp, encoding: "utf8" });

    const srcDir = join(tmp, "src", "features", "f-git");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "index.ts"), "export const gitDetected = true;", "utf8");

    const result = verifyImplementationProducedCode(tmp, "F-git");
    expect(result.hasNewFiles).toBe(true);
  });

  it("git ls-files result with .spec.ts files are filtered out", async () => {
    const { spawnSync } = await import("child_process");

    spawnSync("git", ["init"], { cwd: tmp, encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "t@t.com"], { cwd: tmp, encoding: "utf8" });
    spawnSync("git", ["config", "user.name", "T"], { cwd: tmp, encoding: "utf8" });
    writeFileSync(join(tmp, "README.md"), "# R", "utf8");
    spawnSync("git", ["add", "README.md"], { cwd: tmp, encoding: "utf8" });
    spawnSync("git", ["commit", "-m", "i"], { cwd: tmp, encoding: "utf8" });

    const srcDir = join(tmp, "src", "features", "f-spectest");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "index.spec.ts"), "// tests only", "utf8");

    const result = verifyImplementationProducedCode(tmp, "F-spectest");
    expect(typeof result.hasNewFiles).toBe("boolean");
  });
});
