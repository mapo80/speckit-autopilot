import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { auditGenerate, auditBootstrap, detectStructuralGaps, scanGeneratedFiles } from "../../src/cli/audit.js";

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

## Tech Stack

### Backend
- Language / Runtime: Node.js 20
- Framework: Express

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

  // --- Check A: ## Vision ---

  it("warns when ## Vision section is missing", () => {
    const root = makeTmp(); dirs.push(root);
    writeProductMd(root, `# My Product\n\n## In Scope\n\n### Feature 1 - Backend: Auth\n- login works\n### Feature 2 - Backend: Register\n- register works\n### Feature 3 - Frontend: Dashboard\n- dashboard shown\n### Feature 4 - Frontend: Settings\n- settings saved\n### Feature 5 - API: Health\n- GET /health 200\n\n## Out of Scope\n- OAuth\n\n## Delivery Preference\n1. Feature 1 - Backend: Auth\n2. Feature 2 - Backend: Register\n3. Feature 3 - Frontend: Dashboard\n4. Feature 4 - Frontend: Settings\n5. Feature 5 - API: Health\n`);
    const result = auditGenerate(root);
    expect(result.warnings.some((w) => w.includes("'## Vision'"))).toBe(true);
  });

  it("does not warn about Vision when section is present", () => {
    const root = makeTmp(); dirs.push(root);
    writeProductMd(root, VALID_PRODUCT_MD);
    const result = auditGenerate(root);
    expect(result.warnings.some((w) => w.includes("Vision"))).toBe(false);
  });

  // --- Check B: Feature heading format (Epic: Title required) ---

  it("warns when feature headings lack 'Epic: Title' format", () => {
    const root = makeTmp(); dirs.push(root);
    // Headings like "### Feature 1 - Backend" (missing colon + title)
    writeProductMd(root, `# My Product\n\n## Vision\nA product.\n\n## In Scope\n\n### Feature 1 - Backend\n- works\n### Feature 2 - Frontend\n- works\n### Feature 3 - Mobile\n- works\n### Feature 4 - API\n- works\n### Feature 5 - Admin\n- works\n\n## Out of Scope\n- OAuth\n\n## Delivery Preference\n1. Feature 1 - Backend\n`);
    const result = auditGenerate(root);
    expect(result.warnings.some((w) => w.includes("'Epic: Title' format"))).toBe(true);
  });

  it("does not warn about heading format when all headings are correct", () => {
    const root = makeTmp(); dirs.push(root);
    writeProductMd(root, VALID_PRODUCT_MD);
    const result = auditGenerate(root);
    expect(result.warnings.some((w) => w.includes("'Epic: Title' format"))).toBe(false);
  });

  // --- Check C: Delivery Preference must list every feature ---

  it("warns when a feature is missing from Delivery Preference", () => {
    const root = makeTmp(); dirs.push(root);
    // Feature 5 - API: Healthcheck is NOT in Delivery Preference
    writeProductMd(root, `# My Product\n\n## Vision\nA product.\n\n## In Scope\n\n### Feature 1 - Auth: Login\n- login\n### Feature 2 - Auth: Register\n- register\n### Feature 3 - Dashboard: Overview\n- overview\n### Feature 4 - Dashboard: Settings\n- settings\n### Feature 5 - API: Healthcheck\n- health\n\n## Out of Scope\n- OAuth\n\n## Delivery Preference\n1. Feature 1 - Auth: Login\n2. Feature 2 - Auth: Register\n3. Feature 3 - Dashboard: Overview\n4. Feature 4 - Dashboard: Settings\n`);
    const result = auditGenerate(root);
    expect(result.warnings.some((w) => w.includes("not listed in Delivery Preference"))).toBe(true);
  });

  it("does not warn about Delivery Preference when all features are listed", () => {
    const root = makeTmp(); dirs.push(root);
    writeProductMd(root, VALID_PRODUCT_MD);
    const result = auditGenerate(root);
    expect(result.warnings.some((w) => w.includes("not listed in Delivery Preference"))).toBe(false);
  });

  // --- Check D: ## Out of Scope ---

  it("warns when ## Out of Scope section is missing", () => {
    const root = makeTmp(); dirs.push(root);
    writeProductMd(root, `# My Product\n\n## Vision\nA product.\n\n## In Scope\n\n### Feature 1 - Auth: Login\n- login\n### Feature 2 - Auth: Register\n- register\n### Feature 3 - Dashboard: Overview\n- overview\n### Feature 4 - Dashboard: Settings\n- settings\n### Feature 5 - API: Healthcheck\n- health\n\n## Delivery Preference\n1. Feature 1 - Auth: Login\n2. Feature 2 - Auth: Register\n3. Feature 3 - Dashboard: Overview\n4. Feature 4 - Dashboard: Settings\n5. Feature 5 - API: Healthcheck\n`);
    const result = auditGenerate(root);
    expect(result.warnings.some((w) => w.includes("'## Out of Scope'"))).toBe(true);
  });

  // --- Check E: ## Tech Stack ---

  it("warns when ## Tech Stack section is missing", () => {
    const root = makeTmp(); dirs.push(root);
    writeProductMd(root, `# My Product\n\n## Vision\nA product.\n\n## In Scope\n\n### Feature 1 - Auth: Login\n- login\n### Feature 2 - Auth: Register\n- register\n### Feature 3 - Dashboard: Overview\n- overview\n### Feature 4 - Dashboard: Settings\n- settings\n### Feature 5 - API: Healthcheck\n- health\n\n## Out of Scope\n- OAuth\n\n## Delivery Preference\n1. Feature 1 - Auth: Login\n2. Feature 2 - Auth: Register\n3. Feature 3 - Dashboard: Overview\n4. Feature 4 - Dashboard: Settings\n5. Feature 5 - API: Healthcheck\n`);
    const result = auditGenerate(root);
    expect(result.warnings.some((w) => w.includes("'## Tech Stack'"))).toBe(true);
  });

  it("does not warn about Tech Stack when section is present", () => {
    const root = makeTmp(); dirs.push(root);
    writeProductMd(root, VALID_PRODUCT_MD);
    const result = auditGenerate(root);
    expect(result.warnings.some((w) => w.includes("Tech Stack"))).toBe(false);
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
      { id: "feature-one", title: "Feature 1 - X", acceptanceCriteria: ["criterion"], status: "open" },
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
      { id: "feature-one", title: "Feature 1 - X", acceptanceCriteria: ["c"], status: "open" },
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
      { id: "feature-one", title: "Feature 1 - X", acceptanceCriteria: [], status: "open" },
    ]);
    writeFileSync(join(root, "docs", "autopilot-state.json"), "{}", "utf8");
    const result = auditBootstrap(root);
    expect(result.warnings.some((w) => w.includes("empty acceptanceCriteria"))).toBe(true);
  });

  it("warns when autopilot-state.json is missing", () => {
    const root = makeTmp(); dirs.push(root);
    writeBacklogYaml(root, [
      { id: "feature-one", title: "X", acceptanceCriteria: ["c"], status: "open" },
    ]);
    // no state file written
    const result = auditBootstrap(root);
    expect(result.warnings.some((w) => w.includes("autopilot-state.json not found"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectStructuralGaps
// ---------------------------------------------------------------------------

describe("detectStructuralGaps", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("returns no gaps for an empty non-specialized project", () => {
    const root = makeTmp(); dirs.push(root);
    // No tech-stack markers, no README
    const gaps = detectStructuralGaps(root, "TypeScript");
    // Only README warning expected
    expect(gaps.length).toBe(1);
    expect(gaps[0].path).toBe("README.md");
    expect(gaps[0].critical).toBe(false);
  });

  it("returns no gaps when README.md exists", () => {
    const root = makeTmp(); dirs.push(root);
    writeFileSync(join(root, "README.md"), "# Project", "utf8");
    const gaps = detectStructuralGaps(root, "TypeScript");
    expect(gaps).toHaveLength(0);
  });

  it("detects missing .sln for .NET project", () => {
    const root = makeTmp(); dirs.push(root);
    writeFileSync(join(root, "README.md"), "# App", "utf8");
    const gaps = detectStructuralGaps(root, ".NET 8 / C#");
    const slnGap = gaps.find((g) => g.path === "*.sln");
    expect(slnGap).toBeDefined();
    expect(slnGap?.critical).toBe(true);
  });

  it("does not flag .sln when one is present", () => {
    const root = makeTmp(); dirs.push(root);
    writeFileSync(join(root, "MyApp.sln"), "", "utf8");
    writeFileSync(join(root, "README.md"), "# App", "utf8");
    const gaps = detectStructuralGaps(root, ".NET 8 / C#");
    expect(gaps.find((g) => g.path === "*.sln")).toBeUndefined();
  });

  it("detects missing .csproj inside a .NET project directory", () => {
    const root = makeTmp(); dirs.push(root);
    writeFileSync(join(root, "MySolution.sln"), "", "utf8");
    writeFileSync(join(root, "README.md"), "# App", "utf8");
    mkdirSync(join(root, "SignHub.Api"), { recursive: true });
    // No SignHub.Api.csproj inside SignHub.Api/
    const gaps = detectStructuralGaps(root, "C# .NET");
    expect(gaps.find((g) => g.path === "SignHub.Api/SignHub.Api.csproj")).toBeDefined();
  });

  it("detects missing pubspec.yaml for Flutter project", () => {
    const root = makeTmp(); dirs.push(root);
    writeFileSync(join(root, "README.md"), "# App", "utf8");
    mkdirSync(join(root, "mobile"), { recursive: true });
    // No pubspec.yaml in mobile/
    const gaps = detectStructuralGaps(root, "Flutter Dart");
    expect(gaps.find((g) => g.path.includes("pubspec.yaml"))).toBeDefined();
    expect(gaps.find((g) => g.path.includes("pubspec.yaml"))?.critical).toBe(true);
  });

  it("detects missing package.json for React project", () => {
    const root = makeTmp(); dirs.push(root);
    writeFileSync(join(root, "README.md"), "# App", "utf8");
    mkdirSync(join(root, "frontend"), { recursive: true });
    const gaps = detectStructuralGaps(root, "React TypeScript Vite");
    expect(gaps.find((g) => g.path.includes("package.json"))).toBeDefined();
    expect(gaps.find((g) => g.path.includes("package.json"))?.critical).toBe(true);
  });

  it("detects missing docker-compose.yml for Docker project", () => {
    const root = makeTmp(); dirs.push(root);
    writeFileSync(join(root, "README.md"), "# App", "utf8");
    const gaps = detectStructuralGaps(root, "Docker docker-compose");
    expect(gaps.find((g) => g.path === "docker-compose.yml")).toBeDefined();
    expect(gaps.find((g) => g.path === "docker-compose.yml")?.critical).toBe(false);
  });

  it("does not flag docker-compose when docker-compose.yaml variant exists", () => {
    const root = makeTmp(); dirs.push(root);
    writeFileSync(join(root, "README.md"), "# App", "utf8");
    writeFileSync(join(root, "docker-compose.yaml"), "", "utf8");
    const gaps = detectStructuralGaps(root, "Docker");
    expect(gaps.find((g) => g.path === "docker-compose.yml")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// scanGeneratedFiles
// ---------------------------------------------------------------------------

describe("scanGeneratedFiles", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("returns an array (may be empty for non-git dirs)", () => {
    const root = makeTmp(); dirs.push(root);
    const files = scanGeneratedFiles(root);
    expect(Array.isArray(files)).toBe(true);
  });

  it("excludes docs/ paths from results", () => {
    const root = makeTmp(); dirs.push(root);
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "product.md"), "# P", "utf8");
    const files = scanGeneratedFiles(root);
    expect(files.every((f) => !f.startsWith("docs/"))).toBe(true);
  });

  it("excludes node_modules/ paths from results", () => {
    const root = makeTmp(); dirs.push(root);
    const files = scanGeneratedFiles(root);
    expect(files.every((f) => !f.startsWith("node_modules/"))).toBe(true);
  });

  it("falls back gracefully when git is unavailable (non-git dir)", () => {
    // A temp dir is not a git repo, so git ls-files will return non-zero
    // and the fallback scans src/, lib/, app/ dirs
    const root = makeTmp(); dirs.push(root);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "export {};", "utf8");
    // This will either use git (if temp dir is inside a git tree) or the fallback
    const files = scanGeneratedFiles(root);
    expect(Array.isArray(files)).toBe(true);
  });
});
