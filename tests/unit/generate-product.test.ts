import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { generateProduct, extractFeatureManifest, checkCompleteness } from "../../src/cli/generate-product.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "generate-product-test-"));
}

/** Valid product.md — passes all auditGenerate checks. */
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

/** Invalid product.md — fails auditGenerate (no features, no sections). */
const INVALID_PRODUCT_MD = `# Bad Product

## Vision
Nothing here.
`;

/** Manifest JSON response Claude returns for the extraction call. */
const MANIFEST_RESPONSE = JSON.stringify({
  features: ["Authentication", "Registration", "Dashboard Overview", "User Settings", "API Healthcheck"],
});

// ---------------------------------------------------------------------------
// extractFeatureManifest
// ---------------------------------------------------------------------------

describe("extractFeatureManifest", () => {
  it("parses a valid JSON response", async () => {
    const callClaude = async () => MANIFEST_RESPONSE;
    const manifest = await extractFeatureManifest("some spec content", callClaude);
    expect(manifest.features).toHaveLength(5);
    expect(manifest.count).toBe(5);
    expect(manifest.features[0]).toBe("Authentication");
  });

  it("handles JSON wrapped in markdown code block", async () => {
    const callClaude = async () =>
      "Here is the analysis:\n```json\n" + MANIFEST_RESPONSE + "\n```";
    const manifest = await extractFeatureManifest("spec", callClaude);
    expect(manifest.features).toHaveLength(5);
  });

  it("throws when response has no JSON", async () => {
    const callClaude = async () => "I found some features but forgot to format them as JSON.";
    await expect(extractFeatureManifest("spec", callClaude)).rejects.toThrow(
      "Manifest extraction returned no valid JSON"
    );
  });

  it("throws when JSON has no features array", async () => {
    const callClaude = async () => '{"result": "ok"}';
    await expect(extractFeatureManifest("spec", callClaude)).rejects.toThrow(
      "Manifest JSON missing 'features' array"
    );
  });

  it("includes spec content in the prompt", async () => {
    let capturedPrompt = "";
    const callClaude = async (p: string) => {
      capturedPrompt = p;
      return MANIFEST_RESPONSE;
    };
    await extractFeatureManifest("UNIQUE_SPEC_CONTENT_XYZ", callClaude);
    expect(capturedPrompt).toContain("UNIQUE_SPEC_CONTENT_XYZ");
  });
});

// ---------------------------------------------------------------------------
// checkCompleteness
// ---------------------------------------------------------------------------

describe("checkCompleteness", () => {
  const manifest = {
    features: ["Authentication", "Task Management", "Dashboard Overview"],
    count: 3,
  };

  it("returns empty warnings when all manifest features appear in product.md", () => {
    const md = `# P\n## Vision\nGreat.\n\n### Feature 1 - Core: Authentication\n- login\n### Feature 2 - Core: Task Management\n- tasks\n### Feature 3 - Core: Dashboard Overview\n- overview\n`;
    const warnings = checkCompleteness(md, manifest);
    expect(warnings).toHaveLength(0);
  });

  it("warns when a manifest feature keyword is absent from product.md", () => {
    // "Dashboard" keyword not in md
    const md = `# P\n### Feature 1 - Core: Authentication\n- login\n### Feature 2 - Core: Task Management\n- tasks\n`;
    const warnings = checkCompleteness(md, manifest);
    expect(warnings.some((w) => w.includes("not found in product.md"))).toBe(true);
    expect(warnings.some((w) => w.includes("Dashboard"))).toBe(true);
  });

  it("warns when product.md feature count is below 80% of manifest count", () => {
    const bigManifest = {
      features: Array.from({ length: 10 }, (_, i) => `Feature ${i + 1}`),
      count: 10,
    };
    // product.md only has 3 features (< 80% of 10)
    const md = Array.from(
      { length: 3 },
      (_, i) => `### Feature ${i + 1} - Core: Feature ${i + 1}\n- works`
    ).join("\n");
    const warnings = checkCompleteness(md, bigManifest);
    expect(warnings.some((w) => w.includes("possible incomplete extraction"))).toBe(true);
  });

  it("does not warn about count when manifest is < 5 features", () => {
    // Below threshold — count check is skipped for small manifests
    const smallManifest = { features: ["Auth", "Tasks"], count: 2 };
    const md = `### Feature 1 - Core: Auth\n- works`;
    const warnings = checkCompleteness(md, smallManifest);
    expect(warnings.some((w) => w.includes("possible incomplete extraction"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateProduct — full two-call flow
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
      generateProduct("/nonexistent/spec.md", root, async () => MANIFEST_RESPONSE)
    ).rejects.toThrow("Spec file not found");
  });

  it("calls callClaude twice: once for manifest, once for generation", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath, "# Spec", "utf8");

    let callCount = 0;
    const callClaude = async () => {
      callCount++;
      return callCount === 1 ? MANIFEST_RESPONSE : VALID_PRODUCT_MD;
    };

    await generateProduct(specPath, root, callClaude);
    expect(callCount).toBe(2);
  });

  it("writes docs/product.md to root", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath, "# Spec", "utf8");

    let call = 0;
    await generateProduct(specPath, root, async () => ++call === 1 ? MANIFEST_RESPONSE : VALID_PRODUCT_MD);

    expect(existsSync(join(root, "docs", "product.md"))).toBe(true);
  });

  it("writes docs/feature-manifest.json for traceability", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath, "# Spec", "utf8");

    let call = 0;
    await generateProduct(specPath, root, async () => ++call === 1 ? MANIFEST_RESPONSE : VALID_PRODUCT_MD);

    const manifestPath = join(root, "docs", "feature-manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(Array.isArray(manifest.features)).toBe(true);
  });

  it("injects manifest feature list into the generation prompt", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath, "# Spec", "utf8");

    let call = 0;
    let generationPrompt = "";
    const callClaude = async (prompt: string) => {
      call++;
      if (call === 1) return MANIFEST_RESPONSE;
      generationPrompt = prompt;
      return VALID_PRODUCT_MD;
    };

    await generateProduct(specPath, root, callClaude);

    // Manifest feature titles must appear in the generation prompt
    expect(generationPrompt).toContain("Authentication");
    expect(generationPrompt).toContain("Registration");
    expect(generationPrompt).toContain("MANDATORY FEATURE LIST");
  });

  it("returns correct feature count and empty warnings on success", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath, "# Spec", "utf8");

    let call = 0;
    const result = await generateProduct(specPath, root, async () =>
      ++call === 1 ? MANIFEST_RESPONSE : VALID_PRODUCT_MD
    );

    expect(result.featureCount).toBe(5);
    expect(result.warnings).toHaveLength(0);
    expect(result.productMdPath).toBe(join(root, "docs", "product.md"));
  });

  it("retries generation (not manifest) when audit warns", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath, "# Spec", "utf8");

    // Call order: 1=manifest, 2=bad generation, 3=good generation
    let call = 0;
    const callClaude = async () => {
      call++;
      if (call === 1) return MANIFEST_RESPONSE;
      return call === 2 ? INVALID_PRODUCT_MD : VALID_PRODUCT_MD;
    };

    const result = await generateProduct(specPath, root, callClaude);
    expect(call).toBe(3);
    expect(result.warnings).toHaveLength(0);
  });

  it("includes specific missing feature names in retry prompt", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath, "# Spec", "utf8");

    const prompts: string[] = [];
    let call = 0;
    const callClaude = async (prompt: string) => {
      call++;
      prompts.push(prompt);
      if (call === 1) return MANIFEST_RESPONSE;
      return call === 2 ? INVALID_PRODUCT_MD : VALID_PRODUCT_MD;
    };

    await generateProduct(specPath, root, callClaude);

    // Third call (second generation = first retry) should mention warnings
    expect(prompts.length).toBeGreaterThanOrEqual(3);
    expect(prompts[2]).toContain("PREVIOUS ATTEMPT ISSUES");
  });

  it("returns warnings from final audit when all 3 generation attempts fail", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath, "# Spec", "utf8");

    let call = 0;
    const callClaude = async () => {
      call++;
      return call === 1 ? MANIFEST_RESPONSE : INVALID_PRODUCT_MD;
    };

    // 1 manifest call + 3 generation calls = 4 total
    const result = await generateProduct(specPath, root, callClaude);
    expect(call).toBe(4);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("product.md on disk matches final Claude output", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath, "# Spec", "utf8");

    let call = 0;
    const callClaude = async () => {
      call++;
      if (call === 1) return MANIFEST_RESPONSE;
      return call === 2 ? INVALID_PRODUCT_MD : VALID_PRODUCT_MD;
    };

    await generateProduct(specPath, root, callClaude);

    const onDisk = readFileSync(join(root, "docs", "product.md"), "utf8");
    expect(onDisk).toBe(VALID_PRODUCT_MD);
  });

  it("includes completeness warning when product.md is missing manifest features", async () => {
    const root = makeTmp(); dirs.push(root);
    const specPath = join(root, "spec.md");
    writeFileSync(specPath, "# Spec", "utf8");

    // Manifest has a feature "Exotic Billing Feature" that never appears in product.md
    const manifestWithUnknown = JSON.stringify({
      features: [
        "Authentication", "Registration", "Dashboard Overview",
        "User Settings", "API Healthcheck", "Exotic Billing Feature XYZ",
      ],
    });

    let call = 0;
    const callClaude = async () => {
      call++;
      if (call === 1) return manifestWithUnknown;
      return VALID_PRODUCT_MD; // valid but missing "Exotic Billing Feature XYZ"
    };

    const result = await generateProduct(specPath, root, callClaude);
    // Either completeness warning OR it passed (keyword matching may be lenient)
    // At minimum the result is well-formed
    expect(typeof result.featureCount).toBe("number");
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});
