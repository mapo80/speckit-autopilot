import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { auditGenerate, auditBootstrap } from "../../src/cli/audit.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "audit-test-"));
}

function writeProductMd(root: string, content: string): void {
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "product.md"), content, "utf8");
}

function writeBacklogYaml(root: string, features: object[]): void {
  mkdirSync(join(root, "docs"), { recursive: true });
  const yaml = `version: '1'\ngeneratedAt: '2024-01-01T00:00:00.000Z'\nfeatures:\n${features
    .map((f) => {
      const obj = f as Record<string, unknown>;
      const ac = (obj.acceptanceCriteria as string[] | undefined) ?? [];
      const acPart = ac.length > 0
        ? `acceptanceCriteria:\n${ac.map((c: string) => `  - '${c}'`).join("\n")}`
        : `acceptanceCriteria: []`;
      return `- id: '${obj.id}'\n  title: '${obj.title}'\n  epic: Core\n  status: '${obj.status ?? "open"}'\n  priority: medium\n  dependsOn: []\n  ${acPart}\n  estimatedComplexity: medium\n  specKitBranch: ''\n  notes: ''`;
    })
    .join("\n")}`;
  writeFileSync(join(root, "docs", "product-backlog.yaml"), yaml, "utf8");
}

const VALID_PRODUCT_MD = `# My Product

## Vision
A great product.

## In Scope

### Feature 1 - Auth: Login
- User can log in with email and password
- JWT token is returned on success

### Feature 2 - Auth: Register
- User can create an account with email/password
- Validation errors are returned for invalid input

### Feature 3 - Dashboard: Overview
- User sees summary of recent activity
- Widget counts are refreshed every 30s

### Feature 4 - Dashboard: Settings
- User can update display preferences
- Changes are persisted immediately

### Feature 5 - API: Healthcheck
- GET /health returns 200 OK with uptime

## Out of Scope
- OAuth

## Delivery Preference
1. Feature 1 - Auth: Login
2. Feature 2 - Auth: Register
3. Feature 3 - Dashboard: Overview
4. Feature 4 - Dashboard: Settings
5. Feature 5 - API: Healthcheck
`;

// ---------------------------------------------------------------------------
// auditGenerate
// ---------------------------------------------------------------------------

describe("auditGenerate", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("returns valid=false when product.md is missing", () => {
    const root = makeTmp(); dirs.push(root);
    const result = auditGenerate(root);
    expect(result.valid).toBe(false);
    expect(result.featureCount).toBe(0);
    expect(result.warnings).toContain("docs/product.md not found");
  });

  it("returns valid product.md with correct feature count", () => {
    const root = makeTmp(); dirs.push(root);
    writeProductMd(root, VALID_PRODUCT_MD);
    const result = auditGenerate(root);
    expect(result.valid).toBe(true);
    expect(result.featureCount).toBe(5);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns when product.md has 0 features", () => {
    const root = makeTmp(); dirs.push(root);
    writeProductMd(root, "# Empty Product\n\n## Vision\nNothing here.\n");
    const result = auditGenerate(root);
    expect(result.valid).toBe(false);
    expect(result.featureCount).toBe(0);
    expect(result.warnings.some((w) => w.includes("No features extracted"))).toBe(true);
  });

  it("warns when feature count < 5", () => {
    const root = makeTmp(); dirs.push(root);
    writeProductMd(root, `# Tiny Product\n\n## In Scope\n\n### Feature 1 - Core: Something\n- criterion one\n\n## Delivery Preference\n1. Feature 1 - Core: Something\n`);
    const result = auditGenerate(root);
    expect(result.valid).toBe(true);
    expect(result.featureCount).toBe(1);
    expect(result.warnings.some((w) => w.includes("Only 1 features extracted"))).toBe(true);
  });

  it("warns when Delivery Preference section is missing", () => {
    const root = makeTmp(); dirs.push(root);
    writeProductMd(root, `# My Product\n\n## In Scope\n\n### Feature 1 - A\n- criterion\n### Feature 2 - B\n- criterion\n### Feature 3 - C\n- criterion\n### Feature 4 - D\n- criterion\n### Feature 5 - E\n- criterion\n`);
    const result = auditGenerate(root);
    expect(result.warnings.some((w) => w.includes("Delivery Preference"))).toBe(true);
  });

  it("warns when a feature has no acceptance criteria", () => {
    const root = makeTmp(); dirs.push(root);
    writeProductMd(root, `# My Product\n\n## In Scope\n\n### Feature 1 Core: Has Criteria\n- has criteria\n\n### Feature 2 Core: No Criteria\n\n(no bullets here)\n\n### Feature 3 Core: Has More\n- criterion\n### Feature 4 Core: Has More\n- criterion\n### Feature 5 Core: Has More\n- criterion\n\n## Delivery Preference\n1. Feature 1\n`);
    const result = auditGenerate(root);
    expect(result.warnings.some((w) => w.includes("missing acceptance criteria"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// auditBootstrap
// ---------------------------------------------------------------------------

describe("auditBootstrap", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("returns valid=false when backlog is missing", () => {
    const root = makeTmp(); dirs.push(root);
    const result = auditBootstrap(root);
    expect(result.valid).toBe(false);
    expect(result.featureCount).toBe(0);
    expect(result.warnings[0]).toContain("product-backlog.yaml not found");
  });

  it("returns valid=true for a consistent backlog", () => {
    const root = makeTmp(); dirs.push(root);
    writeProductMd(root, `# P\n\n## In Scope\n\n### Feature 1 - X\n- criterion\n\n## Delivery Preference\n1. Feature 1\n`);
    writeBacklogYaml(root, [
      { id: "F-001", title: "Feature 1 - X", acceptanceCriteria: ["criterion"], status: "open" },
    ]);
    writeFileSync(join(root, "docs", "autopilot-state.json"), JSON.stringify({ status: "bootstrapped" }), "utf8");
    const result = auditBootstrap(root);
    expect(result.valid).toBe(true);
    expect(result.featureCount).toBe(1);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns when feature count mismatches product.md", () => {
    const root = makeTmp(); dirs.push(root);
    writeProductMd(root, `# P\n\n## In Scope\n\n### Feature 1 - X\n- c\n\n### Feature 2 - Y\n- c\n\n## Delivery Preference\n1. Feature 1\n`);
    writeBacklogYaml(root, [
      { id: "F-001", title: "Feature 1 - X", acceptanceCriteria: ["c"], status: "open" },
      // Feature 2 missing from backlog
    ]);
    writeFileSync(join(root, "docs", "autopilot-state.json"), "{}", "utf8");
    const result = auditBootstrap(root);
    expect(result.warnings.some((w) => w.includes("mismatch"))).toBe(true);
  });

  it("warns when a feature has empty acceptanceCriteria", () => {
    const root = makeTmp(); dirs.push(root);
    writeProductMd(root, `# P\n\n## In Scope\n\n### Feature 1 - X\n- c\n\n## Delivery Preference\n1. Feature 1\n`);
    writeBacklogYaml(root, [
      { id: "F-001", title: "Feature 1 - X", acceptanceCriteria: [], status: "open" },
    ]);
    writeFileSync(join(root, "docs", "autopilot-state.json"), "{}", "utf8");
    const result = auditBootstrap(root);
    expect(result.warnings.some((w) => w.includes("empty acceptanceCriteria"))).toBe(true);
  });

  it("warns when autopilot-state.json is missing", () => {
    const root = makeTmp(); dirs.push(root);
    writeBacklogYaml(root, [
      { id: "F-001", title: "X", acceptanceCriteria: ["c"], status: "open" },
    ]);
    // no state file written
    const result = auditBootstrap(root);
    expect(result.warnings.some((w) => w.includes("autopilot-state.json not found"))).toBe(true);
  });
});
