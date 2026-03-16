import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { callClaudeForReview } from "./audit.js";
import type { BrownfieldSnapshot } from "../core/brownfield-snapshot.js";

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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the ## Tech Stack section from product.md content.
 * Returns a well-formed markdown string starting with "# Tech Stack", or null
 * if the section is absent.
 */
export function extractTechStackSection(productMdContent: string): string | null {
  // Find "## Tech Stack" section (case-insensitive), stop at next ## heading
  const match = productMdContent.match(/^##\s+Tech Stack\s*\n([\s\S]*?)(?=^##\s|\Z)/im);
  if (!match) return null;
  const body = match[1].trim();
  if (!body) return null;
  // Normalize sub-heading levels: ### → ## so the output is consistent
  // (product.md uses ### under ## Tech Stack, output uses ## under # Tech Stack)
  const normalized = body.replace(/^###\s/gm, "## ").replace(/^####\s/gm, "### ");
  return `# Tech Stack\n\n${normalized}\n`;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildTechStackPrompt(productMdContent: string): string {
  return `Extract the technology stack from the product specification below and output it as markdown.

Format:

# Tech Stack

## Backend
- Language / Runtime: <exact version if specified>
- Framework: <framework + version if mentioned>
- Architecture: <architecture pattern if mentioned>

## Frontend (omit section if not applicable)
- Framework: <framework + version>
- UI library: <library if specified>
- Build tool: <e.g. Vite, Webpack>
- Source extension: <e.g. .tsx, .vue>

## Mobile (omit section if not applicable)
- Framework: <framework + version>
- Source extension: <e.g. .dart, .swift>

## Database (omit section if not applicable)
- Primary: <database + version if specified>
- ORM / ODM: <e.g. Prisma, EF Core>
- Message queue: <e.g. RabbitMQ, Hangfire>

## Infrastructure (omit section if not applicable)
- Cloud: <provider + services if mentioned>

RULES:
- Copy technology choices exactly as stated — do not invent or substitute
- Omit entire sections when clearly not applicable
- Output ONLY the markdown content, starting with "# Tech Stack"

PRODUCT SPECIFICATION:
${productMdContent}`;
}

// ---------------------------------------------------------------------------
// buildTechStackFromSnapshotPrompt
// ---------------------------------------------------------------------------

function buildTechStackFromSnapshotPrompt(snapshot: BrownfieldSnapshot): string {
  const languages = snapshot.techStack.language.join(", ") || "Not detected";
  const frameworks = snapshot.techStack.frameworks.join(", ") || "Not detected";
  const buildTools = snapshot.techStack.buildTools.join(", ") || "Not detected";
  const runtime = snapshot.techStack.runtime || "Not detected";
  const testFramework = snapshot.testFramework
    ? `${snapshot.testFramework.name} (${snapshot.testFramework.location})`
    : "Not detected";

  return `You are generating docs/tech-stack.md for an existing codebase.

The following tech stack was detected by static analysis of the project:

Languages: ${languages}
Frameworks: ${frameworks}
Build tools: ${buildTools}
Runtime: ${runtime}
Test framework: ${testFramework}
Entry points: ${snapshot.entryPoints.map((e) => e.file).join(", ") || "none detected"}

Output ONLY a valid docs/tech-stack.md — no preamble, no closing remarks.
Expand the detected information into the structured format below.
Only include sections that are applicable based on the detected stack.

# Tech Stack

## Backend
- Language / Runtime: <from detected languages/runtime>
- Framework: <from detected frameworks>
- Architecture: <infer from project structure if possible — or "Not specified">
- Test framework: <from detected test framework>

## Frontend (omit section if not applicable)
- Framework: <from detected frameworks>
- Build tool: <from detected build tools>

## Mobile (omit section if not applicable)
- Framework: <from detected frameworks>

## Database (omit section if not applicable)
- Primary: <if detectable from dependencies>

## Infrastructure (omit section if not applicable)
- Containers: <if Docker/Kubernetes detected>

RULES:
- Use ONLY what was detected — do not invent technologies
- Omit entire sections when clearly not applicable
- Output ONLY the markdown`;
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

  mkdirSync(docsDir, { recursive: true });

  // Fast path: extract the ## Tech Stack section directly from product.md.
  // product.md already contains the tech stack; no Claude call needed.
  const extracted = extractTechStackSection(productMdContent);
  if (extracted) {
    writeFileSync(techStackPath, extracted, "utf8");
    return { techStackPath, created: true, backupPath };
  }

  // Fallback: call Claude when product.md has no ## Tech Stack section.
  const prompt = buildTechStackPrompt(productMdContent);
  const output = await callClaude(prompt);

  // Claude may have written the file via tools during the call.
  // Keep it if it's valid markdown; if corrupt, delete it then try stdout.
  if (existsSync(techStackPath)) {
    const existing = readFileSync(techStackPath, "utf8").trim();
    if (existing.startsWith("#") && existing.length > 50) {
      return { techStackPath, created: true, backupPath };
    }
    // Tool-written file has corrupt content (e.g. commentary) — remove it
    try { unlinkSync(techStackPath); } catch { /* ignore */ }
  }
  const trimmedOutput = output.trim();
  if (trimmedOutput.startsWith("#") && trimmedOutput.length > 50) {
    writeFileSync(techStackPath, output, "utf8");  // write original (preserve trailing newline)
    return { techStackPath, created: true, backupPath };
  }
  // Output is commentary, not markdown — skip writing
  return { techStackPath, created: false, backupPath };
}

// ---------------------------------------------------------------------------
// generateTechStackFromSnapshot
// ---------------------------------------------------------------------------

/**
 * Generate docs/tech-stack.md from an already-built BrownfieldSnapshot.
 * Used during bootstrap when an existing codebase is detected.
 *
 * @param root       Target project root
 * @param callClaude Injectable Claude call
 * @param snapshot   Pre-built brownfield snapshot (from buildBrownfieldSnapshot)
 */
export async function generateTechStackFromSnapshot(
  root: string,
  callClaude: (prompt: string) => Promise<string>,
  snapshot: BrownfieldSnapshot,
): Promise<GenerateTechStackResult> {
  const docsDir = join(root, "docs");
  const techStackPath = join(docsDir, "tech-stack.md");

  if (existsSync(techStackPath)) {
    return { techStackPath, created: false };
  }

  const prompt = buildTechStackFromSnapshotPrompt(snapshot);
  const output = await callClaude(prompt);

  mkdirSync(docsDir, { recursive: true });

  // Same validation as generateTechStack: keep tool-written file if valid,
  // delete if corrupt, then try stdout.
  if (existsSync(techStackPath)) {
    const existing = readFileSync(techStackPath, "utf8").trim();
    if (existing.startsWith("#") && existing.length > 50) {
      return { techStackPath, created: true };
    }
    try { unlinkSync(techStackPath); } catch { /* ignore */ }
  }
  const trimmedOutput = output.trim();
  if (trimmedOutput.startsWith("#") && trimmedOutput.length > 50) {
    writeFileSync(techStackPath, trimmedOutput, "utf8");
    return { techStackPath, created: true };
  }
  return { techStackPath, created: false };
}
