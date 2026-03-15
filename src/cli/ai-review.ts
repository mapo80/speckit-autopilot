import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import Anthropic from "@anthropic-ai/sdk";
import { parseBacklog } from "../core/backlog-schema.js";
import { readTechStack } from "../core/spec-kit-runner.js";
import { spawn } from "child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeatureGroup {
  label: string;
  features: { id: string; title: string }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBacklogRaw(root: string): ReturnType<typeof parseBacklog> {
  const path = join(root, "docs", "product-backlog.yaml");
  if (!existsSync(path)) throw new Error("product-backlog.yaml not found");
  const raw = yaml.load(readFileSync(path, "utf8")) as unknown;
  return parseBacklog(raw);
}

function readFileIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function readImplReport(root: string, featureId: string): string {
  const p = join(root, "docs", "specs", featureId.toLowerCase(), "implementation-report.json");
  if (!existsSync(p)) return "";
  try {
    const r = JSON.parse(readFileSync(p, "utf8")) as { changedFiles: string[]; newFileCount: number };
    return `Files generated (${r.newFileCount}): ${r.changedFiles.slice(0, 30).join(", ")}${r.changedFiles.length > 30 ? ", ..." : ""}`;
  } catch {
    return "";
  }
}

function groupFeaturesByDomain(features: { id: string; title: string; status: string }[]): FeatureGroup[] {
  const done = features.filter((f) => f.status === "done");

  // Heuristic grouping by title keywords
  const backend = done.filter((f) =>
    /Backend|API|Authentication|Signing Room|Template|Signature|CIE|Attachment|Webhook|Notification|Audit|Document Assembler|Infrastructure/i.test(f.title)
  );
  const adminWeb = done.filter((f) => /Admin Portal|Web App|End User/i.test(f.title));
  const mobile = done.filter((f) => /Mobile|Flutter/i.test(f.title));
  const other = done.filter((f) => !backend.includes(f) && !adminWeb.includes(f) && !mobile.includes(f));

  const groups: FeatureGroup[] = [];
  if (backend.length > 0) groups.push({ label: "Backend API (.NET/C#)", features: backend });
  if (adminWeb.length > 0) groups.push({ label: "Web Frontend (React/TypeScript)", features: adminWeb });
  if (mobile.length > 0) groups.push({ label: "Mobile App (Flutter/Dart)", features: mobile });
  if (other.length > 0) groups.push({ label: "Other", features: other });

  return groups;
}

async function callClaudeForReview(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (apiKey) {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content.find((c) => c.type === "text");
    if (!text || text.type !== "text") throw new Error("No text response from Claude");
    return text.text;
  }

  // CLI fallback
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    const proc = spawn("claude", ["--print", "--dangerously-skip-permissions"], {
      shell: false,
      env,
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c: Buffer) => { stdout += c.toString(); });
    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
    const timer = setTimeout(() => { proc.kill(); reject(new Error("claude CLI timed out")); }, 600_000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 || stdout.trim()) resolve(stdout.trim());
      else reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 300)}`));
    });
    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function aiReview(root: string, specFilePath: string): Promise<void> {
  if (!existsSync(specFilePath)) {
    console.error(`[ai-review] Spec file not found: ${specFilePath}`);
    process.exit(1);
  }

  const backlog = readBacklogRaw(root);
  const techStack = readTechStack(root);
  const specContent = readFileSync(specFilePath, "utf8");

  // Truncate spec to ~3000 lines to stay within token budget per prompt
  const specLines = specContent.split("\n");
  const specTruncated = specLines.slice(0, 3000).join("\n");
  const specNote = specLines.length > 3000
    ? `\n[Note: spec truncated to 3000/${specLines.length} lines]`
    : "";

  const groups = groupFeaturesByDomain(
    backlog.features.map((f) => ({ id: f.id, title: f.title, status: f.status }))
  );

  const now = new Date().toISOString().split("T")[0];
  const outputLines: string[] = [
    `# AI Review Report – ${now}`,
    "",
    `Spec: \`${specFilePath.split("/").pop()}\` (${specLines.length} lines)`,
    `Tech stack: ${techStack.split("\n")[0]}`,
    `Features reviewed: ${backlog.features.filter((f) => f.status === "done").length}/${backlog.features.length}`,
    "",
  ];

  const reportPath = join(root, "docs", "ai-review-report.md");

  for (const group of groups) {
    console.log(`[ai-review] Reviewing group: ${group.label} (${group.features.length} features)...`);

    // Build feature summaries
    const featureSections = group.features.map((f) => {
      const tasksPath = join(root, "docs", "specs", f.id.toLowerCase(), "tasks.md");
      const tasks = readFileIfExists(tasksPath).slice(0, 2000); // cap per feature
      const implSummary = readImplReport(root, f.id);
      return [
        `### ${f.id} – ${f.title}`,
        tasks ? `**Tasks (tasks.md excerpt):**\n${tasks}` : "_tasks.md not found_",
        implSummary ? `**Implementation:**\n${implSummary}` : "_No implementation-report.json found_",
      ].join("\n\n");
    }).join("\n\n---\n\n");

    const prompt = [
      `You are reviewing a software project generated by an AI code generation tool.`,
      ``,
      `## Project Tech Stack`,
      techStack,
      ``,
      `## Product Specification (excerpt)`,
      specTruncated + specNote,
      ``,
      `## Features Being Reviewed: ${group.label}`,
      ``,
      featureSections,
      ``,
      `## Review Task`,
      `For each feature listed above, analyze:`,
      `1. **Completeness**: Are the generated files sufficient to implement all tasks listed in tasks.md?`,
      `2. **Critical gaps**: What is missing that would prevent the feature from working (missing files, missing classes, missing endpoints, missing config)?`,
      `3. **Quality concerns**: Any obvious architectural or correctness issues visible from the task list and file names?`,
      ``,
      `Format your response as markdown with one section per feature (## F-xxx – Title) containing:`,
      `- ✓ What appears complete`,
      `- ⚠ Gaps and missing pieces`,
      `- 🔧 Recommended next steps`,
      ``,
      `Be specific and actionable. Focus on critical gaps, not style nitpicks.`,
    ].join("\n");

    try {
      const review = await callClaudeForReview(prompt);
      outputLines.push(`## ${group.label}`);
      outputLines.push("");
      outputLines.push(review);
      outputLines.push("");

      // Write incrementally so partial results are saved
      writeFileSync(reportPath, outputLines.join("\n"), "utf8");
      console.log(`[ai-review] Group "${group.label}" done. Saved incrementally.`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      outputLines.push(`## ${group.label}`);
      outputLines.push(`> ⚠ Review failed: ${errMsg}`);
      outputLines.push("");
      writeFileSync(reportPath, outputLines.join("\n"), "utf8");
      console.error(`[ai-review] Group "${group.label}" failed: ${errMsg}`);
    }
  }

  writeFileSync(reportPath, outputLines.join("\n"), "utf8");
  console.log(`[ai-review] Complete. Report written to ${reportPath}`);
}
