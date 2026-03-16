import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { spawnSync, spawn } from "child_process";
import type { Phase } from "./state-store.js";
import { copyBundledTemplate } from "../cli/bootstrap-product.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpecKitRunnerOptions {
  root: string;
  featureId: string;
  featureTitle: string;
  acceptanceCriteria?: string[];
  startFromPhase?: Phase;
  dryRun?: boolean;
  /** Override Anthropic API key (defaults to ANTHROPIC_API_KEY env var) */
  apiKey?: string;
}

export interface PhaseRunResult {
  success: boolean;
  phase: Phase;
  error?: string;
  artifactsWritten?: string[];
}

// ---------------------------------------------------------------------------
// Spec Kit initialization
// ---------------------------------------------------------------------------

/**
 * Ensure .specify/ and .claude/commands/ directories are initialized in root.
 * Runs `specify init --here --force --ai claude --ignore-agent-tools --no-git`.
 * Returns true if already initialized or initialization succeeded.
 */
export function ensureSpecKitInitialized(root: string): { ok: boolean; error?: string } {
  const specifyDir = join(root, ".specify");
  const claudeCommandsDir = join(root, ".claude", "commands");

  if (existsSync(specifyDir) && existsSync(claudeCommandsDir)) {
    return { ok: true };
  }

  const result = spawnSync(
    "specify",
    ["init", "--here", "--force", "--ai", "claude", "--ignore-agent-tools", "--no-git"],
    { cwd: root, encoding: "utf8", shell: true, timeout: 60_000 }
  );

  if (result.status !== 0) {
    // specify init failed — try bundled template as offline fallback
    copyBundledTemplate(root);
    if (existsSync(join(root, ".specify")) || existsSync(join(root, ".claude", "commands"))) {
      return { ok: true };
    }
    return {
      ok: false,
      error: `specify init failed (exit ${result.status}): ${(result.stderr ?? result.stdout ?? "unknown").slice(0, 300)}`,
    };
  }

  return { ok: true };
}

/**
 * Read a spec-kit command file from .claude/commands/.
 * Returns null if the file doesn't exist.
 */
export function readCommandFile(root: string, commandName: string): string | null {
  const p = join(root, ".claude", "commands", `${commandName}.md`);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

/**
 * Read a spec-kit template file from .specify/templates/.
 * Returns null if the file doesn't exist.
 */
export function readTemplateFile(root: string, templateName: string): string | null {
  const p = join(root, ".specify", "templates", `${templateName}`);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

// ---------------------------------------------------------------------------
// Helper: write file ensuring parent dirs exist
// ---------------------------------------------------------------------------

function writeArtifact(path: string, content: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, content, "utf8");
}

// ---------------------------------------------------------------------------
// Helper: read artifact if it exists
// ---------------------------------------------------------------------------

function readArtifact(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

// ---------------------------------------------------------------------------
// Tech stack detection
// ---------------------------------------------------------------------------

/**
 * Read the project tech stack from docs/tech-stack.md.
 * Throws a clear error if the file is absent — run /generate-techstack or bootstrap first.
 */
export function readTechStack(root: string): string {
  const p = join(root, "docs", "tech-stack.md");
  if (!existsSync(p)) {
    throw new Error(
      "docs/tech-stack.md not found. Run /generate-techstack or bootstrap first to generate it."
    );
  }
  return readFileSync(p, "utf8").trim();
}

// ---------------------------------------------------------------------------
// Prompt builders per phase
// ---------------------------------------------------------------------------

function buildSnapshotBlock(snapshotContent: string | null): string {
  if (!snapshotContent) return "";
  return `\nCODEBASE CONTEXT (existing code — integrate with this):\n${snapshotContent}\n`;
}

function buildProjectStructureBlock(content: string | null): string {
  if (!content) return "";
  return `\nPROJECT STRUCTURE (MANDATORY — follow exactly, no new folders/layers):\n${content}\n`;
}

function buildCodemapBlock(content: string | null): string {
  if (!content) return "";
  return `\nEXISTING FILES (extend these, never duplicate):\n${content}\n`;
}

function buildCriteriaBlock(acceptanceCriteria: string[]): string {
  if (acceptanceCriteria.length === 0) return "";
  return `\n## Acceptance Criteria (must all be satisfied)\n${acceptanceCriteria.map((c) => `- ${c}`).join("\n")}\n`;
}

function buildCommandBlock(commandContent: string | null): string {
  if (!commandContent) return "";
  return `\n## SpecKit Instructions\n${commandContent}\n`;
}

function buildSpecPrompt(
  commandContent: string | null,
  featureTitle: string,
  acceptanceCriteria: string[],
  specTemplate: string | null,
  techStack: string,
  snapshotContent: string | null = null,
  projectStructure: string | null = null,
  codemap: string | null = null
): string {
  return `You are an expert software analyst. Output ONLY a Markdown specification document. Do NOT use any tools.

FEATURE: ${featureTitle}
${buildCriteriaBlock(acceptanceCriteria)}
TECH STACK:
${techStack}
${buildProjectStructureBlock(projectStructure)}${buildCodemapBlock(codemap)}${buildSnapshotBlock(snapshotContent)}
SPEC TEMPLATE:
${specTemplate ?? "Use sections: User Scenarios, Requirements, Success Criteria"}
${buildCommandBlock(commandContent)}
Generate a complete feature specification for "${featureTitle}" targeting the tech stack above.
Start with: # Feature Specification: ${featureTitle}
Include at least 2 user stories. Focus on WHAT, not HOW. No code.

Output the specification document now.`;
}

function buildPlanPrompt(
  commandContent: string | null,
  featureTitle: string,
  specContent: string,
  planTemplate: string | null,
  techStack: string,
  snapshotContent: string | null = null,
  acceptanceCriteria: string[] = [],
  projectStructure: string | null = null,
  codemap: string | null = null
): string {
  return `You are an expert software architect. Output ONLY a Markdown plan document. Do NOT use any tools.

FEATURE: ${featureTitle}
${buildCriteriaBlock(acceptanceCriteria)}
TECH STACK:
${techStack}
${buildProjectStructureBlock(projectStructure)}${buildCodemapBlock(codemap)}${buildSnapshotBlock(snapshotContent)}
SPECIFICATION:
${specContent}

PLAN TEMPLATE:
${planTemplate ?? "Sections: Summary, Technical Context, Project Structure, Phases"}
${buildCommandBlock(commandContent)}
Generate an implementation plan for "${featureTitle}" using the tech stack above.
Start with: # Implementation Plan: ${featureTitle}
Include exact file paths matching the tech stack conventions. No code, just the plan.

Output the plan document now.`;
}

function buildTasksPrompt(
  commandContent: string | null,
  featureTitle: string,
  featureId: string,
  specContent: string,
  planContent: string,
  techStack: string,
  snapshotContent: string | null = null,
  acceptanceCriteria: string[] = [],
  projectStructure: string | null = null,
  codemap: string | null = null
): string {
  return `You are an expert software engineer. Output ONLY a Markdown task list. Do NOT use any tools.

FEATURE: ${featureTitle}
FEATURE ID: ${featureId}
${buildCriteriaBlock(acceptanceCriteria)}
TECH STACK:
${techStack}
${buildProjectStructureBlock(projectStructure)}${buildCodemapBlock(codemap)}${buildSnapshotBlock(snapshotContent)}
SPECIFICATION:
${specContent}

PLAN:
${planContent}
${buildCommandBlock(commandContent)}
Generate a tasks.md for "${featureTitle}".
Start with: # Tasks: ${featureTitle}
Each task format: - [ ] T001 Description (file: <path appropriate for the tech stack above>)
Include setup and implementation tasks with exact file paths matching the tech stack conventions.

Output the tasks document now.`;
}

function buildImplementPrompt(
  commandContent: string | null,
  featureTitle: string,
  featureId: string,
  specContent: string,
  planContent: string,
  tasksContent: string,
  techStack: string,
  snapshotContent: string | null = null,
  acceptanceCriteria: string[] = [],
  projectStructure: string | null = null,
  codemap: string | null = null
): string {
  // NOTE: we do NOT ask claude to use file-writing tools here — we need plain
  // text output only (<<<FILE:>>> blocks) and write the files ourselves.
  return `You are an expert developer. Your job is to produce source code as plain text output ONLY.

IMPORTANT CONSTRAINTS:
- Do NOT use any tools, file writing, or bash commands.
- Do NOT ask for permissions or confirmations.
- Output ONLY plain text using the file format below.

FEATURE: ${featureTitle}
FEATURE ID: ${featureId}
${buildCriteriaBlock(acceptanceCriteria)}
TECH STACK:
${techStack}
${buildProjectStructureBlock(projectStructure)}${buildCodemapBlock(codemap)}${buildSnapshotBlock(snapshotContent)}
SPECIFICATION:
${specContent}

IMPLEMENTATION PLAN:
${planContent}

TASKS:
${tasksContent}
${buildCommandBlock(commandContent)}
YOUR TASK:
Generate complete, working source files for "${featureTitle}" using the tech stack above.

MANDATORY OUTPUT FORMAT — use this exact format for every file:
<<<FILE: relative/path/to/file>>>
// source code here
<<<END_FILE>>>

Requirements:
1. Generate all files required by the implementation plan
2. File paths must match the conventions in the tech stack
3. All code must be complete and runnable — no pseudocode
4. Export all public types and functions
5. Implement every acceptance criterion listed above

Output the files now using the <<<FILE:>>> format above. Nothing else.`;
}

// ---------------------------------------------------------------------------
// File extraction from AI response
// ---------------------------------------------------------------------------

interface GeneratedFile {
  path: string;
  content: string;
}

export function extractGeneratedFiles(aiResponse: string): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  // Match <<<FILE: path>>> ... <<<END_FILE>>> blocks
  const filePattern = /<<<FILE:\s*([^\n>]+)>>>\r?\n([\s\S]*?)<<<END_FILE>>>/g;
  let match;
  while ((match = filePattern.exec(aiResponse)) !== null) {
    const filePath = match[1].trim();
    const content = match[2];
    files.push({ path: filePath, content });
  }

  // Fallback: look for markdown code blocks with file paths
  // Pattern: ```typescript\n// path: src/...\n...```
  if (files.length === 0) {
    const codeBlockPattern = /```(?:typescript|ts)\n(?:\/\/\s*(?:file|path):\s*([^\n]+)\n)?([\s\S]*?)```/g;
    while ((match = codeBlockPattern.exec(aiResponse)) !== null) {
      const filePath = match[1]?.trim();
      const content = match[2];
      if (filePath && content.trim()) {
        files.push({ path: filePath, content });
      }
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Verify implementation produced code
// ---------------------------------------------------------------------------

export interface CodeVerificationResult {
  hasNewFiles: boolean;
  changedFiles: string[];
  diffSummary: string;
}

// Root-level dirs to skip when scanning for source files
const SOURCE_SCAN_EXCLUDE = new Set([
  ".git", "docs", "node_modules", ".specify", ".speckit", ".claude", "specs",
]);

function scanSourceFiles(root: string): string[] {
  const results: string[] = [];
  function walk(dir: string, rel: string, isRoot: boolean): void {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (isRoot && SOURCE_SCAN_EXCLUDE.has(entry)) continue;
      const full = join(dir, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full, relPath, false);
        } else if (!entry.endsWith(".DS_Store") && !entry.endsWith(".md")) {
          results.push(relPath);
        }
      } catch { /* skip */ }
    }
  }
  walk(root, "", true);
  return results;
}

function detectNewSourceFiles(root: string): string[] {
  const snapshotPath = join(root, "docs", "codebase-snapshot.md");
  const snapshotFiles = new Set<string>();
  if (existsSync(snapshotPath)) {
    for (const line of readFileSync(snapshotPath, "utf8").split("\n")) {
      if (line.startsWith("- ")) snapshotFiles.add(line.slice(2).trim());
    }
  }
  const current = scanSourceFiles(root);
  return current.filter((f) => !snapshotFiles.has(f));
}

export function verifyImplementationProducedCode(
  root: string,
  featureId: string
): CodeVerificationResult {
  // Check for files in src/features/{featureId}/ directory
  const featureDir = join(root, "src", "features", featureId.toLowerCase());

  if (existsSync(featureDir)) {
    const result = spawnSync("find", [featureDir, "-name", "*.ts", "-not", "-name", "*.d.ts"], {
      cwd: root,
      encoding: "utf8",
      shell: false,
    });
    const files = (result.stdout ?? "").trim().split("\n").filter(Boolean);
    if (files.length > 0) {
      return {
        hasNewFiles: true,
        changedFiles: files,
        diffSummary: `${files.length} TypeScript file(s) in ${featureDir}`,
      };
    }
  }

  // Also check docs/specs/{featureId}/ for spec artifacts
  const specsDir = join(root, "docs", "specs", featureId.toLowerCase());
  const specArtifacts: string[] = [];
  for (const artifact of ["spec.md", "plan.md", "tasks.md"]) {
    if (existsSync(join(specsDir, artifact))) {
      specArtifacts.push(join(specsDir, artifact));
    }
  }

  // Try git diff to detect changes
  const gitResult = spawnSync("git", ["diff", "--name-only", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 10_000,
  });

  const gitNewResult = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "src/"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 10_000,
  });

  const diffFiles = [
    ...(gitResult.stdout ?? "").trim().split("\n").filter(Boolean),
    ...(gitNewResult.stdout ?? "").trim().split("\n").filter(Boolean),
  ].filter(
    (f) =>
      f.startsWith("src/") &&
      !f.endsWith(".test.ts") &&
      !f.endsWith(".spec.ts") &&
      !f.includes("/specs/")
  );

  if (diffFiles.length > 0) {
    return {
      hasNewFiles: true,
      changedFiles: diffFiles,
      diffSummary: `${diffFiles.length} source file(s) changed via git`,
    };
  }

  // Non-git fallback: compare against codebase-snapshot.md to find truly new files
  const newSourceFiles = detectNewSourceFiles(root);
  if (newSourceFiles.length > 0) {
    return {
      hasNewFiles: true,
      changedFiles: newSourceFiles,
      diffSummary: `${newSourceFiles.length} new source file(s) detected`,
    };
  }

  // Only spec artifacts — no application code produced
  return {
    hasNewFiles: false,
    changedFiles: specArtifacts,
    diffSummary:
      specArtifacts.length > 0
        ? `${specArtifacts.length} spec artifact(s) only (no application code)`
        : "No application code produced",
  };
}

// ---------------------------------------------------------------------------
// Main SpecKitRunner
// ---------------------------------------------------------------------------

/** Common locations where the claude CLI may be installed. */
const CLAUDE_SEARCH_PATHS = [
  process.env.HOME ? `${process.env.HOME}/.local/bin` : "",
  process.env.HOME ? `${process.env.HOME}/.npm-global/bin` : "",
  "/usr/local/bin",
  "/opt/homebrew/bin",
].filter(Boolean);

/** Augmented PATH that includes common claude install dirs. */
export function augmentedPath(): string {
  const existing = process.env.PATH ?? "";
  const extra = CLAUDE_SEARCH_PATHS.filter((p) => !existing.includes(p)).join(":");
  return extra ? `${extra}:${existing}` : existing;
}

export class SpecKitRunner {
  private readonly root: string;
  private readonly claudePath: string = "claude";
  private readonly techStack: string;
  private readonly snapshotContent: string | null;
  private readonly projectStructureContent: string | null;
  private codemapContent: string | null;

  /**
   * Overridable Claude call — defaults to the CLI implementation.
   * Tests can replace this with a mock: `runner.callClaude = async () => "..."`.
   */
  callClaude: (prompt: string) => Promise<string>;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(root: string, _apiKey?: string) {
    this.root = root;
    // Always use CLI — verify it is available
    const env = { ...process.env, PATH: augmentedPath() };
    const check = spawnSync("claude", ["--version"], { encoding: "utf8", shell: false, env });
    if (check.status !== 0) {
      throw new Error(
        "SpecKitRunner requires the claude CLI installed and authenticated. " +
          "Run `claude --version` to verify the CLI is available."
      );
    }
    this.callClaude = this.callClaudeCli.bind(this);
    this.techStack = readTechStack(root);
    // Load brownfield snapshot if present — passed as context to all phase prompts
    const snapshotPath = join(root, "docs", "brownfield-snapshot.md");
    this.snapshotContent = existsSync(snapshotPath) ? readFileSync(snapshotPath, "utf8") : null;
    // Load canonical project structure and codebase file tree if present
    this.projectStructureContent = readArtifact(join(root, "docs", "project-structure.md"));
    this.codemapContent = readArtifact(join(root, "docs", "codebase-snapshot.md"));
  }

  /** Always "cli" — kept for compatibility with existing callers. */
  getMode(): "cli" {
    return "cli";
  }

  /** Reload codebase-snapshot.md from disk (call after updateCodebaseSnapshot). */
  reloadCodemap(): void {
    this.codemapContent = readArtifact(join(this.root, "docs", "codebase-snapshot.md"));
  }

  private specsDir(featureId: string): string {
    return join(this.root, "docs", "specs", featureId.toLowerCase());
  }

  private callClaudeCli(prompt: string): Promise<string> {
    // Use async spawn so large responses don't hit spawnSync's blocking timeout.
    // Pipe prompt via stdin to avoid shell-escaping issues with large prompts.
    const env = { ...process.env, PATH: augmentedPath() };
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const proc = spawn(this.claudePath, ["--print", "--dangerously-skip-permissions"], {
        shell: false,
        env,
        cwd: this.root,
      });

      proc.stdin.write(prompt);
      proc.stdin.end();

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      // Hard ceiling: 25 minutes per phase
      const timer = setTimeout(() => {
        proc.kill();
        settle(() => reject(new Error("claude CLI timed out after 25 minutes")));
      }, 1_500_000);

      proc.on("close", (code: number | null) => {
        clearTimeout(timer);
        if (code !== 0) {
          settle(() => reject(new Error(`claude CLI failed (exit ${code}): ${stderr.slice(0, 500)}`)));
        } else if (!stdout.trim()) {
          settle(() => reject(new Error(`claude CLI returned empty response (stderr: ${stderr.slice(0, 300)})`)));
        } else {
          settle(() => resolve(stdout.trim()));
        }
      });

      proc.on("error", (err: Error) => {
        clearTimeout(timer);
        settle(() => reject(new Error(`claude CLI error: ${err.message}`)));
      });
    });
  }

  // Phase: spec
  async runSpec(featureId: string, featureTitle: string, acceptanceCriteria: string[]): Promise<string> {
    const commandContent =
      readCommandFile(this.root, "speckit.specify") ??
      "Create a feature specification with User Scenarios, Requirements, and Success Criteria.";
    const specTemplate = readTemplateFile(this.root, "spec-template.md");

    const prompt = buildSpecPrompt(commandContent, featureTitle, acceptanceCriteria, specTemplate, this.techStack, this.snapshotContent, this.projectStructureContent, this.codemapContent);
    const response = await this.callClaude(prompt);

    const specsDir = this.specsDir(featureId);
    const specPath = join(specsDir, "spec.md");
    writeArtifact(specPath, response);
    return specPath;
  }

  // Phase: constitution (only if .speckit/constitution.md is missing)
  async runConstitution(featureId: string, featureTitle: string): Promise<string | null> {
    const constitutionPath = join(this.root, ".speckit", "constitution.md");
    if (existsSync(constitutionPath)) return null; // already exists — skip

    const commandContent =
      readCommandFile(this.root, "speckit.constitution") ??
      "Create a project constitution that defines coding standards, architectural patterns, and governance rules.";
    const template = readTemplateFile(this.root, "constitution-template.md");

    const techBlock = this.techStack ? `\n## Tech Stack\n${this.techStack}\n` : "";
    const templateBlock = template ? `\n## Template\n${template}\n` : "";
    const prompt = `${commandContent}\n\nGenerate a constitution.md for this project.\nFeature context: ${featureTitle} (${featureId})${techBlock}${templateBlock}\n\nWrite the constitution in Markdown format covering: coding standards, architectural patterns, naming conventions, testing requirements, and governance rules.`;

    const response = await this.callClaude(prompt);
    writeArtifact(constitutionPath, response);
    return constitutionPath;
  }

  // Phase: clarify (auto-clarify pass on spec.md)
  async runClarify(featureId: string, featureTitle: string): Promise<string | null> {
    const specsDir = this.specsDir(featureId);
    const specPath = join(specsDir, "spec.md");
    const specContent = readArtifact(specPath);
    if (!specContent) return null; // no spec to clarify — skip silently

    const commandContent =
      readCommandFile(this.root, "speckit.clarify") ??
      "Identify and resolve ambiguities in the feature specification.";

    const prompt = `${commandContent}\n\nAnalyse the following spec for ambiguities (vague terms, undefined thresholds, open decisions). For each ambiguity found, provide a definitive answer based on the tech stack and feature context. Append your answers as a ## Clarifications section.\n\nFeature: ${featureTitle} (${featureId})\n\n## Spec\n${specContent}`;

    const response = await this.callClaude(prompt);
    const clarificationsBlock = `\n\n## Clarifications\n${response.replace(/^##\s*Clarifications\s*/i, "").trim()}\n`;
    const updated = specContent.includes("## Clarifications")
      ? specContent
      : specContent + clarificationsBlock;
    writeArtifact(specPath, updated);
    return specPath;
  }

  // Phase: analyze (spec × plan × tasks consistency report)
  async runAnalyze(featureId: string, featureTitle: string): Promise<string | null> {
    const specsDir = this.specsDir(featureId);
    const specContent = readArtifact(join(specsDir, "spec.md"));
    const planContent = readArtifact(join(specsDir, "plan.md"));
    const tasksContent = readArtifact(join(specsDir, "tasks.md"));

    if (!specContent && !planContent && !tasksContent) return null; // nothing to analyze

    const commandContent =
      readCommandFile(this.root, "speckit.analyze") ??
      "Validate consistency between spec, plan, and tasks documents.";

    const prompt = `${commandContent}\n\nValidate consistency across the following documents for feature "${featureTitle}" (${featureId}). Identify: requirements without tasks, tasks without corresponding requirements, contradictions, and coverage gaps. Format as a Markdown report.\n\n## Spec\n${specContent ?? "(missing)"}\n\n## Plan\n${planContent ?? "(missing)"}\n\n## Tasks\n${tasksContent ?? "(missing)"}`;

    const response = await this.callClaude(prompt);
    const reportPath = join(specsDir, "analysis-report.md");
    writeArtifact(reportPath, response);
    return reportPath;
  }

  // Phase: plan
  async runPlan(featureId: string, featureTitle: string, acceptanceCriteria: string[] = []): Promise<string> {
    const specsDir = this.specsDir(featureId);
    const specContent = readArtifact(join(specsDir, "spec.md"));
    if (!specContent) {
      throw new Error(`spec.md not found for "${featureTitle}" (${featureId}) — run spec phase first`);
    }

    const commandContent =
      readCommandFile(this.root, "speckit.plan") ??
      "Create an implementation plan with Technical Context and Project Structure.";
    const planTemplate = readTemplateFile(this.root, "plan-template.md");

    const prompt = buildPlanPrompt(commandContent, featureTitle, specContent, planTemplate, this.techStack, this.snapshotContent, acceptanceCriteria, this.projectStructureContent, this.codemapContent);
    const response = await this.callClaude(prompt);

    const planPath = join(specsDir, "plan.md");
    writeArtifact(planPath, response);
    return planPath;
  }

  // Phase: tasks
  async runTasks(featureId: string, featureTitle: string, acceptanceCriteria: string[] = []): Promise<string> {
    const specsDir = this.specsDir(featureId);
    const specContent = readArtifact(join(specsDir, "spec.md")) ?? `Feature: ${featureTitle}`;
    const planContent = readArtifact(join(specsDir, "plan.md")) ?? `Plan for: ${featureTitle}`;

    const commandContent =
      readCommandFile(this.root, "speckit.tasks") ??
      "Generate actionable tasks with file paths for implementation.";

    const prompt = buildTasksPrompt(commandContent, featureTitle, featureId, specContent, planContent, this.techStack, this.snapshotContent, acceptanceCriteria, this.projectStructureContent, this.codemapContent);
    const response = await this.callClaude(prompt);

    const tasksPath = join(specsDir, "tasks.md");
    writeArtifact(tasksPath, response);
    return tasksPath;
  }

  // Phase: implement
  async runImplement(featureId: string, featureTitle: string, acceptanceCriteria: string[] = []): Promise<string[]> {
    const specsDir = this.specsDir(featureId);
    // Truncate large artifacts to avoid exceeding claude CLI prompt limits.
    // Keep the most actionable content: full tasks list (usually short) +
    // first 150 lines of spec + first 100 lines of plan.
    const truncate = (s: string, lines: number) =>
      s.split("\n").slice(0, lines).join("\n");
    const specContent = truncate(readArtifact(join(specsDir, "spec.md")) ?? `Feature: ${featureTitle}`, 150);
    const planContent = truncate(readArtifact(join(specsDir, "plan.md")) ?? `Plan for: ${featureTitle}`, 100);
    const tasksContent = readArtifact(join(specsDir, "tasks.md")) ?? `Tasks for: ${featureTitle}`;

    const commandContent =
      readCommandFile(this.root, "speckit.implement") ??
      "Implement all tasks from tasks.md, writing real TypeScript files.";

    const prompt = buildImplementPrompt(
      commandContent,
      featureTitle,
      featureId,
      specContent,
      planContent,
      tasksContent,
      this.techStack,
      this.snapshotContent,
      acceptanceCriteria,
      this.projectStructureContent,
      this.codemapContent
    );
    const response = await this.callClaude(prompt);

    // With --dangerously-skip-permissions, claude may write files directly via
    // tool_use. Detect ONLY newly written/modified files using git to avoid
    // returning pre-existing brownfield files as if they were just generated.
    const { spawnSync: sp } = await import("child_process");

    // git diff --name-only HEAD: staged + unstaged changes since last commit
    const gitDiff = sp("git", ["diff", "--name-only", "HEAD"], {
      cwd: this.root, encoding: "utf8", shell: false, timeout: 10_000,
    });
    // git ls-files --others --exclude-standard src/: untracked new files
    const gitNew = sp("git", ["ls-files", "--others", "--exclude-standard", "src/"], {
      cwd: this.root, encoding: "utf8", shell: false, timeout: 10_000,
    });
    const newOnDisk = [
      ...(gitDiff.stdout ?? "").trim().split("\n").filter(Boolean),
      ...(gitNew.stdout ?? "").trim().split("\n").filter(Boolean),
    ].filter(
      (f) =>
        (f.endsWith(".ts") || f.endsWith(".js") || f.endsWith(".py") || f.endsWith(".cs") ||
         f.endsWith(".go") || f.endsWith(".dart") || f.endsWith(".java")) &&
        !f.endsWith(".d.ts") &&
        !f.endsWith(".test.ts") &&
        !f.endsWith(".spec.ts") &&
        !f.includes("/specs/")
    );
    if (newOnDisk.length > 0) {
      return newOnDisk.map((f) => join(this.root, f));
    }

    // Nothing written by tool_use — extract <<<FILE:>>> blocks from text response
    const generatedFiles = extractGeneratedFiles(response);
    if (generatedFiles.length === 0) {
      throw new Error(
        `No source files generated for "${featureTitle}" (${featureId}). ` +
        `Claude did not produce any <<<FILE: path>>> blocks. ` +
        `Check the prompt and try again.`
      );
    }
    const writtenPaths: string[] = [];
    for (const file of generatedFiles) {
      const fullPath = join(this.root, file.path);
      writeArtifact(fullPath, file.content);
      writtenPaths.push(fullPath);
    }
    return writtenPaths;
  }

  // Run all phases from startFromPhase onward
  async runPhases(
    featureId: string,
    featureTitle: string,
    acceptanceCriteria: string[],
    startFromPhase: Phase = "spec"
  ): Promise<PhaseRunResult> {
    // constitution is only run when .speckit/constitution.md is missing
    const constitutionPath = join(this.root, ".speckit", "constitution.md");
    const phases: Phase[] = [
      ...(existsSync(constitutionPath) ? [] : (["constitution"] as Phase[])),
      "spec",
      "clarify",
      "plan",
      "tasks",
      "analyze",
      "implement",
    ];
    const startIdx = phases.indexOf(startFromPhase);
    // "qa" and "done" are handled by the caller — nothing to run here
    if (startIdx === -1 && (startFromPhase === "qa" || startFromPhase === "done")) {
      return { success: true, phase: startFromPhase };
    }
    const activePhases = startIdx >= 0 ? phases.slice(startIdx) : phases;

    let lastPhase: Phase = startFromPhase;

    try {
      for (const phase of activePhases) {
        lastPhase = phase;

        switch (phase) {
          case "constitution":
            await this.runConstitution(featureId, featureTitle);
            break;

          case "spec":
            await this.runSpec(featureId, featureTitle, acceptanceCriteria);
            break;

          case "clarify":
            await this.runClarify(featureId, featureTitle);
            break;

          case "plan":
            await this.runPlan(featureId, featureTitle, acceptanceCriteria);
            break;

          case "tasks":
            await this.runTasks(featureId, featureTitle, acceptanceCriteria);
            break;

          case "analyze":
            await this.runAnalyze(featureId, featureTitle);
            break;

          case "implement": {
            await this.runImplement(featureId, featureTitle, acceptanceCriteria);
            break;
          }

          case "qa":
          case "done":
            // qa and done are handled by the caller
            break;
        }
      }

      return { success: true, phase: lastPhase };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, phase: lastPhase, error: message };
    }
  }
}

