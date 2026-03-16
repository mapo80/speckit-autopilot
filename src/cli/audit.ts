import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import yaml from "js-yaml";
import { spawn, spawnSync } from "child_process";
import { parseBacklog } from "../core/backlog-schema.js";
import { readTechStack } from "../core/spec-kit-runner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditGenerateResult {
  valid: boolean;
  featureCount: number;
  warnings: string[];
}

export interface AuditBootstrapResult {
  valid: boolean;
  featureCount: number;
  warnings: string[];
}

export interface AuditFeatureResult {
  featureId: string;
  featureTitle: string;
  auditPath: string;
  skipped: boolean;
  error?: string;
}

export interface StructuralGap {
  path: string;
  reason: string;
  critical: boolean;
}

// ---------------------------------------------------------------------------
// callClaudeForReview — single Claude call via CLI
// ---------------------------------------------------------------------------

export function callClaudeForReview(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", ["--print", "--dangerously-skip-permissions"], {
      shell: false,
      env: { ...process.env },
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

// callClaudeForText — Claude call that disables all tools so output is pure text.
// Use when you need Claude to print content (not write files).
// ---------------------------------------------------------------------------

export function callClaudeForText(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // No --dangerously-skip-permissions: tool writes are blocked so Claude is
    // forced to output text directly to stdout.
    const proc = spawn("claude", ["--print"], {
      shell: false,
      env: { ...process.env },
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
// scanGeneratedFiles — list all non-docs source files via git or fallback
// ---------------------------------------------------------------------------

export function scanGeneratedFiles(root: string): string[] {
  const result = spawnSync("git", ["ls-files", "--others", "--cached", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
    timeout: 10000,
  });
  if (result.status !== 0) {
    return scanDirectories(root, ["src", "lib", "app"]);
  }
  return (result.stdout ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("docs/") && !l.startsWith("node_modules/") && !l.startsWith("."));
}

function scanDirectories(root: string, dirs: string[]): string[] {
  const files: string[] = [];
  for (const dir of dirs) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    collectFiles(abs, root, files);
  }
  return files;
}

function collectFiles(dir: string, root: string, acc: string[]): void {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      collectFiles(abs, root, acc);
    } else {
      acc.push(relative(root, abs));
    }
  }
}

// ---------------------------------------------------------------------------
// detectStructuralGaps — check for missing build-critical files
// ---------------------------------------------------------------------------

export function detectStructuralGaps(root: string, techStack: string): StructuralGap[] {
  const gaps: StructuralGap[] = [];
  const hasDotNet = /\.NET|C#|csharp/i.test(techStack);
  const hasFlutter = /Flutter|Dart/i.test(techStack);
  const hasReact = /React|Next\.js|Vite/i.test(techStack);
  const hasDocker = /Docker|docker-compose/i.test(techStack);

  if (hasDotNet) {
    const projectDirs = ["SignHub.Api", "SignHub.Dal", "SignHub.Domain", "SignHub.Services",
      "SignHub.Tests", "SignHub.ApiTests", "SignHub.IntegrationTests", "SignHub.CieSign"];
    for (const dir of projectDirs) {
      if (existsSync(join(root, dir))) {
        if (!existsSync(join(root, dir, `${dir}.csproj`))) {
          gaps.push({ path: `${dir}/${dir}.csproj`, reason: "Required for .NET build", critical: true });
        }
      }
    }
    if (!readdirSync(root).some((f) => f.endsWith(".sln"))) {
      gaps.push({ path: "*.sln", reason: "Solution file required for .NET build", critical: true });
    }
  }

  if (hasFlutter) {
    const mobileDirs = ["SignHub.Mobile", "mobile", "flutter"];
    const mobileDir = mobileDirs.find((d) => existsSync(join(root, d)));
    if (mobileDir) {
      if (!existsSync(join(root, mobileDir, "pubspec.yaml"))) {
        gaps.push({ path: `${mobileDir}/pubspec.yaml`, reason: "Required for Flutter build", critical: true });
      }
      if (!existsSync(join(root, mobileDir, "lib", "main.dart"))) {
        gaps.push({ path: `${mobileDir}/lib/main.dart`, reason: "Flutter app entry point", critical: true });
      }
    }
  }

  if (hasReact) {
    const webDirs = ["SignHub.Web", "frontend", "web"];
    const webDir = webDirs.find((d) => existsSync(join(root, d)));
    if (webDir) {
      if (!existsSync(join(root, webDir, "package.json"))) {
        gaps.push({ path: `${webDir}/package.json`, reason: "Required for React/Vite build", critical: true });
      }
      if (!existsSync(join(root, webDir, "vite.config.ts")) && !existsSync(join(root, webDir, "vite.config.js"))) {
        gaps.push({ path: `${webDir}/vite.config.ts`, reason: "Vite configuration missing", critical: false });
      }
    }
  }

  if (hasDocker) {
    if (!existsSync(join(root, "docker-compose.yml")) && !existsSync(join(root, "docker-compose.yaml"))) {
      gaps.push({ path: "docker-compose.yml", reason: "Docker Compose definition missing", critical: false });
    }
  }

  if (!existsSync(join(root, "README.md"))) {
    gaps.push({ path: "README.md", reason: "Project README missing", critical: false });
  }

  return gaps;
}

// ---------------------------------------------------------------------------
// checkStructuralCompliance — pure static check, no Claude needed
// ---------------------------------------------------------------------------

export interface StructuralComplianceResult {
  violations: string[];
  warnings: string[];
}

/**
 * Parse the first-level allowed directories from project-structure.md.
 * Looks for lines like `src/SignHub.Api/...` or `src/` and extracts the root segment.
 */
function extractAllowedRoots(structureMd: string): string[] {
  const roots = new Set<string>();
  // Bullet lines that start with a path: `- src/...` or `src/...` inside code blocks
  const pathRe = /^\s*[-*]?\s+([a-zA-Z][a-zA-Z0-9_.-]*\/)/gm;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(structureMd)) !== null) {
    roots.add(m[1]);
  }
  // Fallback defaults if nothing parsed
  if (roots.size === 0) {
    for (const r of ["src/", "tests/", "frontend/", "mobile/"]) roots.add(r);
  }
  return [...roots];
}

/**
 * Parse NEVER rules from the MANDATORY section of project-structure.md.
 * Returns patterns like "src/Api/" that files must NOT start with.
 */
function extractNeverPatterns(structureMd: string): string[] {
  const patterns: string[] = [];
  const mandatorySection = structureMd.split(/##\s+RULES/i)[1] ?? "";
  // Lines with NEVER: extract path tokens
  const neverRe = /NEVER\s+create\s+([^\s,]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = neverRe.exec(mandatorySection)) !== null) {
    patterns.push(m[1].replace(/[`'"]/g, ""));
  }
  return patterns;
}

export function checkStructuralCompliance(
  generatedFiles: string[],
  projectStructureMd: string | null
): StructuralComplianceResult {
  if (!projectStructureMd || generatedFiles.length === 0) {
    return { violations: [], warnings: [] };
  }

  const allowedRoots = extractAllowedRoots(projectStructureMd);
  const neverPatterns = extractNeverPatterns(projectStructureMd);
  const violations: string[] = [];
  const warnings: string[] = [];

  for (const file of generatedFiles) {
    // Check against NEVER patterns first
    for (const pattern of neverPatterns) {
      if (file.startsWith(pattern) || file.includes(`/${pattern}`)) {
        violations.push(`\`${file}\` — matches NEVER rule: "${pattern}"`);
      }
    }
    // Check that file starts with one of the allowed root dirs
    const allowed = allowedRoots.some((r) => file.startsWith(r));
    if (!allowed) {
      // Distinguish docs/specs (expected) vs truly rogue paths
      if (!file.startsWith("docs/") && !file.startsWith(".")) {
        warnings.push(`\`${file}\` — not under a canonical root (${allowedRoots.slice(0, 4).join(", ")}...)`);
      }
    }
  }

  return { violations, warnings };
}

function renderComplianceSection(result: StructuralComplianceResult, fileCount: number): string {
  const lines: string[] = [`### 🏗 Structural Compliance`, ``];
  if (result.violations.length === 0 && result.warnings.length === 0) {
    lines.push(`✅ All ${fileCount} file(s) respect the canonical structure.`);
  } else {
    if (result.violations.length > 0) {
      lines.push(`❌ ${result.violations.length} VIOLATION(S) (must fix before merge):`);
      for (const v of result.violations) lines.push(`- ${v}`);
      lines.push(``);
    }
    if (result.warnings.length > 0) {
      lines.push(`⚠ ${result.warnings.length} WARNING(S):`);
      for (const w of result.warnings) lines.push(`- ${w}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// auditGenerate — static check of docs/product.md
// ---------------------------------------------------------------------------

export function auditGenerate(root: string): AuditGenerateResult {
  const productPath = join(root, "docs", "product.md");
  const warnings: string[] = [];

  if (!existsSync(productPath)) {
    return { valid: false, featureCount: 0, warnings: ["docs/product.md not found"] };
  }

  const content = readFileSync(productPath, "utf8");
  const featureMatches = content.match(/^### Feature \d+/gm) ?? [];
  const featureCount = featureMatches.length;

  if (featureCount === 0) {
    warnings.push("No features extracted (no '### Feature N' headings found)");
  } else if (featureCount < 5) {
    warnings.push(`Only ${featureCount} features extracted — possible incomplete extraction`);
  }

  if (!content.includes("## Delivery Preference")) {
    warnings.push("Missing '## Delivery Preference' section");
  }

  // Check each feature has at least one acceptance criterion
  const sections = content.split(/^### Feature \d+/m);
  let missingCriteria = 0;
  for (const section of sections.slice(1)) {
    const firstHeading = section.indexOf("\n###");
    const body = firstHeading >= 0 ? section.slice(0, firstHeading) : section;
    if (!body.match(/^\s*-\s+/m)) missingCriteria++;
  }
  if (missingCriteria > 0) {
    warnings.push(`${missingCriteria} feature(s) missing acceptance criteria`);
  }

  // Check A — ## Vision section present
  if (!content.includes("## Vision")) {
    warnings.push("Missing '## Vision' section");
  }

  // Check B — Feature heading format: ### Feature N - EpicName: Feature Title
  const headingFormatRe = /^### Feature \d+ - .+:.+/gm;
  const validHeadings = (content.match(headingFormatRe) ?? []).length;
  if (featureCount > 0 && validHeadings < featureCount) {
    const bad = featureCount - validHeadings;
    warnings.push(
      `${bad} feature heading(s) missing 'Epic: Title' format — use: ### Feature N - EpicName: Feature Title`
    );
  }

  // Check C — Every feature listed in Delivery Preference (by exact heading text)
  if (content.includes("## Delivery Preference")) {
    const deliverySection = content.split(/^## Delivery Preference/m)[1] ?? "";
    const featureTitles = [...content.matchAll(/^### (Feature \d+ - .+)/gm)].map((m) => m[1].trim());
    const notListed = featureTitles.filter((t) => !deliverySection.includes(t));
    if (notListed.length > 0) {
      warnings.push(
        `${notListed.length} feature(s) not listed in Delivery Preference: ${notListed.slice(0, 3).join("; ")}`
      );
    }
  }

  // Check D — ## Out of Scope section present (soft warning)
  if (!content.includes("## Out of Scope")) {
    warnings.push("Missing '## Out of Scope' section");
  }

  // Check E — ## Tech Stack section present
  if (!content.includes("## Tech Stack")) {
    warnings.push("Missing '## Tech Stack' section");
  }

  return { valid: featureCount > 0, featureCount, warnings };
}

// ---------------------------------------------------------------------------
// auditBootstrap — static check of backlog consistency
// ---------------------------------------------------------------------------

export function auditBootstrap(root: string): AuditBootstrapResult {
  const backlogPath = join(root, "docs", "product-backlog.yaml");
  const statePath = join(root, "docs", "autopilot-state.json");
  const warnings: string[] = [];

  if (!existsSync(backlogPath)) {
    return { valid: false, featureCount: 0, warnings: ["docs/product-backlog.yaml not found"] };
  }

  let featureCount = 0;
  try {
    const raw = yaml.load(readFileSync(backlogPath, "utf8")) as unknown;
    const backlog = parseBacklog(raw);
    featureCount = backlog.features.length;

    const emptyAc = backlog.features.filter((f) => f.acceptanceCriteria.length === 0);
    if (emptyAc.length > 0) {
      warnings.push(`${emptyAc.length} feature(s) with empty acceptanceCriteria: ${emptyAc.map((f) => f.id).join(", ")}`);
    }

    const productPath = join(root, "docs", "product.md");
    if (existsSync(productPath)) {
      const productContent = readFileSync(productPath, "utf8");
      const productFeatureCount = (productContent.match(/^### Feature \d+/gm) ?? []).length;
      if (productFeatureCount > 0 && featureCount !== productFeatureCount) {
        warnings.push(`Feature count mismatch: product.md has ${productFeatureCount}, backlog has ${featureCount}`);
      }
    }
  } catch (err) {
    return { valid: false, featureCount: 0, warnings: [`Failed to parse backlog: ${err instanceof Error ? err.message : String(err)}`] };
  }

  if (!existsSync(statePath)) {
    warnings.push("docs/autopilot-state.json not found");
  }

  return { valid: true, featureCount, warnings };
}

// ---------------------------------------------------------------------------
// auditFeature — AI review: spec.md + tasks.md → implementation
// ---------------------------------------------------------------------------

export async function auditFeature(
  root: string,
  featureId: string,
  featureTitle: string,
  callClaude: (prompt: string) => Promise<string> = callClaudeForReview
): Promise<AuditFeatureResult> {
  const specsDir = join(root, "docs", "specs", featureId.toLowerCase());
  const auditPath = join(specsDir, "audit.md");

  const specContent = readFileIfExists(join(specsDir, "spec.md"));
  const tasksContent = readFileIfExists(join(specsDir, "tasks.md"));
  const techStack = readTechStack(root);

  const implReportPath = join(specsDir, "implementation-report.json");
  let fileList = "No implementation-report.json found — file list unavailable.";
  let fileCount = 0;
  let generatedFiles: string[] = [];
  if (existsSync(implReportPath)) {
    try {
      const report = JSON.parse(readFileSync(implReportPath, "utf8")) as { changedFiles: string[]; newFileCount: number };
      fileCount = report.newFileCount;
      generatedFiles = report.changedFiles;
      fileList = report.changedFiles.length > 0
        ? report.changedFiles.join("\n")
        : "No files recorded in report.";
    } catch {
      fileList = "Failed to parse implementation-report.json.";
    }
  }

  // Static structural compliance check (no Claude, always fast)
  const projectStructureMd = existsSync(join(root, "docs", "project-structure.md"))
    ? readFileSync(join(root, "docs", "project-structure.md"), "utf8")
    : null;
  const compliance = checkStructuralCompliance(generatedFiles, projectStructureMd);
  const complianceSection = renderComplianceSection(compliance, fileCount);

  if (!specContent && !tasksContent) {
    const note = `# Audit – ${featureId}\n\n> Skipped: no spec.md or tasks.md found.\n`;
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(auditPath, note, "utf8");
    return { featureId, featureTitle, auditPath, skipped: true };
  }

  const hasViolations = compliance.violations.length > 0;

  const prompt = [
    `You are auditing feature ${featureId} – "${featureTitle}".`,
    ``,
    `## Spec (what was promised):`,
    specContent || "_spec.md not found — using tasks as fallback_",
    ``,
    `## Tasks (what was planned):`,
    tasksContent || "_tasks.md not found_",
    ``,
    `## Files generated (${fileCount}):`,
    fileList,
    ``,
    `## Structural compliance (static check):`,
    complianceSection,
    ``,
    `## Tech stack:`,
    techStack,
    ``,
    `Audit task:`,
    `1. For each acceptance criterion in the spec, is there a corresponding file or code path?`,
    `2. What critical pieces are missing (missing endpoints, services, tests, config files)?`,
    hasViolations ? `3. The structural compliance check found violations — flag them in Recommendations.` : "",
    `3. Overall completeness score: 1-5`,
    ``,
    `Format your response as markdown with these sections:`,
    `### ✓ Complete`,
    `### ⚠ Gaps`,
    `### 🔧 Recommendations`,
    `### Score: X/5`,
  ].filter((l) => l !== "").join("\n");

  try {
    const review = await callClaude(prompt);
    const output = [
      `# Audit – ${featureId} – ${featureTitle}`,
      ``,
      `Generated: ${new Date().toISOString()}`,
      `Files reviewed: ${fileCount}`,
      ``,
      complianceSection,
      ``,
      review,
    ].join("\n");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(auditPath, output, "utf8");
    return { featureId, featureTitle, auditPath, skipped: false };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const output = `# Audit – ${featureId} – ${featureTitle}\n\n> ⚠ Audit failed: ${errMsg}\n`;
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(auditPath, output, "utf8");
    return { featureId, featureTitle, auditPath, skipped: false, error: errMsg };
  }
}

// ---------------------------------------------------------------------------
// auditAll — standalone orchestrator for the `audit` command
// ---------------------------------------------------------------------------

export async function auditAll(root: string): Promise<void> {
  const reportPath = join(root, "docs", "audit-report.md");
  mkdirSync(join(root, "docs"), { recursive: true });
  const now = new Date().toISOString().split("T")[0];
  const lines: string[] = [
    `# Audit Report – ${now}`,
    ``,
    `Generated by speckit-autopilot audit.`,
    ``,
  ];

  // ── Generate audit ────────────────────────────────────────────────────
  lines.push(`## 1. Generate Audit`);
  lines.push(``);
  const genResult = auditGenerate(root);
  lines.push(`- Features extracted: **${genResult.featureCount}**`);
  lines.push(`- Status: ${genResult.valid ? "✓ valid" : "✗ invalid"}`);
  if (genResult.warnings.length > 0) {
    for (const w of genResult.warnings) lines.push(`- ⚠ ${w}`);
  } else {
    lines.push(`- ✓ No warnings`);
  }
  lines.push(``);
  writeFileSync(reportPath, lines.join("\n"), "utf8");

  // ── Bootstrap audit ──────────────────────────────────────────────────
  lines.push(`## 2. Bootstrap Audit`);
  lines.push(``);
  const bootResult = auditBootstrap(root);
  lines.push(`- Features in backlog: **${bootResult.featureCount}**`);
  lines.push(`- Status: ${bootResult.valid ? "✓ valid" : "✗ invalid"}`);
  if (bootResult.warnings.length > 0) {
    for (const w of bootResult.warnings) lines.push(`- ⚠ ${w}`);
  } else {
    lines.push(`- ✓ No warnings`);
  }
  lines.push(``);
  writeFileSync(reportPath, lines.join("\n"), "utf8");

  // ── Structural gaps ──────────────────────────────────────────────────
  const techStack = readTechStack(root);
  const structuralGaps = detectStructuralGaps(root, techStack);
  const critical = structuralGaps.filter((g) => g.critical);
  const warnings = structuralGaps.filter((g) => !g.critical);

  lines.push(`## 3. Structural Gaps`);
  lines.push(``);
  if (critical.length > 0) {
    lines.push(`### Critical (Build Blocking)`);
    for (const g of critical) lines.push(`- [ ] \`${g.path}\` — ${g.reason}`);
    lines.push(``);
  }
  if (warnings.length > 0) {
    lines.push(`### Warnings`);
    for (const g of warnings) lines.push(`- [ ] \`${g.path}\` — ${g.reason}`);
    lines.push(``);
  }
  if (critical.length === 0 && warnings.length === 0) {
    lines.push(`✓ No structural gaps detected.`);
    lines.push(``);
  }
  writeFileSync(reportPath, lines.join("\n"), "utf8");

  // ── Feature audits ───────────────────────────────────────────────────
  const backlogPath = join(root, "docs", "product-backlog.yaml");
  if (!existsSync(backlogPath)) {
    lines.push(`## 4. Feature Audits`);
    lines.push(``);
    lines.push(`> No backlog found — skipping feature audits.`);
    writeFileSync(reportPath, lines.join("\n"), "utf8");
    return;
  }

  const raw = yaml.load(readFileSync(backlogPath, "utf8")) as unknown;
  const backlog = parseBacklog(raw);
  const doneFeatures = backlog.features.filter((f) => f.status === "done");

  lines.push(`## 4. Feature Audits (${doneFeatures.length} features)`);
  lines.push(``);
  lines.push(`| Feature | Title | Score | Gaps |`);
  lines.push(`|---------|-------|-------|------|`);

  for (const feature of doneFeatures) {
    console.log(`[audit] Reviewing ${feature.id} – "${feature.title}"...`);
    const result = await auditFeature(root, feature.id, feature.title);

    // Check if the audit.md contains structural violations
    const auditContent = existsSync(result.auditPath) ? readFileSync(result.auditPath, "utf8") : "";
    const hasViolation = auditContent.includes("❌");
    const score = result.skipped ? "—" : result.error ? "✗ error" : hasViolation ? "❌ violations" : "→ see audit.md";
    lines.push(`| ${feature.id} | ${feature.title.slice(0, 50)} | ${score} | [audit.md](specs/${feature.id.toLowerCase()}/audit.md) |`);

    writeFileSync(reportPath, lines.join("\n"), "utf8");
    console.log(`[audit] ${feature.id} done.`);
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(`Total source files: ${scanGeneratedFiles(root).length}`);
  writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log(`[audit] Report written to ${reportPath}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFileIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
