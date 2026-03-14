import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "fs";
import { join, extname, dirname } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TechStack {
  language: string[];
  frameworks: string[];
  buildTools: string[];
  runtime: string;
}

export interface BrownfieldSnapshot {
  generatedAt: string;
  featureTitle: string;
  techStack: TechStack;
  projectStructure: string[];
  entryPoints: Array<{ file: string; purpose: string }>;
  testFramework: { name: string; location: string; coverageTool: string } | null;
  conventions: string[];
  integrationPoints: Array<{ module: string; interaction: string }>;
  risks: string[];
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

function fileExists(root: string, ...parts: string[]): boolean {
  return existsSync(join(root, ...parts));
}

function readJson(root: string, ...parts: string[]): Record<string, unknown> | null {
  const p = join(root, ...parts);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function detectLanguages(root: string): string[] {
  const langs: string[] = [];
  const exts: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript (TSX)",
    ".js": "JavaScript",
    ".mjs": "JavaScript (ESM)",
    ".py": "Python",
    ".go": "Go",
    ".rs": "Rust",
    ".java": "Java",
    ".rb": "Ruby",
  };
  const found = new Set<string>();

  function walk(dir: string, depth: number): void {
    if (depth > 3) return;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (entry.startsWith(".") || entry === "node_modules" || entry === "dist") continue;
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full, depth + 1);
        } else {
          const ext = extname(entry);
          if (exts[ext]) found.add(exts[ext]);
        }
      }
    } catch {
      // ignore permission errors
    }
  }

  walk(root, 0);
  langs.push(...found);
  return langs;
}

function detectFrameworks(pkg: Record<string, unknown> | null): string[] {
  if (!pkg) return [];
  const deps = {
    ...((pkg.dependencies as Record<string, unknown>) ?? {}),
    ...((pkg.devDependencies as Record<string, unknown>) ?? {}),
  };
  const known: Record<string, string> = {
    react: "React",
    vue: "Vue",
    angular: "@angular/core",
    svelte: "Svelte",
    express: "Express",
    fastify: "Fastify",
    next: "Next.js",
    nuxt: "Nuxt",
    nestjs: "@nestjs/core",
    vite: "Vite",
  };
  return Object.entries(known)
    .filter(([key, pkg]) => key in deps || pkg in deps)
    .map(([, name]) => name);
}

function detectTestFramework(
  pkg: Record<string, unknown> | null,
  root: string
): { name: string; location: string; coverageTool: string } | null {
  if (!pkg) return null;
  const deps = {
    ...((pkg.dependencies as Record<string, unknown>) ?? {}),
    ...((pkg.devDependencies as Record<string, unknown>) ?? {}),
  };

  if ("jest" in deps || "ts-jest" in deps) {
    return { name: "Jest", location: "__tests__/ or *.test.ts", coverageTool: "jest --coverage" };
  }
  if ("vitest" in deps) {
    return { name: "Vitest", location: "*.test.ts", coverageTool: "vitest --coverage" };
  }
  if ("mocha" in deps) {
    return { name: "Mocha", location: "test/", coverageTool: "nyc" };
  }
  if (fileExists(root, "pytest.ini") || fileExists(root, "setup.cfg")) {
    return { name: "pytest", location: "tests/", coverageTool: "pytest --cov" };
  }
  return null;
}

function detectEntryPoints(root: string, pkg: Record<string, unknown> | null): Array<{ file: string; purpose: string }> {
  const eps: Array<{ file: string; purpose: string }> = [];

  if (pkg?.main) eps.push({ file: String(pkg.main), purpose: "CommonJS entry" });
  if (pkg?.module) eps.push({ file: String(pkg.module), purpose: "ESM entry" });

  const candidates: Array<[string, string]> = [
    ["src/index.ts", "Main TypeScript entry"],
    ["src/main.ts", "Application entry"],
    ["src/app.ts", "App entry"],
    ["index.js", "Main JS entry"],
    ["server.js", "Server entry"],
    ["main.py", "Python entry"],
    ["main.go", "Go entry"],
    ["src/main.rs", "Rust entry"],
  ];

  for (const [file, purpose] of candidates) {
    if (fileExists(root, file)) {
      eps.push({ file, purpose });
    }
  }

  return eps;
}

function getDirectoryTree(root: string, maxDepth = 2): string[] {
  const lines: string[] = [];
  function walk(dir: string, prefix: string, depth: number): void {
    if (depth > maxDepth) return;
    try {
      const entries = readdirSync(dir).filter(
        (e) => !e.startsWith(".") && e !== "node_modules" && e !== "dist" && e !== ".git"
      );
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const isLast = i === entries.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const full = join(dir, entry);
        const isDir = statSync(full).isDirectory();
        lines.push(`${prefix}${connector}${entry}${isDir ? "/" : ""}`);
        if (isDir) {
          walk(full, prefix + (isLast ? "    " : "│   "), depth + 1);
        }
      }
    } catch {
      // ignore
    }
  }
  walk(root, "", 0);
  return lines;
}

// ---------------------------------------------------------------------------
// Main snapshot builder
// ---------------------------------------------------------------------------

export function buildBrownfieldSnapshot(root: string, featureTitle: string): BrownfieldSnapshot {
  const pkg = readJson(root, "package.json");
  const langs = detectLanguages(root);
  const frameworks = detectFrameworks(pkg);
  const testFramework = detectTestFramework(pkg, root);

  const buildTools: string[] = [];
  if (pkg) {
    if ("vite" in ((pkg.devDependencies as Record<string, unknown>) ?? {})) buildTools.push("Vite");
    if ("webpack" in ((pkg.devDependencies as Record<string, unknown>) ?? {})) buildTools.push("Webpack");
    if ("rollup" in ((pkg.devDependencies as Record<string, unknown>) ?? {})) buildTools.push("Rollup");
    if ("tsc" in ((pkg.scripts as Record<string, unknown>) ?? {}) || existsSync(join(root, "tsconfig.json"))) {
      buildTools.push("tsc");
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    featureTitle,
    techStack: {
      language: langs.length > 0 ? langs : ["Unknown"],
      frameworks: frameworks.length > 0 ? frameworks : [],
      buildTools: buildTools.length > 0 ? buildTools : [],
      runtime: existsSync(join(root, "package.json")) ? "Node.js" : "Unknown",
    },
    projectStructure: getDirectoryTree(root),
    entryPoints: detectEntryPoints(root, pkg),
    testFramework,
    conventions: [],
    integrationPoints: [],
    risks: [],
  };
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

export function renderBrownfieldMarkdown(snapshot: BrownfieldSnapshot): string {
  const lines: string[] = [
    "# Brownfield Snapshot",
    "",
    `Generated: ${snapshot.generatedAt}`,
    `Feature: ${snapshot.featureTitle}`,
    "",
    "## Tech Stack",
    `- Language: ${snapshot.techStack.language.join(", ")}`,
    `- Framework: ${snapshot.techStack.frameworks.join(", ") || "none"}`,
    `- Build: ${snapshot.techStack.buildTools.join(", ") || "none"}`,
    `- Runtime: ${snapshot.techStack.runtime}`,
    "",
    "## Project Structure",
    "```",
    ...snapshot.projectStructure,
    "```",
    "",
    "## Entry Points",
  ];

  if (snapshot.entryPoints.length === 0) {
    lines.push("_(none detected)_");
  } else {
    for (const ep of snapshot.entryPoints) {
      lines.push(`- \`${ep.file}\`: ${ep.purpose}`);
    }
  }

  lines.push("", "## Test Framework");
  if (snapshot.testFramework) {
    lines.push(
      `- Framework: ${snapshot.testFramework.name}`,
      `- Test location: ${snapshot.testFramework.location}`,
      `- Coverage tool: ${snapshot.testFramework.coverageTool}`
    );
  } else {
    lines.push("_(none detected)_");
  }

  lines.push("", "## Relevant Conventions");
  if (snapshot.conventions.length === 0) {
    lines.push("_(not yet analysed)_");
  } else {
    for (const c of snapshot.conventions) lines.push(`- ${c}`);
  }

  lines.push("", "## Integration Points for This Feature");
  if (snapshot.integrationPoints.length === 0) {
    lines.push("_(not yet analysed)_");
  } else {
    for (const ip of snapshot.integrationPoints) {
      lines.push(`- Module \`${ip.module}\`: ${ip.interaction}`);
    }
  }

  lines.push("", "## Risks & Constraints");
  if (snapshot.risks.length === 0) {
    lines.push("_(none identified)_");
  } else {
    for (const r of snapshot.risks) lines.push(`- ${r}`);
  }

  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

export function writeBrownfieldSnapshot(root: string, snapshot: BrownfieldSnapshot): void {
  const path = join(root, "docs", "brownfield-snapshot.md");
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, renderBrownfieldMarkdown(snapshot), "utf8");
}

export function isBrownfieldRepo(root: string): boolean {
  // Heuristic: has source files AND (package.json with deps OR non-trivial git history)
  const hasSrc =
    existsSync(join(root, "src")) ||
    existsSync(join(root, "lib")) ||
    existsSync(join(root, "app"));

  const pkg = readJson(root, "package.json");
  const hasDeps =
    pkg !== null &&
    (Object.keys((pkg.dependencies as Record<string, unknown>) ?? {}).length > 0 ||
      Object.keys((pkg.devDependencies as Record<string, unknown>) ?? {}).length > 0);

  return hasSrc && hasDeps;
}
