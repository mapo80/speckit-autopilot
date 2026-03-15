import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { generateProduct } from "../../src/cli/generate-product.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "generate-product-test-"));
}

/** A valid product.md with 5 features, criteria, and Delivery Preference. */
const VALID_PRODUCT_MD = `# My Product

## Vision
A great product for users.

## In Scope

### Feature 1 - Core: Authentication
- User can log in with email and password
- JWT token is returned on success

### Feature 2 - Core: Registration
- User can create an account
- Validation errors are shown for invalid input

### Feature 3 - Dashboard: Overview
- User sees activity summary
- Stats are refreshed every 30s

### Feature 4 - Dashboard: Settings
- User can update display preferences
- Changes are persisted immediately

### Feature 5 - API: Healthcheck
- GET /health returns 200 OK with uptime

## Out of Scope
- OAuth

## Delivery Preference
1. Feature 1 - Core: Authentication
2. Feature 2 - Core: Registration
3. Feature 3 - Dashboard: Overview
4. Feature 4 - Dashboard: Settings
5. Feature 5 - API: Healthcheck
`;

/** A product.md that will fail auditGenerate (no features, no Delivery Preference). */
const INVALID_PRODUCT_MD = `# Bad Product

## Vision
Nothing here.
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateProduct", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("throws when spec file does not exist", async () => {
    const root = makeTmp(); dirs.push(root);
    await expect(
      generateProduct("/nonexistent/spec.md", root, async () => VALID_PRODUCT_MD)
    ).rejects.toThrow("Spec file not found");
  });

  it("writes docs/product.md to root", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath,"# Spec\nSome content.", "utf8");

    await generateProduct(specPath, root, async () => VALID_PRODUCT_MD);

    expect(existsSync(join(root, "docs", "product.md"))).toBe(true);
  });

  it("calls callClaude with prompt containing spec content", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath,"# My Special Spec\n- some requirement", "utf8");

    let capturedPrompt = "";
    const callClaude = async (prompt: string) => {
      capturedPrompt = prompt;
      return VALID_PRODUCT_MD;
    };

    await generateProduct(specPath, root, callClaude);

    expect(capturedPrompt).toContain("My Special Spec");
    expect(capturedPrompt).toContain("some requirement");
  });

  it("returns correct feature count from generated product.md", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath,"# Spec", "utf8");

    const result = await generateProduct(specPath, root, async () => VALID_PRODUCT_MD);

    expect(result.featureCount).toBe(5);
    expect(result.productMdPath).toBe(join(root, "docs", "product.md"));
  });

  it("returns empty warnings when product.md is valid on first attempt", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath,"# Spec", "utf8");

    const result = await generateProduct(specPath, root, async () => VALID_PRODUCT_MD);

    expect(result.warnings).toHaveLength(0);
  });

  it("retries when audit produces warnings (callClaude called multiple times)", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath,"# Spec", "utf8");

    let callCount = 0;
    const callClaude = async () => {
      callCount++;
      // First two calls return invalid content; third returns valid
      return callCount < 3 ? INVALID_PRODUCT_MD : VALID_PRODUCT_MD;
    };

    const result = await generateProduct(specPath, root, callClaude);

    expect(callCount).toBe(3);
    expect(result.warnings).toHaveLength(0);
    expect(result.featureCount).toBe(5);
  });

  it("includes prior warnings in retry prompt", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath,"# Spec", "utf8");

    const prompts: string[] = [];
    let callCount = 0;
    const callClaude = async (prompt: string) => {
      prompts.push(prompt);
      callCount++;
      return callCount < 2 ? INVALID_PRODUCT_MD : VALID_PRODUCT_MD;
    };

    await generateProduct(specPath, root, callClaude);

    // Second prompt should include warnings from first audit
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    expect(prompts[1]).toContain("PREVIOUS ATTEMPT WARNINGS");
  });

  it("returns warnings from final audit when all 3 attempts produce invalid output", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath,"# Spec", "utf8");

    let callCount = 0;
    const callClaude = async () => {
      callCount++;
      return INVALID_PRODUCT_MD;
    };

    const result = await generateProduct(specPath, root, callClaude);

    expect(callCount).toBe(3);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("product.md written to disk matches Claude output on last attempt", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath,"# Spec", "utf8");

    let callCount = 0;
    const callClaude = async () => {
      callCount++;
      return callCount === 1 ? INVALID_PRODUCT_MD : VALID_PRODUCT_MD;
    };

    await generateProduct(specPath, root, callClaude);

    const onDisk = readFileSync(join(root, "docs", "product.md"), "utf8");
    expect(onDisk).toBe(VALID_PRODUCT_MD);
  });
});
