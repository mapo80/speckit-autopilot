import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import yaml from "js-yaml";
import { parseBacklog } from "../core/backlog-schema.js";
import { readTechStack } from "../core/spec-kit-runner.js";
import { spawnSync } from "child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImplementationReport {
  featureId: string;
  completedAt: string;
  changedFiles: string[];
  newFileCount: number;
  qaChecks: { name: string; passed: boolean; details: string }[];
  coverage: number | null;
}

interface StructuralGap {
  path: string;
  reason: string;
  critical: boolean;
}

interface FeatureCoverage {
  featureId: string;
  featureTitle: string;
  taskCount: number;
  fileCount: number;
  files: string[];
  hasImplementationReport: boolean;
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

function countTaskLines(tasksPath: string): number {
  if (!existsSync(tasksPath)) return 0;
  const content = readFileSync(tasksPath, "utf8");
  // Count lines that look like tasks: "- [ ]", "- [x]", "* [ ]", numbered items
  return content.split("\n").filter((l) => /^\s*[-*]\s+\[.?\]|\s*\d+\.\s/.test(l)).length;
}

function readImplementationReport(root: string, featureId: string): ImplementationReport | null {
  const p = join(root, "docs", "specs", featureId.toLowerCase(), "implementation-report.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ImplementationReport;
  } catch {
    return null;
  }
}

function scanGeneratedFiles(root: string): string[] {
  // Use git ls-files to get tracked + untracked files, excluding docs/ and node_modules
  const result = spawnSync("git", ["ls-files", "--others", "--cached", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
    timeout: 10000,
  });
  if (result.status !== 0) {
    // Fallback: manual scan of known project dirs
    return scanDirectories(root, ["SignHub.Api", "SignHub.Dal", "SignHub.Domain", "SignHub.Services",
      "SignHub.Tests", "SignHub.ApiTests", "SignHub.IntegrationTests", "SignHub.Mobile", "SignHub.Web"]);
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

function detectStructuralGaps(root: string, techStack: string): StructuralGap[] {
  const gaps: StructuralGap[] = [];
  const hasDotNet = /\.NET|C#|csharp/i.test(techStack);
  const hasFlutter = /Flutter|Dart/i.test(techStack);
  const hasReact = /React|Next\.js|Vite/i.test(techStack);
  const hasDocker = /Docker|docker-compose/i.test(techStack);

  if (hasDotNet) {
    // Look for project directories and check for .csproj
    const projectDirs = ["SignHub.Api", "SignHub.Dal", "SignHub.Domain", "SignHub.Services",
      "SignHub.Tests", "SignHub.ApiTests", "SignHub.IntegrationTests", "SignHub.CieSign"];
    for (const dir of projectDirs) {
      if (existsSync(join(root, dir))) {
        const csproj = join(root, dir, `${dir}.csproj`);
        if (!existsSync(csproj)) {
          gaps.push({ path: `${dir}/${dir}.csproj`, reason: "Required for .NET build", critical: true });
        }
      }
    }
    // .sln
    const hasSln = readdirSync(root).some((f) => f.endsWith(".sln"));
    if (!hasSln) {
      gaps.push({ path: "*.sln", reason: "Solution file required for .NET build", critical: true });
    }
  }

  if (hasFlutter) {
    // Check common mobile dirs
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

  // Common: README
  if (!existsSync(join(root, "README.md"))) {
    gaps.push({ path: "README.md", reason: "Project README missing", critical: false });
  }

  return gaps;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function coverageReport(root: string): void {
  const backlog = readBacklogRaw(root);
  const techStack = readTechStack(root);
  const allFiles = scanGeneratedFiles(root);

  const doneFeatures = backlog.features.filter((f) => f.status === "done");
  const structuralGaps = detectStructuralGaps(root, techStack);

  const featureCoverages: FeatureCoverage[] = doneFeatures.map((f) => {
    const report = readImplementationReport(root, f.id);
    const tasksPath = join(root, "docs", "specs", f.id.toLowerCase(), "tasks.md");
    const taskCount = countTaskLines(tasksPath);

    let files: string[];
    if (report) {
      files = report.changedFiles;
    } else {
      // Heuristic: files that contain the feature ID substring (case-insensitive) in path
      // This is a rough fallback — not accurate but better than nothing
      files = allFiles.filter(() => false); // conservative: 0 files if no report
    }

    return {
      featureId: f.id,
      featureTitle: f.title,
      taskCount,
      fileCount: files.length,
      files,
      hasImplementationReport: report !== null,
    };
  });

  // Build report markdown
  const now = new Date().toISOString().split("T")[0];
  const criticalGaps = structuralGaps.filter((g) => g.critical);
  const warnGaps = structuralGaps.filter((g) => !g.critical);

  const lines: string[] = [];
  lines.push(`# Coverage Report – ${now}`);
  lines.push("");
  lines.push(`Generated by speckit-autopilot. Features: **${doneFeatures.length}/${backlog.features.length} done**.`);
  lines.push(`Total source files detected: **${allFiles.length}**.`);
  lines.push("");

  // Structural gaps
  if (criticalGaps.length > 0) {
    lines.push("## Structural Gaps — Critical (Build Blocking)");
    lines.push("");
    for (const g of criticalGaps) {
      lines.push(`- [ ] \`${g.path}\` — ${g.reason}`);
    }
    lines.push("");
  } else {
    lines.push("## Structural Gaps — Critical");
    lines.push("");
    lines.push("✓ No critical structural gaps detected.");
    lines.push("");
  }

  if (warnGaps.length > 0) {
    lines.push("## Structural Gaps — Warnings");
    lines.push("");
    for (const g of warnGaps) {
      lines.push(`- [ ] \`${g.path}\` — ${g.reason}`);
    }
    lines.push("");
  }

  // Summary table
  lines.push("## Feature Coverage Summary");
  lines.push("");
  lines.push("| Feature | Title | Tasks | Files | Report |");
  lines.push("|---------|-------|-------|-------|--------|");
  for (const fc of featureCoverages) {
    const reportFlag = fc.hasImplementationReport ? "✓" : "⚠ missing";
    lines.push(`| ${fc.featureId} | ${fc.featureTitle.slice(0, 50)} | ${fc.taskCount} | ${fc.fileCount} | ${reportFlag} |`);
  }
  lines.push("");

  // Per-feature detail
  lines.push("## Feature Detail");
  lines.push("");
  for (const fc of featureCoverages) {
    lines.push(`### ${fc.featureId} – ${fc.featureTitle}`);
    lines.push(`Tasks planned: ${fc.taskCount} | Files generated: ${fc.fileCount}`);
    if (!fc.hasImplementationReport) {
      lines.push("> ⚠ No implementation-report.json found — file list unavailable (feature shipped before logging was added).");
    }
    if (fc.files.length > 0) {
      lines.push("");
      lines.push("Files generated:");
      for (const f of fc.files) {
        lines.push(`- \`${f}\``);
      }
    }
    lines.push("");
  }

  // All source files
  lines.push("## All Source Files");
  lines.push("");
  lines.push(`Total: ${allFiles.length} files`);
  lines.push("");
  const byExt: Record<string, string[]> = {};
  for (const f of allFiles) {
    const ext = f.split(".").pop() ?? "other";
    (byExt[ext] ??= []).push(f);
  }
  for (const [ext, files] of Object.entries(byExt).sort()) {
    lines.push(`### .${ext} (${files.length})`);
    lines.push("");
    for (const f of files.slice(0, 50)) {
      lines.push(`- \`${f}\``);
    }
    if (files.length > 50) lines.push(`- ... and ${files.length - 50} more`);
    lines.push("");
  }

  const reportPath = join(root, "docs", "coverage-report.md");
  writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log(`[coverage-report] Written to ${reportPath}`);
  console.log(`[coverage-report] ${criticalGaps.length} critical gaps, ${warnGaps.length} warnings, ${doneFeatures.length} features covered.`);
}
