/**
 * Tests for generateProjectStructure() in bootstrap-product.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  generateProjectStructure,
  buildProjectStructurePrompt,
} from "../../src/cli/bootstrap-product.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "proj-struct-test-"));
}

function writeDocs(root: string, productContent: string, techStackContent: string): void {
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "product.md"), productContent, "utf8");
  writeFileSync(join(root, "docs", "tech-stack.md"), techStackContent, "utf8");
}

const MOCK_PRODUCT = `# My Product\n\n## Vision\nA product.\n`;
const MOCK_TECH_STACK = `# Tech Stack\n\n## Backend\n- Language / Runtime: TypeScript\n- Framework: Express\n`;
const MOCK_STRUCTURE = `# Project Structure\n\n## RULES (MANDATORY)\n- NEVER create src/api/ (use src/SignHub.Api/)\n`;

// ---------------------------------------------------------------------------
// buildProjectStructurePrompt
// ---------------------------------------------------------------------------

describe("buildProjectStructurePrompt", () => {
  it("includes the tech stack content", () => {
    const prompt = buildProjectStructurePrompt(MOCK_PRODUCT, MOCK_TECH_STACK);
    expect(prompt).toContain("TypeScript");
    expect(prompt).toContain("Express");
  });

  it("includes the first 50 lines of product.md", () => {
    const prompt = buildProjectStructurePrompt(MOCK_PRODUCT, MOCK_TECH_STACK);
    expect(prompt).toContain("My Product");
  });

  it("asks for MANDATORY rules section", () => {
    const prompt = buildProjectStructurePrompt(MOCK_PRODUCT, MOCK_TECH_STACK);
    expect(prompt).toContain("MANDATORY");
  });

  it("asks for a single structure (no alternatives)", () => {
    const prompt = buildProjectStructurePrompt(MOCK_PRODUCT, MOCK_TECH_STACK);
    expect(prompt).toMatch(/one single structure/i);
  });
});

// ---------------------------------------------------------------------------
// generateProjectStructure
// ---------------------------------------------------------------------------

describe("generateProjectStructure", () => {
  let tmp: string;

  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("generates project-structure.md when it does not exist", async () => {
    writeDocs(tmp, MOCK_PRODUCT, MOCK_TECH_STACK);
    const mockClaude = async () => MOCK_STRUCTURE;

    const result = await generateProjectStructure(tmp, mockClaude);

    expect(result.created).toBe(true);
    const outPath = join(tmp, "docs", "project-structure.md");
    expect(existsSync(outPath)).toBe(true);
    expect(readFileSync(outPath, "utf8")).toContain("MANDATORY");
  });

  it("skips generation when project-structure.md already exists (idempotent)", async () => {
    writeDocs(tmp, MOCK_PRODUCT, MOCK_TECH_STACK);
    writeFileSync(join(tmp, "docs", "project-structure.md"), "existing content", "utf8");
    let calledClaude = false;
    const mockClaude = async () => { calledClaude = true; return MOCK_STRUCTURE; };

    const result = await generateProjectStructure(tmp, mockClaude);

    expect(result.created).toBe(false);
    expect(calledClaude).toBe(false);
    expect(readFileSync(join(tmp, "docs", "project-structure.md"), "utf8")).toBe("existing content");
  });

  it("skips when product.md is missing", async () => {
    mkdirSync(join(tmp, "docs"), { recursive: true });
    writeFileSync(join(tmp, "docs", "tech-stack.md"), MOCK_TECH_STACK, "utf8");
    const mockClaude = async () => MOCK_STRUCTURE;

    const result = await generateProjectStructure(tmp, mockClaude);
    expect(result.created).toBe(false);
  });

  it("skips when tech-stack.md is missing", async () => {
    mkdirSync(join(tmp, "docs"), { recursive: true });
    writeFileSync(join(tmp, "docs", "product.md"), MOCK_PRODUCT, "utf8");
    const mockClaude = async () => MOCK_STRUCTURE;

    const result = await generateProjectStructure(tmp, mockClaude);
    expect(result.created).toBe(false);
  });

  it("skips writing when Claude returns commentary (not markdown starting with #)", async () => {
    writeDocs(tmp, MOCK_PRODUCT, MOCK_TECH_STACK);
    // Simulate Claude responding with a tool-use summary instead of markdown
    const mockClaude = async () => "The file already exists and is well-structured — no changes needed.";

    const result = await generateProjectStructure(tmp, mockClaude);

    expect(result.created).toBe(false);
    expect(existsSync(join(tmp, "docs", "project-structure.md"))).toBe(false);
  });
});
