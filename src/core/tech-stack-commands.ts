import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { spawnSync } from "child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StackCommand {
  label: string;
  type: "build" | "test" | "lint";
  command: string;
  args: string[];
  cwd: string;
  timeout?: number;
}

// ---------------------------------------------------------------------------
// Markdown section parser
// ---------------------------------------------------------------------------

/**
 * Parse a tech-stack.md into a map of section name → body text.
 * e.g. "Backend" → "- Language / Runtime: C# 12 / .NET 10\n..."
 */
export function parseStackSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = content.split("\n");
  let currentSection: string | null = null;
  const bodyLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      if (currentSection !== null) {
        sections[currentSection] = bodyLines.join("\n").trim();
      }
      currentSection = headingMatch[1].trim();
      bodyLines.length = 0;
    } else if (currentSection !== null) {
      bodyLines.push(line);
    }
  }
  if (currentSection !== null) {
    sections[currentSection] = bodyLines.join("\n").trim();
  }
  return sections;
}

// ---------------------------------------------------------------------------
// File discovery helpers
// ---------------------------------------------------------------------------

const SCAN_EXCLUDE = new Set([
  "node_modules", ".git", "bin", "obj", ".dart_tool", ".flutter-plugins",
  ".pub-cache", "build", "dist", ".next", "__pycache__", "target",
]);

/**
 * Find the first file matching `filename` (string exact match or RegExp)
 * under `root`, depth-first, up to `maxDepth` levels.
 * Returns the absolute path of the containing directory, or null.
 */
export function findConfigDir(
  root: string,
  filename: string | RegExp,
  maxDepth = 4
): string | null {
  function walk(dir: string, depth: number): string | null {
    if (depth > maxDepth) return null;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return null; }

    for (const entry of entries) {
      if (SCAN_EXCLUDE.has(entry)) continue;
      const matches =
        typeof filename === "string" ? entry === filename : filename.test(entry);
      if (matches) return dir;
    }
    for (const entry of entries) {
      if (SCAN_EXCLUDE.has(entry)) continue;
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) {
          const found = walk(full, depth + 1);
          if (found) return found;
        }
      } catch { /* skip */ }
    }
    return null;
  }
  return walk(root, 0);
}

/**
 * Find all directories containing a matching config file (up to maxResults).
 */
export function findAllConfigDirs(
  root: string,
  filename: string | RegExp,
  maxDepth = 4,
  maxResults = 8
): string[] {
  const results: string[] = [];
  function walk(dir: string, depth: number): void {
    if (depth > maxDepth || results.length >= maxResults) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      if (SCAN_EXCLUDE.has(entry)) continue;
      const matches =
        typeof filename === "string" ? entry === filename : filename.test(entry);
      if (matches && !results.includes(dir)) {
        results.push(dir);
      }
    }
    for (const entry of entries) {
      if (SCAN_EXCLUDE.has(entry)) continue;
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) walk(full, depth + 1);
      } catch { /* skip */ }
    }
  }
  walk(root, 0);
  return results;
}

// ---------------------------------------------------------------------------
// Stack detectors
// ---------------------------------------------------------------------------

function detectDotnet(root: string): StackCommand[] {
  // Find *.sln file — prefer the one closest to root
  const slnDir = findConfigDir(root, /\.sln$/, 3);
  if (!slnDir) return [];

  const slnEntries = readdirSync(slnDir).filter((f) => f.endsWith(".sln"));
  const sln = slnEntries[0];
  const cwd = slnDir;

  return [
    {
      label: "dotnet build",
      type: "build",
      command: "dotnet",
      args: ["build", sln, "--no-restore", "-v", "minimal"],
      cwd,
      timeout: 120_000,
    },
    {
      label: "dotnet test",
      type: "test",
      command: "dotnet",
      args: ["test", sln, "--no-build", "--logger", "console;verbosity=minimal"],
      cwd,
      timeout: 180_000,
    },
  ];
}

function detectFlutter(root: string): StackCommand[] {
  const pubspecDir = findConfigDir(root, "pubspec.yaml", 5);
  if (!pubspecDir) return [];
  return [
    {
      label: "flutter test",
      type: "test",
      command: "flutter",
      args: ["test"],
      cwd: pubspecDir,
      timeout: 180_000,
    },
  ];
}

function detectNode(root: string): StackCommand[] {
  const cmds: StackCommand[] = [];
  // Find all package.json dirs (up to depth 5, max 4 results)
  const pkgDirs = findAllConfigDirs(root, "package.json", 5, 4);
  for (const dir of pkgDirs) {
    // Read scripts
    let scripts: Record<string, string> = {};
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8")
      ) as { scripts?: Record<string, string> };
      scripts = pkg.scripts ?? {};
    } catch { /* skip */ }

    const rel = dir === root ? "." : dir.replace(root + "/", "");

    if (scripts["build"]) {
      cmds.push({
        label: `npm run build (${rel})`,
        type: "build",
        command: "npm",
        args: ["run", "build"],
        cwd: dir,
        timeout: 120_000,
      });
    }
    if (scripts["lint"]) {
      cmds.push({
        label: `npm run lint (${rel})`,
        type: "lint",
        command: "npm",
        args: ["run", "lint"],
        cwd: dir,
        timeout: 60_000,
      });
    }
    if (scripts["test"]) {
      cmds.push({
        label: `npm run test (${rel})`,
        type: "test",
        command: "npm",
        args: ["run", "test"],
        cwd: dir,
        timeout: 120_000,
      });
    }
  }
  return cmds;
}

function detectPython(root: string): StackCommand[] {
  const pyDir =
    findConfigDir(root, "pyproject.toml", 4) ??
    findConfigDir(root, "requirements.txt", 4);
  if (!pyDir) return [];
  return [
    {
      label: "pytest",
      type: "test",
      command: "python",
      args: ["-m", "pytest"],
      cwd: pyDir,
      timeout: 120_000,
    },
  ];
}

function detectGo(root: string): StackCommand[] {
  const goDir = findConfigDir(root, "go.mod", 4);
  if (!goDir) return [];
  return [
    {
      label: "go build",
      type: "build",
      command: "go",
      args: ["build", "./..."],
      cwd: goDir,
      timeout: 120_000,
    },
    {
      label: "go test",
      type: "test",
      command: "go",
      args: ["test", "./..."],
      cwd: goDir,
      timeout: 180_000,
    },
  ];
}

function detectJava(root: string): StackCommand[] {
  const mavenDir = findConfigDir(root, "pom.xml", 4);
  if (mavenDir) {
    return [
      {
        label: "mvn test",
        type: "test",
        command: "mvn",
        args: ["test", "-q"],
        cwd: mavenDir,
        timeout: 300_000,
      },
    ];
  }
  const gradleDir =
    findConfigDir(root, "build.gradle", 4) ??
    findConfigDir(root, "build.gradle.kts", 4);
  if (gradleDir) {
    return [
      {
        label: "gradle test",
        type: "test",
        command: "gradle",
        args: ["test"],
        cwd: gradleDir,
        timeout: 300_000,
      },
    ];
  }
  return [];
}

function detectRust(root: string): StackCommand[] {
  const cargoDir = findConfigDir(root, "Cargo.toml", 4);
  if (!cargoDir) return [];
  return [
    {
      label: "cargo build",
      type: "build",
      command: "cargo",
      args: ["build"],
      cwd: cargoDir,
      timeout: 180_000,
    },
    {
      label: "cargo test",
      type: "test",
      command: "cargo",
      args: ["test"],
      cwd: cargoDir,
      timeout: 180_000,
    },
  ];
}

// ---------------------------------------------------------------------------
// Keyword matchers
// ---------------------------------------------------------------------------

function sectionContains(body: string, ...keywords: string[]): boolean {
  const lower = body.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Detect build/test commands from the project root and tech-stack.md content.
 *
 * Strategy:
 * 1. Parse tech-stack.md sections to understand what stacks are in use.
 * 2. For each detected stack, look for config files (*.sln, pubspec.yaml, etc.)
 *    to determine the working directory.
 * 3. Return an ordered list of commands: build first, then test, then lint.
 *
 * Returns an empty array if nothing can be detected (caller falls back to
 * legacy package.json behaviour).
 */
export function detectStackCommands(
  root: string,
  techStackContent: string
): StackCommand[] {
  const sections = parseStackSections(techStackContent);
  const allSectionText = Object.values(sections).join("\n");
  const commands: StackCommand[] = [];

  // C# / .NET
  const backendBody = sections["Backend"] ?? "";
  if (
    sectionContains(backendBody, "C#", ".NET", "ASP.NET", "dotnet") ||
    sectionContains(allSectionText, "C#", ".NET", "ASP.NET")
  ) {
    commands.push(...detectDotnet(root));
  }

  // Flutter / Dart
  const mobileBody = sections["Mobile"] ?? "";
  if (sectionContains(mobileBody, "Flutter", "Dart") ||
      sectionContains(allSectionText, "Flutter", "Dart")) {
    commands.push(...detectFlutter(root));
  }

  // Node.js / React / TypeScript / Vue / Angular
  const frontendBody = sections["Frontend"] ?? "";
  const nodeKeywords = ["React", "Node", "TypeScript", "JavaScript", "Vue", "Angular", "Next.js", "Vite"];
  if (
    sectionContains(frontendBody, ...nodeKeywords) ||
    sectionContains(sections["Backend"] ?? "", "Node", "Express", "Fastify", "NestJS")
  ) {
    commands.push(...detectNode(root));
  }

  // Python
  if (sectionContains(allSectionText, "Python", "FastAPI", "Django", "Flask")) {
    commands.push(...detectPython(root));
  }

  // Go
  if (sectionContains(allSectionText, "Go ", "Golang", "go.mod")) {
    commands.push(...detectGo(root));
  }

  // Java / Spring / Kotlin
  if (sectionContains(allSectionText, "Java", "Spring", "Kotlin", "Maven", "Gradle")) {
    commands.push(...detectJava(root));
  }

  // Rust
  if (sectionContains(allSectionText, "Rust", "Cargo")) {
    commands.push(...detectRust(root));
  }

  // Deduplicate by label
  const seen = new Set<string>();
  return commands.filter((c) => {
    if (seen.has(c.label)) return false;
    seen.add(c.label);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Command runner (used by acceptance-gate.ts)
// ---------------------------------------------------------------------------

export interface StackCommandResult {
  label: string;
  passed: boolean;
  skipped: boolean;
  details: string;
}

/**
 * Run a single StackCommand. Returns a result object.
 * - If the binary is not found, marks as `skipped` (not a failure).
 * - If the command exits non-zero, marks as failed.
 */
export function runStackCommand(cmd: StackCommand): StackCommandResult {
  // Check binary availability — if not found, FAIL (environment not configured)
  const which = spawnSync(
    process.platform === "win32" ? "where" : "which",
    [cmd.command],
    { encoding: "utf8", shell: false }
  );
  if (which.status !== 0) {
    return {
      label: cmd.label,
      passed: false,
      skipped: false,
      details: `ENVIRONMENT NOT CONFIGURED: '${cmd.command}' not found in PATH. Install it to enable QA validation.`,
    };
  }

  if (!existsSync(cmd.cwd)) {
    return {
      label: cmd.label,
      passed: false,
      skipped: false,
      details: `ENVIRONMENT NOT CONFIGURED: working directory not found (${cmd.cwd}). Check project structure.`,
    };
  }

  const result = spawnSync(cmd.command, cmd.args, {
    cwd: cmd.cwd,
    encoding: "utf8",
    shell: false,
    timeout: cmd.timeout ?? 120_000,
  });

  const output = ((result.stdout ?? "") + (result.stderr ?? "")).trim();
  const passed = result.status === 0 && result.error == null;

  return {
    label: cmd.label,
    passed,
    skipped: false,
    details: passed ? `${cmd.label} passed` : output.slice(0, 800) || `${cmd.label} failed (exit ${result.status})`,
  };
}
