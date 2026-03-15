import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { auditFeature } from "../../src/cli/audit.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "audit-feature-test-"));
}

function writeSpecDir(
  root: string,
  featureId: string,
  files: { spec?: string; tasks?: string; implReport?: object }
): string {
  const dir = join(root, "docs", "specs", featureId.toLowerCase());
  mkdirSync(dir, { recursive: true });
  if (files.spec !== undefined) writeFileSync(join(dir, "spec.md"), files.spec, "utf8");
  if (files.tasks !== undefined) writeFileSync(join(dir, "tasks.md"), files.tasks, "utf8");
  if (files.implReport !== undefined) {
    writeFileSync(join(dir, "implementation-report.json"), JSON.stringify(files.implReport), "utf8");
  }
  return dir;
}

const MOCK_REVIEW = `### ✓ Complete\n- Login endpoint implemented\n\n### ⚠ Gaps\n- Tests missing\n\n### 🔧 Recommendations\n- Add integration tests\n\n### Score: 3/5`;

function mockClaude(response = MOCK_REVIEW): (prompt: string) => Promise<string> {
  return async (_prompt) => response;
}

// ---------------------------------------------------------------------------
// auditFeature
// ---------------------------------------------------------------------------

describe("auditFeature", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  function withTechStack(root: string): void {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "tech-stack.md"), "# Tech Stack\n\n## Backend\n- Language / Runtime: TypeScript\n", "utf8");
  }

  it("writes audit.md when spec.md and tasks.md are present", async () => {
    const root = makeTmp(); dirs.push(root);
    withTechStack(root);
    writeSpecDir(root, "F-001", {
      spec: "## Spec\n- User can log in with email/password\n- JWT returned on success",
      tasks: "- [ ] Implement POST /auth/login\n- [ ] Return JWT",
    });

    const result = await auditFeature(root, "F-001", "Auth Login", mockClaude());

    expect(result.featureId).toBe("F-001");
    expect(result.featureTitle).toBe("Auth Login");
    expect(result.skipped).toBe(false);
    expect(result.error).toBeUndefined();
    expect(existsSync(result.auditPath)).toBe(true);

    const content = readFileSync(result.auditPath, "utf8");
    expect(content).toContain("# Audit – F-001 – Auth Login");
    expect(content).toContain(MOCK_REVIEW);
    expect(content).toContain("Files reviewed: 0");
  });

  it("audit.md path is docs/specs/{featureId}/audit.md", async () => {
    const root = makeTmp(); dirs.push(root);
    withTechStack(root);
    writeSpecDir(root, "F-002", { spec: "- some criterion" });

    const result = await auditFeature(root, "F-002", "Feature Two", mockClaude());

    const expectedPath = join(root, "docs", "specs", "f-002", "audit.md");
    expect(result.auditPath).toBe(expectedPath);
  });

  it("skips and writes note when both spec.md and tasks.md are missing", async () => {
    const root = makeTmp(); dirs.push(root);
    withTechStack(root);
    mkdirSync(join(root, "docs", "specs", "f-003"), { recursive: true }); // empty dir

    const callClaude = mockClaude();
    let called = false;
    const trackingClaude = async (p: string) => { called = true; return callClaude(p); };

    const result = await auditFeature(root, "F-003", "Missing Feature", trackingClaude);

    expect(result.skipped).toBe(true);
    expect(called).toBe(false); // Claude not called
    const content = readFileSync(result.auditPath, "utf8");
    expect(content).toContain("Skipped: no spec.md or tasks.md found");
  });

  it("uses tasks.md as fallback when spec.md is missing", async () => {
    const root = makeTmp(); dirs.push(root);
    withTechStack(root);
    writeSpecDir(root, "F-004", {
      tasks: "- [ ] Do something",
    });

    let capturedPrompt = "";
    const capturingClaude = async (prompt: string) => { capturedPrompt = prompt; return MOCK_REVIEW; };

    const result = await auditFeature(root, "F-004", "Fallback Feature", capturingClaude);

    expect(result.skipped).toBe(false);
    expect(capturedPrompt).toContain("_spec.md not found — using tasks as fallback_");
    expect(capturedPrompt).toContain("Do something");
  });

  it("includes file list from implementation-report.json in prompt", async () => {
    const root = makeTmp(); dirs.push(root);
    withTechStack(root);
    writeSpecDir(root, "F-005", {
      spec: "- some criterion",
      implReport: {
        featureId: "F-005",
        completedAt: "2024-01-01",
        changedFiles: ["src/auth/login.ts", "src/auth/jwt.ts"],
        newFileCount: 2,
        qaChecks: [],
        coverage: null,
      },
    });

    let capturedPrompt = "";
    const capturingClaude = async (prompt: string) => { capturedPrompt = prompt; return MOCK_REVIEW; };

    const result = await auditFeature(root, "F-005", "With Report", capturingClaude);

    expect(result.skipped).toBe(false);
    expect(capturedPrompt).toContain("src/auth/login.ts");
    expect(capturedPrompt).toContain("src/auth/jwt.ts");
    expect(capturedPrompt).toContain("Files generated (2):");

    const content = readFileSync(result.auditPath, "utf8");
    expect(content).toContain("Files reviewed: 2");
  });

  it("writes error note to audit.md when callClaude throws", async () => {
    const root = makeTmp(); dirs.push(root);
    withTechStack(root);
    writeSpecDir(root, "F-006", { spec: "- some criterion" });

    const failingClaude = async (_p: string): Promise<string> => {
      throw new Error("API rate limit exceeded");
    };

    const result = await auditFeature(root, "F-006", "Error Feature", failingClaude);

    expect(result.error).toContain("API rate limit exceeded");
    expect(result.skipped).toBe(false);
    expect(existsSync(result.auditPath)).toBe(true);

    const content = readFileSync(result.auditPath, "utf8");
    expect(content).toContain("⚠ Audit failed: API rate limit exceeded");
  });

  it("includes generated timestamp in audit.md header", async () => {
    const root = makeTmp(); dirs.push(root);
    withTechStack(root);
    writeSpecDir(root, "F-007", { spec: "- criterion", tasks: "- [ ] task" });

    const before = Date.now();
    const result = await auditFeature(root, "F-007", "Timestamp Feature", mockClaude());
    const after = Date.now();

    const content = readFileSync(result.auditPath, "utf8");
    const match = content.match(/Generated: (.+)/);
    expect(match).not.toBeNull();
    const ts = new Date(match![1]).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
