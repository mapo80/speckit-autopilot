import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { makeEmptyBacklog, Backlog, Feature, featureSlug } from "../core/backlog-schema.js";
import { StateStore } from "../core/state-store.js";
import { generateRoadmap, renderRoadmapMarkdown } from "../core/roadmap-generator.js";
import { spawnSync } from "child_process";
import { auditBootstrap, callClaudeForReview } from "./audit.js";
import { generateTechStack, generateTechStackFromSnapshot } from "./generate-techstack.js";
import { isBrownfieldRepo, buildBrownfieldSnapshot, writeBrownfieldSnapshot } from "../core/brownfield-snapshot.js";

// ---------------------------------------------------------------------------
// Spec Kit detection
// ---------------------------------------------------------------------------

export function detectSpecKit(root: string): { available: boolean; initialized: boolean } {
  // `specify` uses `specify version` subcommand (not --version flag)
  const versionResult = spawnSync("specify", ["version"], { encoding: "utf8", shell: true });
  const available = versionResult.status === 0;
  // spec-kit creates `.specify/` directory (not `.speckit/`)
  const initialized =
    existsSync(join(root, ".specify")) || existsSync(join(root, ".speckit"));
  return { available, initialized };
}

// ---------------------------------------------------------------------------
// Spec Kit initialization
// ---------------------------------------------------------------------------

export function initSpecKit(root: string): { ok: boolean; error?: string } {
  const result = spawnSync(
    "specify",
    ["init", "--here", "--force", "--ai", "claude", "--ignore-agent-tools", "--no-git"],
    { cwd: root, encoding: "utf8", shell: true, timeout: 60_000 }
  );
  if (result.status !== 0) {
    // specify init failed — try bundled template as offline fallback
    copyBundledTemplate(root);
    if (existsSync(join(root, ".specify")) || existsSync(join(root, ".claude"))) {
      return { ok: true };
    }
    return {
      ok: false,
      error: `specify init failed (exit ${result.status}): ${(result.stderr ?? result.stdout ?? "unknown error").slice(0, 300)}`,
    };
  }
  // `specify init` may exit 0 even when the download fails (e.g., network errors).
  // Verify success by checking that key directories were actually created.
  if (!existsSync(join(root, ".specify")) && !existsSync(join(root, ".claude"))) {
    // Try bundled template before giving up
    copyBundledTemplate(root);
    if (existsSync(join(root, ".specify")) || existsSync(join(root, ".claude"))) {
      return { ok: true };
    }
    const output = (result.stdout ?? result.stderr ?? "").slice(0, 300);
    return {
      ok: false,
      error: `specify init exited 0 but .specify/ and .claude/ were not created. Output: ${output}`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Bundled template copy (offline / rate-limit fallback)
// ---------------------------------------------------------------------------

export function copyBundledTemplate(root: string): void {
  // Resolve plugin root: go up 3 levels from the compiled file
  // (dist/cli/bootstrap-product.js → dist/cli → dist → project root)
  const pluginRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const templateSrc = join(pluginRoot, "templates", "spec-kit-claude");
  if (!existsSync(templateSrc)) return; // template not bundled — skip silently
  for (const sub of [".claude", ".specify"]) {
    const src = join(templateSrc, sub);
    const dest = join(root, sub);
    if (existsSync(src) && !existsSync(dest)) {
      try {
        cpSync(src, dest, { recursive: true });
      } catch {
        // dest dir is invalid (e.g. /dev/null) — skip silently
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Manual .speckit/ scaffold (fallback when specify CLI unavailable)
// ---------------------------------------------------------------------------

export function scaffoldSpeckitDirs(root: string): void {
  // First try to copy the full bundled template (includes real Spec Kit commands)
  copyBundledTemplate(root);
  // Ensure minimal dirs exist even if the bundle is absent
  for (const dir of [
    join(root, ".speckit"),
    join(root, "docs", "specs"),
  ]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Product.md parser
// ---------------------------------------------------------------------------

export interface ParsedProduct {
  title: string;
  epics: ParsedEpic[];
  outOfScope: string[];
  acceptanceCriteria: string[];
  deliveryOrder: string[];
}

export interface ParsedEpic {
  name: string;
  features: ParsedFeatureRaw[];
}

export interface ParsedFeatureRaw {
  title: string;
  description: string;
  criteria: string[];
}

export function parseProductMd(content: string): ParsedProduct {
  const lines = content.split("\n");
  const title = lines.find((l) => l.startsWith("# "))?.replace(/^#\s+/, "").trim() ?? "Product";

  const epics: ParsedEpic[] = [];
  const outOfScope: string[] = [];
  const acceptanceCriteria: string[] = [];
  const deliveryOrder: string[] = [];

  let currentSection = "";
  let currentEpic: ParsedEpic | null = null;
  let currentFeature: ParsedFeatureRaw | null = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      currentSection = line.replace(/^##\s+/, "").trim().toLowerCase();
      currentEpic = null;
      currentFeature = null;
      continue;
    }

    if (line.startsWith("### ")) {
      const heading = line.replace(/^###\s+/, "").trim();
      if (currentSection.includes("scope") && !currentSection.includes("out")) {
        currentFeature = { title: heading, description: "", criteria: [] };
        if (!currentEpic) {
          currentEpic = { name: currentSection, features: [] };
          epics.push(currentEpic);
        }
        currentEpic.features.push(currentFeature);
      }
      continue;
    }

    // Bullet points
    if (line.match(/^[-*]\s+/)) {
      const text = line.replace(/^[-*]\s+/, "").trim();
      if (currentSection.includes("out of scope") || currentSection.includes("out-of-scope")) {
        outOfScope.push(text);
      } else if (currentSection.includes("acceptance")) {
        acceptanceCriteria.push(text);
      } else if (currentSection.includes("delivery") || currentSection.includes("order")) {
        deliveryOrder.push(text);
      } else if (currentFeature) {
        currentFeature.criteria.push(text);
      }
      continue;
    }

    // Numbered delivery order
    if (line.match(/^\d+\.\s+/)) {
      const text = line.replace(/^\d+\.\s+/, "").trim();
      if (currentSection.includes("delivery") || currentSection.includes("order") || currentSection.includes("preference")) {
        deliveryOrder.push(text);
      }
    }
  }

  // If no structured epics found, create one default epic with all inline features
  if (epics.length === 0 && lines.some((l) => l.startsWith("### Feature"))) {
    const epic: ParsedEpic = { name: "Core", features: [] };
    epics.push(epic);
    let feat: ParsedFeatureRaw | null = null;
    for (const line of lines) {
      if (line.startsWith("### Feature")) {
        feat = { title: line.replace(/^###\s+/, "").trim(), description: "", criteria: [] };
        epic.features.push(feat);
      } else if (feat && line.match(/^[-*]\s+/)) {
        feat.criteria.push(line.replace(/^[-*]\s+/, "").trim());
      }
    }
  }

  return { title, epics, outOfScope, acceptanceCriteria, deliveryOrder };
}

// ---------------------------------------------------------------------------
// Backlog builder from parsed product
// ---------------------------------------------------------------------------

export function buildBacklogFromProduct(parsed: ParsedProduct): Backlog {
  const backlog = makeEmptyBacklog();
  backlog.generatedAt = new Date().toISOString();

  const priorityMap: Record<number, "high" | "medium" | "low"> = {};
  parsed.deliveryOrder.forEach((title, idx) => {
    const key = idx;
    priorityMap[key] = idx === 0 ? "high" : idx < 3 ? "medium" : "low";
    void title;
  });

  // Pass 1: create features and record each feature's delivery order index
  const allFeatures: Feature[] = [];
  const deliveryIdxById: Map<string, number> = new Map();

  for (const epic of parsed.epics) {
    for (const rawFeat of epic.features) {
      const id = featureSlug(rawFeat.title, allFeatures.map((f) => f.id));
      const deliveryIdx = parsed.deliveryOrder.findIndex((t) =>
        rawFeat.title.toLowerCase().includes(t.toLowerCase()) ||
        t.toLowerCase().includes(rawFeat.title.toLowerCase().split(" ").slice(-1)[0])
      );
      const priority = deliveryIdx === 0 ? "high" : deliveryIdx > 0 && deliveryIdx < 3 ? "medium" : "low";
      deliveryIdxById.set(id, deliveryIdx);

      const feature: Feature = {
        id,
        title: rawFeat.title,
        epic: epic.name,
        status: "open",
        priority,
        dependsOn: [], // filled in pass 2
        acceptanceCriteria: rawFeat.criteria.length > 0 ? rawFeat.criteria : [`${rawFeat.title} works as described`],
        estimatedComplexity: "medium",
        specKitBranch: "",
        notes: rawFeat.description,
      };

      allFeatures.push(feature);
    }
  }

  // Pass 2: build delivery-order map and assign dependencies
  // deliveryPosToId[d] = id of the feature at delivery position d
  const deliveryPosToId: Map<number, string> = new Map();
  for (const f of allFeatures) {
    const d = deliveryIdxById.get(f.id) ?? -1;
    if (d >= 0) deliveryPosToId.set(d, f.id);
  }

  for (const f of allFeatures) {
    const d = deliveryIdxById.get(f.id) ?? -1;
    if (d > 0) {
      const predecessorId = deliveryPosToId.get(d - 1);
      if (predecessorId) f.dependsOn = [predecessorId];
    }
  }

  backlog.features = allFeatures;
  return backlog;
}

// ---------------------------------------------------------------------------
// Project structure generation
// ---------------------------------------------------------------------------

export function buildProjectStructurePrompt(productContent: string, techStackContent: string): string {
  const productSummary = productContent.split("\n").slice(0, 50).join("\n");
  return `You are generating docs/project-structure.md for a new software project.

Given the tech stack and product summary below, define the EXACT canonical folder structure.

REQUIREMENTS:
- One single structure — no alternatives, no "or" choices
- Include a "## RULES (MANDATORY)" section at the end that forbids creating duplicate layers
  (e.g. NEVER create src/Api/ if the canonical path is src/SignHub.Api/)
- List files that must exist EXACTLY ONCE (e.g. DbContext, Program.cs, app.module.ts)
- Be specific about naming conventions (PascalCase controllers, kebab-case components, etc.)
- Paths must be relative from project root

Output ONLY the markdown for docs/project-structure.md — no preamble, no closing remarks.

TECH STACK:
${techStackContent}

PRODUCT SUMMARY (first 50 lines of product.md):
${productSummary}`;
}

export async function generateProjectStructure(
  root: string,
  callClaude: (prompt: string) => Promise<string>
): Promise<{ created: boolean }> {
  const projectStructurePath = join(root, "docs", "project-structure.md");
  if (existsSync(projectStructurePath)) return { created: false };

  const productMdPath = join(root, "docs", "product.md");
  const techStackPath = join(root, "docs", "tech-stack.md");

  if (!existsSync(productMdPath) || !existsSync(techStackPath)) {
    return { created: false };
  }

  const productContent = readFileSync(productMdPath, "utf8");
  const techStackContent = readFileSync(techStackPath, "utf8");
  const prompt = buildProjectStructurePrompt(productContent, techStackContent);
  const output = await callClaude(prompt);

  // Claude may have written the file via its tools during the call.
  // If the file now exists with valid markdown content, keep it — don't overwrite
  // with the text summary Claude prints to stdout.
  // Claude may have written the file via its tools during the call.
  // If the file now exists with valid markdown content, keep it — don't overwrite
  // with the text summary Claude prints to stdout.
  const writtenByTool = existsSync(projectStructurePath);
  if (writtenByTool) {
    const existing = readFileSync(projectStructurePath, "utf8").trim();
    const looksLikeMarkdown = existing.startsWith("#") && existing.length > 50;
    if (looksLikeMarkdown) return { created: true };
    // File exists but looks corrupt — fall through and overwrite with output
  }

  // Validate output before writing: must start with # and be substantial markdown
  const trimmedOutput = output.trim();
  if (trimmedOutput.startsWith("#") && trimmedOutput.length > 50) {
    writeFileSync(projectStructurePath, trimmedOutput, "utf8");
    return { created: true };
  }

  // Output looks like a Claude commentary rather than markdown — skip writing
  // The caller will need to handle the missing file (e.g., bootstrap continues without it)
  return { created: false };
}

// ---------------------------------------------------------------------------
// Main bootstrap function
// ---------------------------------------------------------------------------

export interface BootstrapResult {
  success: boolean;
  productTitle: string;
  featureCount: number;
  roadmapPath: string;
  backlogPath: string;
  statePath: string;
  specKitAvailable: boolean;
  specKitInitialized: boolean;
  message: string;
}

export async function bootstrapProduct(
  root: string,
  callClaude: (prompt: string) => Promise<string> = callClaudeForReview
): Promise<BootstrapResult> {
  const productMdPath = join(root, "docs", "product.md");

  if (!existsSync(productMdPath)) {
    return {
      success: false,
      productTitle: "",
      featureCount: 0,
      roadmapPath: "",
      backlogPath: "",
      statePath: "",
      specKitAvailable: false,
      specKitInitialized: false,
      message: `docs/product.md not found at ${productMdPath}. Please create it first.`,
    };
  }

  const content = readFileSync(productMdPath, "utf8");
  const parsed = parseProductMd(content);
  const backlog = buildBacklogFromProduct(parsed);

  // Generate roadmap
  const roadmap = generateRoadmap(backlog);
  const roadmapMd = renderRoadmapMarkdown(roadmap);
  const roadmapPath = join(root, "docs", "roadmap.md");
  writeFileSync(roadmapPath, roadmapMd, "utf8");

  // Write backlog YAML
  const backlogPath = join(root, "docs", "product-backlog.yaml");
  writeFileSync(backlogPath, yaml.dump(backlog), "utf8");

  // Detect codebase and choose tech-stack source
  const techStackPath = join(root, "docs", "tech-stack.md");
  const snapshotPath = join(root, "docs", "brownfield-snapshot.md");
  const brownfield = isBrownfieldRepo(root);

  if (brownfield && !existsSync(snapshotPath)) {
    const snapshot = buildBrownfieldSnapshot(root, "");
    writeBrownfieldSnapshot(root, snapshot);
    if (!existsSync(techStackPath)) {
      await generateTechStackFromSnapshot(root, callClaude, snapshot);
    }
  } else {
    // Greenfield or snapshot already present: generate from product.md if absent
    await generateTechStack(root, callClaude, { overwrite: false });
  }

  // Generate canonical project structure
  await generateProjectStructure(root, callClaude);

  // Create initial state
  const store = new StateStore(root);
  store.createInitial(brownfield ? "brownfield" : "greenfield");

  // Detect Spec Kit availability
  const { available: specKitAvailable } = detectSpecKit(root);

  // If specify CLI is available, initialize Spec Kit in the project root.
  // If initialization fails, fall back to manual .speckit/ scaffold.
  let specKitInitialized = false;
  if (specKitAvailable) {
    const initResult = initSpecKit(root);
    if (initResult.ok) {
      specKitInitialized = true;
    } else {
      // Fallback: create minimal directories so the runner can still operate
      scaffoldSpeckitDirs(root);
    }
  } else {
    // No CLI: scaffold minimal directories so SDK path can write specs
    scaffoldSpeckitDirs(root);
  }

  const statePath = join(root, "docs", "autopilot-state.json");

  // Informational audit — validates backlog consistency, never throws
  try { auditBootstrap(root); } catch { /* best-effort */ }

  const notes: string[] = [];
  if (!specKitAvailable) {
    notes.push("NOTE: specify CLI not found – using SDK-only mode.");
  } else if (!specKitInitialized) {
    notes.push("NOTE: specify init failed – using minimal scaffold.");
  }

  return {
    success: true,
    productTitle: parsed.title,
    featureCount: backlog.features.length,
    roadmapPath,
    backlogPath,
    statePath,
    specKitAvailable,
    specKitInitialized,
    message: `Bootstrap complete. ${backlog.features.length} feature(s) extracted.${notes.length ? " " + notes.join(" ") : ""}`,
  };
}
