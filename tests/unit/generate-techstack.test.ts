import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { generateTechStack, generateTechStackFromSnapshot } from "../../src/cli/generate-techstack.js";
import type { BrownfieldSnapshot } from "../../src/core/brownfield-snapshot.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "generate-techstack-test-"));
}

const PRODUCT_MD = `# My Product

## Tech Stack

### Backend
- Language / Runtime: Node.js 20
- Framework: Express

## Vision
A product.
`;

const TECH_STACK_RESPONSE = "# Tech Stack\n\n## Backend\n- Language / Runtime: Node.js 20\n- Framework: Express\n";

// ---------------------------------------------------------------------------
// generateTechStack
// ---------------------------------------------------------------------------

describe("generateTechStack", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("creates docs/tech-stack.md when absent", async () => {
    const root = makeTmp(); dirs.push(root);
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "product.md"), PRODUCT_MD, "utf8");

    const result = await generateTechStack(root, async () => TECH_STACK_RESPONSE);
    expect(result.created).toBe(true);
    expect(existsSync(result.techStackPath)).toBe(true);
    expect(readFileSync(result.techStackPath, "utf8")).toBe(TECH_STACK_RESPONSE);
  });

  it("skips when file exists and overwrite=false", async () => {
    const root = makeTmp(); dirs.push(root);
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "product.md"), PRODUCT_MD, "utf8");
    writeFileSync(join(root, "docs", "tech-stack.md"), "# Existing\n", "utf8");

    let called = false;
    const result = await generateTechStack(root, async () => { called = true; return TECH_STACK_RESPONSE; }, { overwrite: false });
    expect(result.created).toBe(false);
    expect(called).toBe(false);
    expect(readFileSync(join(root, "docs", "tech-stack.md"), "utf8")).toBe("# Existing\n");
  });

  it("backs up existing file and creates new one when overwrite=true", async () => {
    const root = makeTmp(); dirs.push(root);
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "product.md"), PRODUCT_MD, "utf8");
    writeFileSync(join(root, "docs", "tech-stack.md"), "# Old Stack\n", "utf8");

    const result = await generateTechStack(root, async () => TECH_STACK_RESPONSE, { overwrite: true });
    expect(result.created).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(existsSync(result.backupPath!)).toBe(true);
    expect(readFileSync(result.backupPath!, "utf8")).toBe("# Old Stack\n");
    expect(readFileSync(result.techStackPath, "utf8")).toBe(TECH_STACK_RESPONSE);
  });

  it("backup filename contains timestamp pattern (YYYYMMDD-HHmmss.bak.md)", async () => {
    const root = makeTmp(); dirs.push(root);
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "product.md"), PRODUCT_MD, "utf8");
    writeFileSync(join(root, "docs", "tech-stack.md"), "# Old\n", "utf8");

    const result = await generateTechStack(root, async () => TECH_STACK_RESPONSE, { overwrite: true });
    expect(result.backupPath).toMatch(/tech-stack\.\d{8}-\d{6}\.bak\.md$/);
  });

  it("throws when docs/product.md is absent", async () => {
    const root = makeTmp(); dirs.push(root);
    await expect(
      generateTechStack(root, async () => TECH_STACK_RESPONSE)
    ).rejects.toThrow("docs/product.md not found");
  });

  it("includes product.md content in the Claude prompt", async () => {
    const root = makeTmp(); dirs.push(root);
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "product.md"), PRODUCT_MD, "utf8");

    let capturedPrompt = "";
    await generateTechStack(root, async (prompt) => { capturedPrompt = prompt; return TECH_STACK_RESPONSE; });
    expect(capturedPrompt).toContain("PRODUCT SPECIFICATION");
    expect(capturedPrompt).toContain("My Product");
  });
});

// ---------------------------------------------------------------------------
// generateTechStackFromSnapshot
// ---------------------------------------------------------------------------

const MOCK_SNAPSHOT: BrownfieldSnapshot = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  featureTitle: "",
  techStack: {
    language: ["TypeScript", "JavaScript"],
    frameworks: ["Express", "React"],
    buildTools: ["Vite"],
    runtime: "Node.js",
  },
  projectStructure: ["src/", "tests/"],
  entryPoints: [{ file: "src/index.ts", purpose: "main" }],
  testFramework: { name: "Jest", location: "tests/", coverageTool: "v8" },
  conventions: [],
  integrationPoints: [],
  risks: [],
};

describe("generateTechStackFromSnapshot", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("creates docs/tech-stack.md from brownfield snapshot", async () => {
    const root = mkdtempSync(join(tmpdir(), "ts-snap-test-")); dirs.push(root);
    mkdirSync(join(root, "docs"), { recursive: true });

    const result = await generateTechStackFromSnapshot(root, async () => TECH_STACK_RESPONSE, MOCK_SNAPSHOT);
    expect(result.created).toBe(true);
    expect(existsSync(result.techStackPath)).toBe(true);
  });

  it("prompt includes detected languages from snapshot.techStack.language", async () => {
    const root = mkdtempSync(join(tmpdir(), "ts-snap-test-")); dirs.push(root);
    mkdirSync(join(root, "docs"), { recursive: true });

    let capturedPrompt = "";
    await generateTechStackFromSnapshot(root, async (p) => { capturedPrompt = p; return TECH_STACK_RESPONSE; }, MOCK_SNAPSHOT);
    expect(capturedPrompt).toContain("TypeScript");
    expect(capturedPrompt).toContain("JavaScript");
  });

  it("prompt includes detected frameworks from snapshot.techStack.frameworks", async () => {
    const root = mkdtempSync(join(tmpdir(), "ts-snap-test-")); dirs.push(root);
    mkdirSync(join(root, "docs"), { recursive: true });

    let capturedPrompt = "";
    await generateTechStackFromSnapshot(root, async (p) => { capturedPrompt = p; return TECH_STACK_RESPONSE; }, MOCK_SNAPSHOT);
    expect(capturedPrompt).toContain("Express");
    expect(capturedPrompt).toContain("React");
  });

  it("skips when docs/tech-stack.md already exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "ts-snap-test-")); dirs.push(root);
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "tech-stack.md"), "# Existing\n", "utf8");

    let called = false;
    const result = await generateTechStackFromSnapshot(root, async () => { called = true; return TECH_STACK_RESPONSE; }, MOCK_SNAPSHOT);
    expect(result.created).toBe(false);
    expect(called).toBe(false);
    expect(readFileSync(join(root, "docs", "tech-stack.md"), "utf8")).toBe("# Existing\n");
  });
});
