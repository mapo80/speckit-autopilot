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

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildGeneratePrompt(specContent: string, priorWarnings?: string[]): string {
  const warningBlock =
    priorWarnings && priorWarnings.length > 0
      ? `\n\nPREVIOUS ATTEMPT WARNINGS — fix these in your output:\n${priorWarnings.map((w) => `- ${w}`).join("\n")}\n`
      : "";

  return `You are a product analyst. Read the following specification document carefully and completely.
Convert it into a structured product.md file that will be used to generate a feature backlog.

The output MUST follow this EXACT format — no deviations, no preamble, no closing remarks:

# <Product Title>

## Vision
<2-4 sentences describing the product, its goals, and intended users>

## In Scope

### Feature 1 - <Epic>: <Feature Title>
- <specific, testable acceptance criterion derived from the spec>
- <specific, testable acceptance criterion derived from the spec>
(5 to 15 criteria per feature)

### Feature 2 - <Epic>: <Feature Title>
- ...

(repeat for ALL features)

## Out of Scope
- <item explicitly excluded or clearly outside scope>

## Delivery Preference
1. <title matching EXACTLY the ### Feature N heading above>
2. ...
(list ALL features in dependency order: infrastructure first, UI last)

RULES:
- Read the ENTIRE document before writing — do not stop early
- Extract ALL significant features — missing one means it will never be built
- Group features by epic/component (e.g. Backend, Frontend Web, Mobile App, Design System)
- Each acceptance criterion must be concrete and testable, referencing specific API endpoints, UI components, data fields, state transitions or business rules from the spec
- Delivery Preference must list ALL features in implementation order
- Titles in Delivery Preference must match EXACTLY the ### Feature N headings
- All output must be in English regardless of the source language
- Output ONLY the markdown — no explanations, no "Here is the file:"
- Minimum 5 features; each feature must have at least one acceptance criterion
- Include a "## Delivery Preference" section listing all features in order
${warningBlock}
SPECIFICATION DOCUMENT:
${specContent}`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Generate docs/product.md from a spec file using Claude CLI.
 * Retries up to 3 times if auditGenerate finds warnings.
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
  const productMdPath = join(root, "docs", "product.md");
  mkdirSync(join(root, "docs"), { recursive: true });

  const MAX_ATTEMPTS = 3;
  let priorWarnings: string[] = [];
  let lastWarnings: string[] = [];
  let featureCount = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = buildGeneratePrompt(specContent, priorWarnings);
    const output = await callClaude(prompt);

    writeFileSync(productMdPath, output, "utf8");

    const audit = auditGenerate(root);
    featureCount = audit.featureCount;
    lastWarnings = audit.warnings;

    if (lastWarnings.length === 0) {
      return { featureCount, productMdPath, warnings: [] };
    }

    if (attempt < MAX_ATTEMPTS) {
      priorWarnings = lastWarnings;
    }
  }

  // Exhausted retries — return with remaining warnings
  return { featureCount, productMdPath, warnings: lastWarnings };
}
