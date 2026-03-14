import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { spawnSync } from "child_process";
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
// Prompt builders per phase
// ---------------------------------------------------------------------------

function buildSpecPrompt(
  _commandContent: string,
  featureTitle: string,
  acceptanceCriteria: string[],
  specTemplate: string | null
): string {
  const criteriaBlock =
    acceptanceCriteria.length > 0
      ? `Acceptance Criteria:\n${acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`
      : "";

  return `You are an expert software analyst. Output ONLY a Markdown specification document. Do NOT use any tools.

FEATURE: ${featureTitle}
${criteriaBlock}

SPEC TEMPLATE:
${specTemplate ?? "Use sections: User Scenarios, Requirements, Success Criteria"}

Generate a complete feature specification for "${featureTitle}".
Start with: # Feature Specification: ${featureTitle}
Include at least 2 user stories. Focus on WHAT, not HOW. No code.

Output the specification document now.`;
}

function buildPlanPrompt(
  _commandContent: string,
  featureTitle: string,
  specContent: string,
  planTemplate: string | null
): string {
  return `You are an expert software architect. Output ONLY a Markdown plan document. Do NOT use any tools.

FEATURE: ${featureTitle}

SPECIFICATION:
${specContent}

PLAN TEMPLATE:
${planTemplate ?? "Sections: Summary, Technical Context, Project Structure, Phases"}

Generate an implementation plan for "${featureTitle}" in TypeScript.
Start with: # Implementation Plan: ${featureTitle}
Include exact file paths (use src/features/ directory). No code, just the plan.

Output the plan document now.`;
}

function buildTasksPrompt(
  _commandContent: string,
  featureTitle: string,
  featureId: string,
  specContent: string,
  planContent: string
): string {
  return `You are an expert software engineer. Output ONLY a Markdown task list. Do NOT use any tools.

FEATURE: ${featureTitle}
FEATURE ID: ${featureId}

SPECIFICATION:
${specContent}

PLAN:
${planContent}

Generate a tasks.md for "${featureTitle}".
Start with: # Tasks: ${featureTitle}
Each task format: - [ ] T001 Description (file: src/features/${featureId}/index.ts)
Include setup and implementation tasks with exact TypeScript file paths.

Output the tasks document now.`;
}

function buildImplementPrompt(
  _commandContent: string,
  featureTitle: string,
  featureId: string,
  specContent: string,
  planContent: string,
  tasksContent: string
): string {
  // NOTE: we intentionally do NOT include the speckit.implement.md command
  // instructions here, because those instruct claude to use file-writing tools.
  // We need plain text output only — we write the files ourselves.
  return `You are an expert TypeScript developer. Your job is to produce source code as plain text output ONLY.

IMPORTANT CONSTRAINTS:
- Do NOT use any tools, file writing, or bash commands.
- Do NOT ask for permissions or confirmations.
- Output ONLY plain text using the file format below.

FEATURE: ${featureTitle}
FEATURE ID: ${featureId}

SPECIFICATION:
${specContent}

IMPLEMENTATION PLAN:
${planContent}

TASKS:
${tasksContent}

YOUR TASK:
Generate complete, working TypeScript source files for "${featureTitle}".

MANDATORY OUTPUT FORMAT — use this exact format for every file:
<<<FILE: src/features/${featureId}/index.ts>>>
// TypeScript source code here
<<<END_FILE>>>

Requirements:
1. At minimum generate src/features/${featureId}/index.ts
2. Also generate src/features/${featureId}/types.ts if you need complex types
3. All code must be complete and runnable TypeScript — no pseudocode
4. Export all public types and functions
5. Implement every acceptance criterion from the spec

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
  const filePattern = /<<<FILE:\s*([^\n>]+)>>>\n([\s\S]*?)<<<END_FILE>>>/g;
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

  return {
    hasNewFiles: specArtifacts.length > 0,
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

type RunnerMode = "cli" | "sdk";

/** Common locations where the claude CLI may be installed. */
const CLAUDE_SEARCH_PATHS = [
  process.env.HOME ? `${process.env.HOME}/.local/bin` : "",
  process.env.HOME ? `${process.env.HOME}/.npm-global/bin` : "",
  "/usr/local/bin",
  "/opt/homebrew/bin",
].filter(Boolean);

/** Augmented PATH that includes common claude install dirs. */
function augmentedPath(): string {
  const existing = process.env.PATH ?? "";
  const extra = CLAUDE_SEARCH_PATHS.filter((p) => !existing.includes(p)).join(":");
  return extra ? `${extra}:${existing}` : existing;
}

export class SpecKitRunner {
  private readonly mode: RunnerMode;
  private readonly client?: Anthropic;
  private readonly root: string;
  private readonly model = "claude-sonnet-4-6";
  private readonly claudePath: string = "claude";

  constructor(root: string, apiKey?: string) {
    this.root = root;
    const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (key) {
      this.mode = "sdk";
      this.client = new Anthropic({ apiKey: key });
    } else {
      // No API key — try claude CLI with augmented PATH
      const env = { ...process.env, PATH: augmentedPath() };
      const check = spawnSync("claude", ["--version"], { encoding: "utf8", shell: false, env });
      if (check.status !== 0) {
        throw new Error(
          "SpecKitRunner requires either ANTHROPIC_API_KEY (SDK mode) " +
            "or the claude CLI installed and authenticated (CLI mode). " +
            "Run `claude --version` to verify the CLI is available."
        );
      }
      this.mode = "cli";
    }
  }

  /** Expose mode for testing / logging */
  getMode(): RunnerMode {
    return this.mode;
  }

  private specsDir(featureId: string): string {
    return join(this.root, "docs", "specs", featureId.toLowerCase());
  }

  private async callClaude(prompt: string): Promise<string> {
    return this.mode === "sdk" ? this.callClaudeSdk(prompt) : this.callClaudeCli(prompt);
  }

  private async callClaudeSdk(prompt: string): Promise<string> {
    if (!this.client) throw new Error("Anthropic client not initialized");
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
    const textContent = message.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("Claude returned no text content");
    }
    return textContent.text;
  }

  private callClaudeCli(prompt: string): Promise<string> {
    // Pipe prompt via stdin — avoids shell-escaping issues with large prompts.
    // Use augmented PATH so claude is found regardless of login shell config.
    // --dangerously-skip-permissions: we drive all file writes ourselves; we
    //   only want Claude to generate text, not ask for tool-use permissions.
    const env = { ...process.env, PATH: augmentedPath() };
    const result = spawnSync(this.claudePath, ["--print", "--dangerously-skip-permissions"], {
      input: prompt,
      encoding: "utf8",
      shell: false,
      env,
      timeout: 300_000, // 5 min per phase
      cwd: this.root,
    });
    if (result.status !== 0 || result.error) {
      const msg = result.stderr ?? result.error?.message ?? "unknown error";
      throw new Error(`claude CLI failed (exit ${result.status}): ${msg.slice(0, 500)}`);
    }
    const output = (result.stdout ?? "").trim();
    if (!output) throw new Error("claude CLI returned empty response");
    return Promise.resolve(output);
  }

  // Phase: spec
  async runSpec(featureId: string, featureTitle: string, acceptanceCriteria: string[]): Promise<string> {
    const commandContent =
      readCommandFile(this.root, "speckit.specify") ??
      "Create a feature specification with User Scenarios, Requirements, and Success Criteria.";
    const specTemplate = readTemplateFile(this.root, "spec-template.md");

    const prompt = buildSpecPrompt(commandContent, featureTitle, acceptanceCriteria, specTemplate);
    const response = await this.callClaude(prompt);

    const specsDir = this.specsDir(featureId);
    const specPath = join(specsDir, "spec.md");
    writeArtifact(specPath, response);
    return specPath;
  }

  // Phase: plan
  async runPlan(featureId: string, featureTitle: string): Promise<string> {
    const specsDir = this.specsDir(featureId);
    const specContent = readArtifact(join(specsDir, "spec.md")) ?? `Feature: ${featureTitle}`;

    const commandContent =
      readCommandFile(this.root, "speckit.plan") ??
      "Create an implementation plan with Technical Context and Project Structure.";
    const planTemplate = readTemplateFile(this.root, "plan-template.md");

    const prompt = buildPlanPrompt(commandContent, featureTitle, specContent, planTemplate);
    const response = await this.callClaude(prompt);

    const planPath = join(specsDir, "plan.md");
    writeArtifact(planPath, response);
    return planPath;
  }

  // Phase: tasks
  async runTasks(featureId: string, featureTitle: string): Promise<string> {
    const specsDir = this.specsDir(featureId);
    const specContent = readArtifact(join(specsDir, "spec.md")) ?? `Feature: ${featureTitle}`;
    const planContent = readArtifact(join(specsDir, "plan.md")) ?? `Plan for: ${featureTitle}`;

    const commandContent =
      readCommandFile(this.root, "speckit.tasks") ??
      "Generate actionable tasks with file paths for implementation.";

    const prompt = buildTasksPrompt(commandContent, featureTitle, featureId, specContent, planContent);
    const response = await this.callClaude(prompt);

    const tasksPath = join(specsDir, "tasks.md");
    writeArtifact(tasksPath, response);
    return tasksPath;
  }

  // Phase: implement
  async runImplement(featureId: string, featureTitle: string): Promise<string[]> {
    const specsDir = this.specsDir(featureId);
    const specContent = readArtifact(join(specsDir, "spec.md")) ?? `Feature: ${featureTitle}`;
    const planContent = readArtifact(join(specsDir, "plan.md")) ?? `Plan for: ${featureTitle}`;
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
      tasksContent
    );
    const response = await this.callClaude(prompt);

    // In CLI mode with --dangerously-skip-permissions, claude writes files
    // directly via tool_use. Check what was written to disk first.
    if (this.mode === "cli") {
      const featureDir = join(this.root, "src", "features", featureId.toLowerCase());
      const { spawnSync: sp } = await import("child_process");
      const found = sp("find", [this.root + "/src", "-name", "*.ts", "-not", "-name", "*.d.ts"], {
        encoding: "utf8",
        shell: false,
      });
      const filesOnDisk = (found?.stdout ?? "").trim().split("\n").filter(Boolean);
      if (filesOnDisk.length > 0) {
        return filesOnDisk;
      }
      // Nothing written — fall back to text extraction or stub
      const generatedFiles = extractGeneratedFiles(response);
      const writtenPaths: string[] = [];
      for (const file of generatedFiles) {
        const fullPath = join(this.root, file.path);
        writeArtifact(fullPath, file.content);
        writtenPaths.push(fullPath);
      }
      if (writtenPaths.length === 0) {
        const indexPath = join(featureDir, "index.ts");
        writeArtifact(indexPath, generateFallbackImplementation(featureTitle, featureId, response));
        writtenPaths.push(indexPath);
      }
      return writtenPaths;
    }

    // SDK mode: extract <<<FILE:>>> blocks from text response
    const generatedFiles = extractGeneratedFiles(response);
    const writtenPaths: string[] = [];

    for (const file of generatedFiles) {
      const fullPath = join(this.root, file.path);
      writeArtifact(fullPath, file.content);
      writtenPaths.push(fullPath);
    }

    // If no files were extracted, create a minimal implementation
    if (writtenPaths.length === 0) {
      const featureDir = join(this.root, "src", "features", featureId.toLowerCase());
      const indexPath = join(featureDir, "index.ts");
      const fallback = generateFallbackImplementation(featureTitle, featureId, response);
      writeArtifact(indexPath, fallback);
      writtenPaths.push(indexPath);
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
    const phases: Phase[] = ["spec", "plan", "tasks", "implement"];
    const startIdx = phases.indexOf(startFromPhase);
    const activePhases = startIdx >= 0 ? phases.slice(startIdx) : phases;

    let lastPhase: Phase = startFromPhase;

    try {
      for (const phase of activePhases) {
        lastPhase = phase;

        switch (phase) {
          case "spec":
          case "constitution":
          case "clarify":
          case "analyze":
            // constitution, clarify, analyze are optional sub-phases within spec
            if (phase === "spec") {
              await this.runSpec(featureId, featureTitle, acceptanceCriteria);
            }
            break;

          case "plan":
            await this.runPlan(featureId, featureTitle);
            break;

          case "tasks":
            await this.runTasks(featureId, featureTitle);
            break;

          case "implement": {
            await this.runImplement(featureId, featureTitle);
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

// ---------------------------------------------------------------------------
// Fallback implementation generator
// ---------------------------------------------------------------------------

function generateFallbackImplementation(featureTitle: string, featureId: string, context: string): string {
  // Extract any code snippets from the AI response as hints
  const codeHints = context.match(/```(?:typescript|ts)?\n([\s\S]*?)```/g) ?? [];
  const firstCodeHint = codeHints[0]?.replace(/```(?:typescript|ts)?\n/, "").replace(/```$/, "") ?? "";

  if (firstCodeHint.trim().length > 50) {
    return firstCodeHint;
  }

  // Generate a stub implementation
  const moduleName = featureId.toLowerCase().replace(/[^a-z0-9]/g, "_");
  return `/**
 * ${featureTitle}
 * Feature ID: ${featureId}
 *
 * Auto-generated by speckit-autopilot
 * Generated: ${new Date().toISOString()}
 */

export interface ${pascalCase(featureId)}Config {
  enabled: boolean;
}

export interface ${pascalCase(featureId)}Result {
  success: boolean;
  message: string;
}

/**
 * Initialize the ${featureTitle} feature.
 */
export function init${pascalCase(featureId)}(config: ${pascalCase(featureId)}Config): ${pascalCase(featureId)}Result {
  if (!config.enabled) {
    return { success: false, message: "${featureTitle} is disabled" };
  }
  return { success: true, message: "${featureTitle} initialized successfully" };
}

export default {
  init: init${pascalCase(featureId)},
};

// Module name for internal use
export const MODULE_NAME = "${moduleName}";
`;
}

function pascalCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[-_\s]+(.)/g, (_, char: string) => (char as string).toUpperCase())
    .replace(/^(.)/, (_, char: string) => (char as string).toUpperCase());
}
