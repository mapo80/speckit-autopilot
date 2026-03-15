import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { callClaudeForReview } from "./audit.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerateTechStackResult {
  techStackPath: string;
  /** true = file was written; false = skipped because it already existed and overwrite:false */
  created: boolean;
  /** Set when overwrite:true and a previous file was backed up */
  backupPath?: string;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildTechStackPrompt(productMdContent: string): string {
  return `You are converting a product specification into docs/tech-stack.md.

The product.md below already contains a ## Tech Stack section with technology choices.
Extract EVERY technology detail and expand it into the structured format below.

Output ONLY a valid docs/tech-stack.md — no preamble, no closing remarks:

# Tech Stack

## Backend
- Language / Runtime: <exact version if specified, e.g. "Node.js 20 (LTS)" — or "Not specified">
- Framework: <framework + version if mentioned — or "Not specified">
- Architecture: <architecture pattern — or "Not specified">
- Test framework: <e.g. Jest, xUnit, pytest — if mentioned>

## Frontend (omit section if not applicable)
- Framework: <framework + version>
- UI library: <library if specified>
- Build tool: <e.g. Vite, Webpack — if mentioned>
- Source extension: <e.g. .tsx, .vue>

## Mobile (omit section if not applicable)
- Framework: <framework + version>
- Source extension: <e.g. .dart, .swift>

## Database (omit section if not applicable)
- Primary: <database + version if specified>
- ORM / ODM: <e.g. Prisma, SQLAlchemy, EF Core — if mentioned>
- Cache: <e.g. Redis — if mentioned>
- Message queue: <e.g. RabbitMQ, Kafka — if mentioned>

## Infrastructure (omit section if not applicable)
- Cloud: <provider + services if mentioned>
- Containers: <Docker / Kubernetes if mentioned>
- CI/CD: <if mentioned>

RULES:
- Copy technology choices exactly as stated in product.md — do not invent or substitute
- If a technology is mentioned but version is unspecified, omit the version
- Omit entire sections (e.g. ## Mobile) when clearly not applicable
- Output ONLY the markdown

PRODUCT SPECIFICATION (product.md):
${productMdContent}`;
}

// ---------------------------------------------------------------------------
// generateTechStack
// ---------------------------------------------------------------------------

/**
 * Generate docs/tech-stack.md from docs/product.md using Claude.
 *
 * @param root       Target project root (docs/tech-stack.md will be written here)
 * @param callClaude Injectable Claude call — defaults to callClaudeForReview
 * @param options    overwrite:false → skip if file already exists (bootstrap mode)
 *                   overwrite:true  → backup existing file then regenerate (skill mode)
 */
export async function generateTechStack(
  root: string,
  callClaude: (prompt: string) => Promise<string> = callClaudeForReview,
  options: { overwrite: boolean } = { overwrite: false }
): Promise<GenerateTechStackResult> {
  const docsDir = join(root, "docs");
  const techStackPath = join(docsDir, "tech-stack.md");
  const productMdPath = join(docsDir, "product.md");

  if (!existsSync(productMdPath)) {
    throw new Error(`docs/product.md not found at ${productMdPath}. Run generate first.`);
  }

  // Skip if file exists and we're not overwriting (bootstrap mode)
  if (!options.overwrite && existsSync(techStackPath)) {
    return { techStackPath, created: false };
  }

  // Backup existing file if overwriting (skill mode)
  let backupPath: string | undefined;
  if (options.overwrite && existsSync(techStackPath)) {
    const ts = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .slice(0, 15); // YYYYMMDD-HHmmss
    backupPath = join(docsDir, `tech-stack.${ts}.bak.md`);
    writeFileSync(backupPath, readFileSync(techStackPath, "utf8"), "utf8");
  }

  const productMdContent = readFileSync(productMdPath, "utf8");
  const prompt = buildTechStackPrompt(productMdContent);
  const output = await callClaude(prompt);

  mkdirSync(docsDir, { recursive: true });
  writeFileSync(techStackPath, output, "utf8");

  return { techStackPath, created: true, backupPath };
}
