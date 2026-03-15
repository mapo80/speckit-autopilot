/**
 * Tests for BUG#11 fix: extractGeneratedFiles handles CRLF line endings,
 * trailing spaces in paths, and gracefully returns an empty array when no
 * FILE blocks are present.
 */
import { describe, it, expect } from "@jest/globals";
import { extractGeneratedFiles } from "../../src/core/spec-kit-runner.js";

// ---------------------------------------------------------------------------
// CRLF line endings
// ---------------------------------------------------------------------------

describe("extractGeneratedFiles – CRLF line endings (BUG#11)", () => {
  it("extracts a single file block with CRLF line endings", () => {
    const response =
      "<<<FILE: src/foo.ts>>>\r\nexport const x = 1;\r\n<<<END_FILE>>>";

    const files = extractGeneratedFiles(response);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/foo.ts");
    expect(files[0].content).toContain("export const x = 1;");
  });

  it("extracts multiple files with CRLF endings", () => {
    const response =
      "<<<FILE: src/a.ts>>>\r\nexport const a = 1;\r\n<<<END_FILE>>>\r\n" +
      "<<<FILE: src/b.ts>>>\r\nexport const b = 2;\r\n<<<END_FILE>>>";

    const files = extractGeneratedFiles(response);

    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("src/a.ts");
    expect(files[1].path).toBe("src/b.ts");
  });

  it("preserves file content when CRLF is present inside the file block", () => {
    const response =
      "<<<FILE: src/service.ts>>>\r\n" +
      "export class Service {\r\n" +
      "  run() { return true; }\r\n" +
      "}\r\n" +
      "<<<END_FILE>>>";

    const files = extractGeneratedFiles(response);

    expect(files).toHaveLength(1);
    expect(files[0].content).toContain("export class Service");
    expect(files[0].content).toContain("run()");
  });

  it("extracts path correctly even when CRLF appears immediately after the path marker", () => {
    const response = "<<<FILE: src/utils/helper.ts>>>\r\nexport function helper() {}\r\n<<<END_FILE>>>";

    const files = extractGeneratedFiles(response);

    expect(files[0].path).toBe("src/utils/helper.ts");
  });
});

// ---------------------------------------------------------------------------
// Trailing spaces in path
// ---------------------------------------------------------------------------

describe("extractGeneratedFiles – trailing spaces in path", () => {
  it("trims trailing spaces from a file path", () => {
    const response = "<<<FILE: src/foo.ts   >>>\nexport const x = 1;\n<<<END_FILE>>>";

    const files = extractGeneratedFiles(response);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/foo.ts");
  });

  it("trims leading and trailing spaces from a file path", () => {
    const response = "<<<FILE:   src/bar.ts   >>>\nexport const y = 2;\n<<<END_FILE>>>";

    const files = extractGeneratedFiles(response);

    expect(files[0].path).toBe("src/bar.ts");
  });

  it("handles tabs as whitespace in file path", () => {
    const response = "<<<FILE:\tsrc/baz.ts\t>>>\nexport const z = 3;\n<<<END_FILE>>>";

    const files = extractGeneratedFiles(response);

    // The path is trimmed so leading/trailing whitespace (including tabs) should be removed
    expect(files[0].path).toBe("src/baz.ts");
  });
});

// ---------------------------------------------------------------------------
// Zero files — empty array, not an error
// ---------------------------------------------------------------------------

describe("extractGeneratedFiles – zero files returns empty array", () => {
  it("returns empty array for plain text response", () => {
    const result = extractGeneratedFiles("The implementation is complete.");
    expect(result).toEqual([]);
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns empty array for empty string", () => {
    const result = extractGeneratedFiles("");
    expect(result).toEqual([]);
  });

  it("returns empty array when only markdown prose is present", () => {
    const response = `
# Summary
Here is what I implemented:
- Created a user service
- Added authentication middleware

All files have been written.
    `;
    const result = extractGeneratedFiles(response);
    expect(result).toEqual([]);
  });

  it("returns empty array when FILE markers are malformed (missing END_FILE)", () => {
    const response = "<<<FILE: src/foo.ts>>>\nexport const x = 1;\n";
    // No <<<END_FILE>>> so the regex cannot match
    const result = extractGeneratedFiles(response);
    expect(result).toEqual([]);
  });

  it("returns empty array when response is only whitespace", () => {
    const result = extractGeneratedFiles("   \n\n\t  ");
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Canonical extraction (regression guard for existing behaviour)
// ---------------------------------------------------------------------------

describe("extractGeneratedFiles – canonical extraction", () => {
  it("extracts a single LF-terminated file block", () => {
    const response =
      "<<<FILE: src/features/my-feature/index.ts>>>\n" +
      "export function hello() { return 'world'; }\n" +
      "<<<END_FILE>>>\n";

    const files = extractGeneratedFiles(response);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/features/my-feature/index.ts");
    expect(files[0].content).toContain("hello");
  });

  it("extracts multiple files in sequence", () => {
    const response =
      "<<<FILE: src/a.ts>>>\nexport const A = 1;\n<<<END_FILE>>>\n\n" +
      "<<<FILE: src/b.ts>>>\nexport type B = string;\n<<<END_FILE>>>\n";

    const files = extractGeneratedFiles(response);

    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("src/a.ts");
    expect(files[1].path).toBe("src/b.ts");
  });

  it("falls back to markdown code blocks when no FILE markers present", () => {
    const response =
      "```typescript\n// file: src/features/my-feat/index.ts\nexport const x = 1;\n```";

    const files = extractGeneratedFiles(response);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/features/my-feat/index.ts");
  });

  it("path comment fallback also works with path: prefix", () => {
    const response =
      "```typescript\n// path: src/utils/tool.ts\nexport function tool() {}\n```";

    const files = extractGeneratedFiles(response);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/utils/tool.ts");
  });

  it("does not return markdown fallback files when primary FILE blocks are present", () => {
    // Primary FILE blocks take precedence; fallback should NOT be attempted
    const response =
      "<<<FILE: src/primary.ts>>>\nexport const p = 1;\n<<<END_FILE>>>\n" +
      "```typescript\n// file: src/secondary.ts\nexport const s = 2;\n```";

    const files = extractGeneratedFiles(response);

    // Only the primary FILE block should be extracted
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/primary.ts");
  });
});
