import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { callClaudeForReview, auditGenerate } from "./audit.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerateProductResult {
  featureCount: number;
  productMdPath: string;
  warnings: string[];
}

interface FeatureManifest {
  features: string[];
  count: number;
}

// ---------------------------------------------------------------------------
// Step 1 — Extract feature manifest (fast, JSON-only Claude call)
// ---------------------------------------------------------------------------

export async function extractFeatureManifest(
  specContent: string,
  callClaude: (prompt: string) => Promise<string>
): Promise<FeatureManifest> {
  const prompt = `You are analyzing a software specification document.
Your ONLY task: list ALL features, user stories, or functional requirements you find.

RULES:
- List EVERY distinct feature — do not skip any
- Each entry = one short, descriptive feature title
- Group related behaviors into ONE feature if they serve the same user goal; split if they serve DIFFERENT user needs
- Include backend features, frontend features, mobile features, integrations, admin panels, reports
- Output ONLY valid JSON — no explanation, no markdown wrapper:

{"features": ["Feature title 1", "Feature title 2", "Feature title 3"]}

SPECIFICATION:
${specContent}`;

  const raw = await callClaude(prompt);

  // Extract JSON — Claude may wrap it in a markdown code block
  const jsonMatch = raw.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) {
    throw new Error(`Manifest extraction returned no valid JSON. Raw response: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(jsonMatch[0]) as { features?: unknown };
  if (!Array.isArray(parsed.features)) {
    throw new Error("Manifest JSON missing 'features' array");
  }
  const features = (parsed.features as unknown[]).map(String);
  return { features, count: features.length };
}

// ---------------------------------------------------------------------------
// Step 2 — Deterministic completeness check (no Claude)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set(["with", "from", "that", "this", "user", "when", "have", "will", "into", "each", "also"]);

export function checkCompleteness(productMdContent: string, manifest: FeatureManifest): string[] {
  const warnings: string[] = [];
  const lowerMd = productMdContent.toLowerCase();

  const missing = manifest.features.filter((feature) => {
    const keywords = feature
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
    // Feature is "present" if at least one meaningful keyword appears in the markdown
    return keywords.length > 0 && !keywords.some((kw) => lowerMd.includes(kw));
  });

  if (missing.length > 0) {
    const shown = missing.slice(0, 5).join("; ");
    const extra = missing.length > 5 ? ` (and ${missing.length - 5} more)` : "";
    warnings.push(`${missing.length} feature(s) from spec not found in product.md: ${shown}${extra}`);
  }

  const featureCount = (productMdContent.match(/^### Feature \d+/gm) ?? []).length;
  if (manifest.count >= 5 && featureCount < Math.floor(manifest.count * 0.8)) {
    warnings.push(
      `Product.md has ${featureCount} features but spec manifest identified ${manifest.count} — possible incomplete extraction`
    );
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Step 3 — Format warnings as actionable retry instructions
// ---------------------------------------------------------------------------

function formatWarningsForRetry(warnings: string[]): string {
  return warnings
    .map((w) => {
      if (w.includes("Missing '## Vision'"))
        return "→ ADD ## Vision section (2-4 sentences) immediately after the product title";
      if (w.includes("Missing '## Out of Scope'"))
        return "→ ADD ## Out of Scope section listing explicitly excluded capabilities";
      if (w.includes("Missing '## Delivery Preference'"))
        return "→ ADD ## Delivery Preference section listing ALL features in dependency order";
      if (w.includes("heading(s) missing 'Epic: Title'"))
        return "→ FIX feature headings: every ### Feature N must include ' - EpicName: Feature Title' (e.g. ### Feature 2 - Backend: User Authentication)";
      if (w.includes("not listed in Delivery Preference"))
        return `→ FIX Delivery Preference — copy-paste the EXACT ### Feature heading titles: ${w}`;
      if (w.includes("missing acceptance criteria"))
        return "→ FIX features without bullet criteria: add at least 2 '- ' bullet points per feature describing observable outcomes";
      if (w.includes("not found in product.md"))
        return `→ MISSING FEATURES — add these as ### Feature headings: ${w}`;
      if (w.includes("possible incomplete extraction"))
        return `→ EXTRACT MORE features: ${w}`;
      return `→ FIX: ${w}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Step 4 — Guided generation prompt (uses manifest as contractual checklist)
// ---------------------------------------------------------------------------

function buildGeneratePrompt(
  specContent: string,
  manifest: FeatureManifest,
  priorWarnings: string[]
): string {
  const featureChecklist = manifest.features
    .map((f, i) => `  ${i + 1}. ${f}`)
    .join("\n");

  const warningBlock =
    priorWarnings.length > 0
      ? `\n⚠ PREVIOUS ATTEMPT ISSUES — fix ALL of these before outputting:\n${formatWarningsForRetry(priorWarnings)}\n`
      : "";

  return `You are a product analyst converting a specification into a structured product.md file.

MANDATORY FEATURE LIST — extracted from the spec. You MUST include ALL ${manifest.count} features:
${featureChecklist}

REQUIRED OUTPUT FORMAT (follow exactly — no preamble, no closing remarks):

# <Product Title>

## Vision
<2-4 sentences: what the product does, for whom, and the main value it delivers>

## In Scope

### Feature 1 - <EpicName>: <Feature Title>
- <observable criterion: When [action], then [system outcome with specific detail]>
- <observable criterion: POST /endpoint returns X / UI shows Y / state changes to Z>

### Feature 2 - <EpicName>: <Feature Title>
- ...

(one ### Feature heading per feature from the mandatory list — minimum 2 criteria each)

## Out of Scope
- <explicitly excluded capability>

## Delivery Preference
1. Feature 1 - <EpicName>: <Feature Title>
2. Feature 2 - <EpicName>: <Feature Title>
...${manifest.count}. (list ALL ${manifest.count} features — titles MUST COPY EXACTLY from ### headings above)

ACCEPTANCE CRITERION FORMAT — observable outcomes only:
  ✓ "POST /api/tasks returns 201 with the created task JSON on success"
  ✓ "When user clicks [Save] with empty title, error message 'Title is required' appears inline"
  ✓ "After logout, session token is removed from localStorage and /profile redirects to /login"
  ✗ "API works correctly" — too vague, no observable outcome
  ✗ "User can manage tasks" — not a single observable action

RULES:
1. Include EVERY feature from the mandatory list — missing one = broken build
2. Heading format: ### Feature N - EpicName: Feature Title (dash + colon are required)
3. Delivery Preference: copy-paste EXACT text of each ### Feature N heading — no paraphrasing
4. All output in English regardless of spec language
5. Output ONLY the markdown
${warningBlock}
SPECIFICATION:
${specContent}`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Generate docs/product.md from a spec file using Claude CLI.
 *
 * Two-call architecture:
 *  Call 1 — Extract feature manifest (JSON, fast)
 *  Call 2 — Generate product.md guided by manifest (+ up to 2 retries)
 *
 * @param specPath   Absolute path to the source specification file
 * @param root       Target project root (docs/ will be created here)
 * @param callClaude Override for the Claude call — injectable for tests
 */
export async function generateProduct(
  specPath: string,
  root: string,
  callClaude: (prompt: string) => Promise<string> = callClaudeForReview
): Promise<GenerateProductResult> {
  if (!existsSync(specPath)) {
    throw new Error(`Spec file not found: ${specPath}`);
  }

  const specContent = readFileSync(specPath, "utf8");
  const docsDir = join(root, "docs");
  mkdirSync(docsDir, { recursive: true });

  // CALL 1 — Extract feature manifest
  const manifest = await extractFeatureManifest(specContent, callClaude);
  writeFileSync(join(docsDir, "feature-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const productMdPath = join(docsDir, "product.md");
  const MAX_ATTEMPTS = 3;
  let priorWarnings: string[] = [];
  let lastWarnings: string[] = [];
  let featureCount = 0;

  // CALL 2 (+ up to 2 retries) — Guided generation
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = buildGeneratePrompt(specContent, manifest, priorWarnings);
    const output = await callClaude(prompt);
    writeFileSync(productMdPath, output, "utf8");

    const audit = auditGenerate(root);
    featureCount = audit.featureCount;

    // Deterministic completeness check: manifest vs product.md
    const completenessWarnings = checkCompleteness(output, manifest);
    lastWarnings = [...audit.warnings, ...completenessWarnings];

    if (lastWarnings.length === 0) {
      return { featureCount, productMdPath, warnings: [] };
    }
    if (attempt < MAX_ATTEMPTS) {
      priorWarnings = lastWarnings;
    }
  }

  // Exhausted retries
  return { featureCount, productMdPath, warnings: lastWarnings };
}
