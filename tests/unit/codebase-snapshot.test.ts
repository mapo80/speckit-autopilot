/**
 * Tests for updateCodebaseSnapshot() in ship.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { updateCodebaseSnapshot } from "../../src/cli/ship.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "codemap-test-"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("updateCodebaseSnapshot", () => {
  let tmp: string;

  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("creates docs/codebase-snapshot.md", () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src", "index.ts"), "export {};", "utf8");

    updateCodebaseSnapshot(tmp);

    expect(existsSync(join(tmp, "docs", "codebase-snapshot.md"))).toBe(true);
  });

  it("includes src/ files in the snapshot", () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src", "index.ts"), "export {};", "utf8");

    updateCodebaseSnapshot(tmp);

    const content = readFileSync(join(tmp, "docs", "codebase-snapshot.md"), "utf8");
    expect(content).toContain("src/index.ts");
  });

  it("excludes docs/ directory", () => {
    mkdirSync(join(tmp, "docs"), { recursive: true });
    writeFileSync(join(tmp, "docs", "product.md"), "# Product", "utf8");
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src", "app.ts"), "export {};", "utf8");

    updateCodebaseSnapshot(tmp);

    const content = readFileSync(join(tmp, "docs", "codebase-snapshot.md"), "utf8");
    // src file should be there
    expect(content).toContain("src/app.ts");
    // docs files should NOT appear (they're excluded)
    expect(content).not.toContain("docs/product.md");
  });

  it("excludes node_modules/ directory", () => {
    mkdirSync(join(tmp, "node_modules", "some-lib"), { recursive: true });
    writeFileSync(join(tmp, "node_modules", "some-lib", "index.js"), "module.exports={}", "utf8");

    updateCodebaseSnapshot(tmp);

    const content = readFileSync(join(tmp, "docs", "codebase-snapshot.md"), "utf8");
    expect(content).not.toContain("node_modules");
  });

  it("excludes .git/ directory", () => {
    mkdirSync(join(tmp, ".git"), { recursive: true });
    writeFileSync(join(tmp, ".git", "HEAD"), "ref: refs/heads/main", "utf8");

    updateCodebaseSnapshot(tmp);

    const content = readFileSync(join(tmp, "docs", "codebase-snapshot.md"), "utf8");
    expect(content).not.toContain(".git");
  });

  it("files are sorted alphabetically", () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src", "z-last.ts"), "", "utf8");
    writeFileSync(join(tmp, "src", "a-first.ts"), "", "utf8");

    updateCodebaseSnapshot(tmp);

    const content = readFileSync(join(tmp, "docs", "codebase-snapshot.md"), "utf8");
    const aIdx = content.indexOf("a-first.ts");
    const zIdx = content.indexOf("z-last.ts");
    expect(aIdx).toBeLessThan(zIdx);
  });

  it("each file appears as '- path/to/file' on its own line", () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src", "main.ts"), "", "utf8");

    updateCodebaseSnapshot(tmp);

    const content = readFileSync(join(tmp, "docs", "codebase-snapshot.md"), "utf8");
    expect(content).toMatch(/^- src\/main\.ts$/m);
  });

  it("updates the timestamp on second call", async () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src", "app.ts"), "", "utf8");

    updateCodebaseSnapshot(tmp);
    const first = readFileSync(join(tmp, "docs", "codebase-snapshot.md"), "utf8");

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 5));
    updateCodebaseSnapshot(tmp);
    const second = readFileSync(join(tmp, "docs", "codebase-snapshot.md"), "utf8");

    // Both contain a "Updated:" line
    expect(first).toContain("Updated:");
    expect(second).toContain("Updated:");
    // Content still has the file
    expect(second).toContain("src/app.ts");
  });

  it("works with an empty project (no source files)", () => {
    updateCodebaseSnapshot(tmp);

    const content = readFileSync(join(tmp, "docs", "codebase-snapshot.md"), "utf8");
    expect(content).toContain("# Codebase File Tree");
  });
});
