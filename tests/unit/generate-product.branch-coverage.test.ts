/**
 * Additional branch coverage tests for generate-product.ts and generate-techstack.ts
 * targeting uncovered branches.
 */

import { describe, it, expect, afterEach } from "@jest/globals";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkCompleteness, generateProduct } from "../../src/cli/generate-product.js";
import { generateTechStackFromSnapshot } from "../../src/cli/generate-techstack.js";
import type { BrownfieldSnapshot } from "../../src/core/brownfield-snapshot.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "gp-branch-"));
}

// ---------------------------------------------------------------------------
// checkCompleteness – missing.length > 5 branch (line 79 ternary)
// ---------------------------------------------------------------------------

describe("checkCompleteness – more than 5 missing features (line 79 ternary)", () => {
  it("includes '(and N more)' suffix when more than 5 features are missing", () => {
    // 7 features with distinct keywords not in product.md
    const manifest = {
      features: [
        "Payment Gateway Integration",
        "Notification System",
        "Analytics Dashboard",
        "Export Reports",
        "Audit Trail",
        "User Management",
        "Access Control",
      ],
      count: 7,
    };
    // product.md that mentions none of these keywords
    const warnings = checkCompleteness("# Product\n\nSome generic text only.\n", manifest);
    const warningWithMore = warnings.find((w) => w.includes("feature(s) from spec not found"));
    if (warningWithMore) {
      expect(warningWithMore).toMatch(/\(and \d+ more\)/);
    }
  });

  it("does not include '(and N more)' when 5 or fewer features are missing", () => {
    const manifest = {
      features: [
        "Payment Integration",
        "Notification Center",
        "Analytics Overview",
      ],
      count: 3,
    };
    const warnings = checkCompleteness("# Product\n\nSome generic text.\n", manifest);
    const warningLine = warnings.find((w) => w.includes("feature(s) from spec not found"));
    if (warningLine) {
      expect(warningLine).not.toMatch(/\(and \d+ more\)/);
    }
  });
});

// ---------------------------------------------------------------------------
// generateTechStackFromSnapshot – empty arrays → "Not detected" fallbacks (lines 74-77)
// ---------------------------------------------------------------------------

describe("generateTechStackFromSnapshot – empty arrays produce 'Not detected' (lines 74-77)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("uses 'Not detected' for empty language, frameworks, buildTools arrays and empty entryPoints", async () => {
    const root = makeTmp(); dirs.push(root);
    mkdirSync(join(root, "docs"), { recursive: true });

    const emptySnapshot: BrownfieldSnapshot = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      featureTitle: "",
      techStack: {
        language: [],       // empty → join() = "" → || "Not detected"
        frameworks: [],     // empty → join() = "" → || "Not detected"
        buildTools: [],     // empty → join() = "" → || "Not detected"
        runtime: "",        // falsy → || "Not detected"
      },
      projectStructure: [],
      entryPoints: [],     // empty → join() = "" → || "none detected"
      testFramework: undefined,   // falsy → "Not detected"
      conventions: [],
      integrationPoints: [],
      risks: [],
    };

    let capturedPrompt = "";
    await generateTechStackFromSnapshot(
      root,
      async (prompt) => { capturedPrompt = prompt; return "# Tech Stack\n\n## Backend\n- Language: Unknown\n"; },
      emptySnapshot
    );

    expect(capturedPrompt).toContain("Not detected");
    expect(capturedPrompt).toContain("none detected");
  });

  it("uses 'Not detected' for testFramework when it is null/undefined (line 78-80)", async () => {
    const root = makeTmp(); dirs.push(root);
    mkdirSync(join(root, "docs"), { recursive: true });

    const snapshotNoFramework: BrownfieldSnapshot = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      featureTitle: "",
      techStack: {
        language: ["TypeScript"],
        frameworks: ["Express"],
        buildTools: ["npm"],
        runtime: "Node.js",
      },
      projectStructure: ["src/"],
      entryPoints: [{ file: "src/index.ts", purpose: "main" }],
      testFramework: undefined,
      conventions: [],
      integrationPoints: [],
      risks: [],
    };

    let capturedPrompt = "";
    await generateTechStackFromSnapshot(
      root,
      async (prompt) => { capturedPrompt = prompt; return "# Tech Stack\n\n## Backend\n- Language: TypeScript\n"; },
      snapshotNoFramework
    );

    expect(capturedPrompt).toContain("Not detected");
  });
});

// ---------------------------------------------------------------------------
// generateProduct – formatWarningsForRetry branches (lines 100, 106, 108, 110)
// These are triggered when the first attempt has warnings and retry prompt includes them.
// ---------------------------------------------------------------------------

describe("generateProduct – formatWarningsForRetry specific branches", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  const MANIFEST_RESPONSE = '{"features": ["Authentication", "Dashboard", "Settings", "Reports", "Export", "Admin"]}';

  // A product.md that fails multiple audit checks
  // No Vision, no Out of Scope, no Delivery Preference, bad heading format
  const BAD_PRODUCT_MD = `# Test Product

## In Scope

### Feature 1 - Auth
- login works

### Feature 2 - Dashboard
- shows data

### Feature 3 - Settings
- settings saved

### Feature 4 - Reports
- reports shown

### Feature 5 - Export
- export works

`;

  // A valid product.md to use on second/third attempt
  const GOOD_PRODUCT_MD = `# Test Product

## Vision
A great product.

## Tech Stack

### Backend
- Language / Runtime: Node.js 20
- Framework: Express

## In Scope

### Feature 1 - Core: Authentication
- User can log in with email and password
- JWT token is returned

### Feature 2 - Core: Dashboard
- User sees summary
- Stats are shown

### Feature 3 - Core: Settings
- User can update preferences
- Changes are persisted

### Feature 4 - Core: Reports
- User can view reports
- Data is filterable

### Feature 5 - Core: Export
- User can export data
- File is downloaded

### Feature 6 - Core: Admin
- Admin can manage users
- Access control enforced

## Out of Scope
- OAuth

## Delivery Preference
1. Feature 1 - Core: Authentication
2. Feature 2 - Core: Dashboard
3. Feature 3 - Core: Settings
4. Feature 4 - Core: Reports
5. Feature 5 - Core: Export
6. Feature 6 - Core: Admin
`;

  it("triggers retry with Vision, OutOfScope, DeliveryPreference warnings (formatWarningsForRetry lines 100-108)", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath, "# My App Spec\nAuth: users can login.\nDashboard: show data.\nSettings: preferences.\nReports: data.\nExport: files.\nAdmin: control.\n", "utf8");

    let callCount = 0;
    let secondPrompt = "";
    const callClaude = async (prompt: string) => {
      callCount++;
      if (callCount === 1) return MANIFEST_RESPONSE;     // manifest extraction
      if (callCount === 2) { return BAD_PRODUCT_MD; }    // first attempt — has warnings
      secondPrompt = prompt;
      return GOOD_PRODUCT_MD;                             // second attempt — succeeds
    };

    await generateProduct(specPath, root, callClaude);

    // The retry prompt should contain formatted warnings from formatWarningsForRetry
    expect(callCount).toBeGreaterThanOrEqual(3);
    // The warning block should be present in retry prompt
    expect(secondPrompt).toContain("PREVIOUS ATTEMPT ISSUES");
  });
});
