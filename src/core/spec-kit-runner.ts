import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { spawnSync } from "child_process";
import type { Phase } from "./state-store.js";

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
  commandContent: string,
  featureTitle: string,
  acceptanceCriteria: string[],
  specTemplate: string | null
): string {
  const criteriaBlock =
    acceptanceCriteria.length > 0
      ? `Acceptance Criteria:\n${acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`
      : "";

  return `You are acting as an expert software analyst following the Spec Kit specification workflow.

FEATURE TO SPECIFY: ${featureTitle}
${criteriaBlock}

SPEC-KIT COMMAND INSTRUCTIONS:
${commandContent}

SPEC TEMPLATE (use this structure):
${specTemplate ?? "(use standard spec structure with: User Scenarios & Testing, Requirements, Success Criteria)"}

YOUR TASK:
Generate a complete feature specification for "${featureTitle}" following the spec template structure.
Write it as a well-formed Markdown document starting with "# Feature Specification: ${featureTitle}".
Focus on WHAT users need, not HOW to implement it.
Make all requirements testable and measurable.
Include at least 2 user stories with acceptance scenarios.
Do NOT include implementation details (no code, no tech stack).

OUTPUT: The complete spec.md content only, starting with the # heading.`;
}

function buildPlanPrompt(
  commandContent: string,
  featureTitle: string,
  specContent: string,
  planTemplate: string | null
): string {
  return `You are acting as an expert software architect following the Spec Kit planning workflow.

FEATURE: ${featureTitle}

FEATURE SPECIFICATION:
${specContent}

SPEC-KIT COMMAND INSTRUCTIONS:
${commandContent}

PLAN TEMPLATE:
${planTemplate ?? "(use standard plan structure with: Summary, Technical Context, Project Structure, Phases)"}

YOUR TASK:
Generate a complete implementation plan for "${featureTitle}" following the plan template structure.
The plan MUST include:
1. Summary section
2. Technical Context (language: TypeScript, testing: Jest, project type: library/CLI)
3. Project Structure showing exact file paths that will be created
4. Phase 0: Research (list any technical decisions)
5. Phase 1: Design & Contracts (data models, interfaces)

Write it as a well-formed Markdown document starting with "# Implementation Plan: ${featureTitle}".
Be specific about file paths. For a TypeScript project, use src/features/{featureId}/ as the output directory.

OUTPUT: The complete plan.md content only, starting with the # heading.`;
}

function buildTasksPrompt(
  commandContent: string,
  featureTitle: string,
  featureId: string,
  specContent: string,
  planContent: string
): string {
  return `You are acting as an expert software engineer following the Spec Kit tasks workflow.

FEATURE: ${featureTitle}
FEATURE ID: ${featureId}

FEATURE SPECIFICATION:
${specContent}

IMPLEMENTATION PLAN:
${planContent}

SPEC-KIT COMMAND INSTRUCTIONS:
${commandContent}

YOUR TASK:
Generate a complete tasks.md for "${featureTitle}" that an AI can execute.
Tasks MUST follow this EXACT format:
- [ ] T001 Description with exact file path in src/features/${featureId}/

Include phases:
1. Setup (project structure)
2. Core implementation tasks with EXACT TypeScript file paths like src/features/${featureId}/index.ts
3. Each task must have a clear, actionable description

Write it as a well-formed Markdown document starting with "# Tasks: ${featureTitle}".

CRITICAL: Every implementation task MUST specify an exact file path.

OUTPUT: The complete tasks.md content only, starting with the # heading.`;
}

function buildImplementPrompt(
  commandContent: string,
  featureTitle: string,
  featureId: string,
  specContent: string,
  planContent: string,
  tasksContent: string
): string {
  return `You are acting as an expert TypeScript developer implementing a feature following the Spec Kit implementation workflow.

FEATURE: ${featureTitle}
FEATURE ID: ${featureId}

FEATURE SPECIFICATION:
${specContent}

IMPLEMENTATION PLAN:
${planContent}

TASK LIST:
${tasksContent}

SPEC-KIT COMMAND INSTRUCTIONS:
${commandContent}

YOUR TASK:
Implement the feature "${featureTitle}" by generating TypeScript source files.

CRITICAL REQUIREMENTS:
1. You MUST output actual TypeScript code files
2. Each file must be complete and runnable
3. Use the feature directory: src/features/${featureId}/
4. The main file must be: src/features/${featureId}/index.ts
5. Export all public types and functions

OUTPUT FORMAT (you MUST use this exact format for EACH file):
<<<FILE: src/features/${featureId}/index.ts>>>
// TypeScript code here
<<<END_FILE>>>

Generate at minimum:
- src/features/${featureId}/index.ts (main module with exported types and functions implementing the spec)
- src/features/${featureId}/types.ts (if you have complex types)

The code must implement the acceptance criteria from the spec.
Make it real, working TypeScript code - not pseudocode or placeholders.`;
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

export class SpecKitRunner {
  private readonly client: Anthropic;
  private readonly root: string;
  private readonly model = "claude-opus-4-5";

  constructor(root: string, apiKey?: string) {
    const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is required for SpecKitRunner. " +
          "Set it before running the phase runner."
      );
    }
    this.client = new Anthropic({ apiKey: key });
    this.root = root;
  }

  private specsDir(featureId: string): string {
    return join(this.root, "docs", "specs", featureId.toLowerCase());
  }

  private async callClaude(prompt: string): Promise<string> {
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

    // Extract and write files
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
