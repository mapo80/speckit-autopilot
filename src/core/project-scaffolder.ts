import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { spawnSync } from "child_process";
import { parseStackSections } from "./tech-stack-commands.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScaffoldResult {
  created: string[];
  skipped: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers — project-structure.md parsing
// ---------------------------------------------------------------------------

/**
 * Extract C# project names from a project-structure.md.
 * Looks for patterns like:
 *   - `src/SignHub.Api/`
 *   - `├── SignHub.Services/`
 *   Returns { name: "SignHub.Api", dir: "src/SignHub.Api", type: "webapi"|"classlib"|"xunit" }
 */
export interface CsharpProject {
  name: string;
  dir: string;
  template: "webapi" | "classlib" | "xunit";
  isTest: boolean;
}

export function extractCsharpProjects(projectStructureContent: string): CsharpProject[] {
  const projects: CsharpProject[] = [];
  const seen = new Set<string>();

  // Match both `src/Foo.Bar/` and `├── Foo.Bar/` style lines
  // A C# project name has at least one dot and PascalCase segments
  const pattern = /(?:src\/|tests\/|├──\s+|└──\s+)([A-Z][A-Za-z0-9]+(?:\.[A-Z][A-Za-z0-9]+)+)\//g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(projectStructureContent)) !== null) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);

    // Determine subdirectory from context
    const lineStart = projectStructureContent.lastIndexOf("\n", m.index) + 1;
    const line = projectStructureContent.slice(lineStart, m.index + m[0].length);
    const isTest = name.endsWith(".Tests") || line.includes("tests/");
    const dir = isTest ? join("tests", name) : join("src", name);

    const template: CsharpProject["template"] = isTest
      ? "xunit"
      : name.endsWith(".Api")
      ? "webapi"
      : "classlib";

    projects.push({ name, dir, template, isTest });
  }

  return projects;
}

/**
 * Extract the solution name from project-structure.md (looks for *.sln line)
 * or falls back to the root directory name.
 */
export function extractSolutionName(
  projectStructureContent: string,
  root: string
): string {
  const slnMatch = projectStructureContent.match(/([A-Z][A-Za-z0-9]+)\.sln/);
  if (slnMatch) return slnMatch[1];
  return basename(root);
}

/**
 * Extract the frontend directory from project-structure.md.
 * Looks for patterns like `src/signhub-web/` or `src/web/`.
 */
export function extractFrontendDir(projectStructureContent: string): string | null {
  const m = projectStructureContent.match(/src\/([\w-]+(?:web|frontend|client|ui)[\w-]*)\//i);
  return m ? join("src", m[1]) : null;
}

/**
 * Extract the mobile directory from project-structure.md.
 * Looks for patterns like `src/signhub-mobile/` or `src/app-mobile/`.
 */
export function extractMobileDir(projectStructureContent: string): string | null {
  const m = projectStructureContent.match(/src\/([\w-]+(?:mobile|app)[\w-]*)\//i);
  return m ? join("src", m[1]) : null;
}

// ---------------------------------------------------------------------------
// Binary availability check
// ---------------------------------------------------------------------------

function isBinaryAvailable(cmd: string): boolean {
  const r = spawnSync(
    process.platform === "win32" ? "where" : "which",
    [cmd],
    { encoding: "utf8", shell: false }
  );
  return r.status === 0;
}

// ---------------------------------------------------------------------------
// C# / .NET scaffolding
// ---------------------------------------------------------------------------

function scaffoldDotnet(
  root: string,
  projects: CsharpProject[],
  solutionName: string,
  result: ScaffoldResult
): void {
  if (!isBinaryAvailable("dotnet")) {
    result.errors.push("dotnet not found in PATH — skipping C# scaffolding");
    return;
  }

  const slnFile = `${solutionName}.sln`;
  const slnPath = join(root, slnFile);

  // Create solution file
  if (existsSync(slnPath)) {
    result.skipped.push(slnFile);
  } else {
    const r = spawnSync("dotnet", ["new", "sln", "-n", solutionName], {
      cwd: root,
      encoding: "utf8",
      shell: false,
      timeout: 60_000,
    });
    if (r.status === 0) {
      result.created.push(slnFile);
    } else {
      result.errors.push(`dotnet new sln failed: ${(r.stderr ?? r.stdout ?? "").slice(0, 200)}`);
      return; // No point adding projects to a missing sln
    }
  }

  // Create each project
  const csprojPaths: string[] = [];
  for (const proj of projects) {
    const projDir = join(root, proj.dir);
    const csprojFile = join(proj.dir, `${proj.name}.csproj`);
    const csprojPath = join(root, csprojFile);

    if (existsSync(csprojPath)) {
      result.skipped.push(csprojFile);
      csprojPaths.push(csprojPath);
      continue;
    }

    // Ensure parent directory exists (may already have .cs files)
    if (!existsSync(projDir)) {
      mkdirSync(projDir, { recursive: true });
    }

    const r = spawnSync(
      "dotnet",
      ["new", proj.template, "-n", proj.name, "-o", projDir, "--no-restore", "--force"],
      { cwd: root, encoding: "utf8", shell: false, timeout: 60_000 }
    );
    if (r.status === 0) {
      result.created.push(csprojFile);
      csprojPaths.push(csprojPath);
    } else {
      result.errors.push(
        `dotnet new ${proj.template} ${proj.name} failed: ${(r.stderr ?? r.stdout ?? "").slice(0, 200)}`
      );
    }
  }

  // Add all projects to the solution
  for (const csprojPath of csprojPaths) {
    // Check if already in sln (best-effort: just re-add, it's idempotent)
    spawnSync("dotnet", ["sln", slnPath, "add", csprojPath], {
      cwd: root,
      encoding: "utf8",
      shell: false,
      timeout: 30_000,
    });
  }

  // Add project references: Api → Services, Api → Shared, Services → Dal, Services → Shared, Dal → Shared
  const findProj = (suffix: string) =>
    projects.find((p) => !p.isTest && p.name.endsWith(suffix));

  const api = findProj(".Api");
  const services = findProj(".Services");
  const dal = findProj(".Dal");
  const shared = findProj(".Shared");

  const refs: Array<[CsharpProject, CsharpProject]> = [];
  if (api && services) refs.push([api, services]);
  if (api && shared) refs.push([api, shared]);
  if (services && dal) refs.push([services, dal]);
  if (services && shared) refs.push([services, shared]);
  if (dal && shared) refs.push([dal, shared]);

  for (const [from, to] of refs) {
    const fromDir = join(root, from.dir);
    const toCsproj = join(root, to.dir, `${to.name}.csproj`);
    if (!existsSync(fromDir) || !existsSync(toCsproj)) continue;
    spawnSync("dotnet", ["add", fromDir, "reference", toCsproj], {
      cwd: root,
      encoding: "utf8",
      shell: false,
      timeout: 30_000,
    });
  }
}

// ---------------------------------------------------------------------------
// Flutter scaffolding
// ---------------------------------------------------------------------------

function scaffoldFlutter(
  root: string,
  mobileDir: string,
  result: ScaffoldResult
): void {
  if (!isBinaryAvailable("flutter")) {
    result.errors.push("flutter not found in PATH — skipping Flutter scaffolding");
    return;
  }

  const pubspecPath = join(root, mobileDir, "pubspec.yaml");
  if (existsSync(pubspecPath)) {
    result.skipped.push(join(mobileDir, "pubspec.yaml"));
    return;
  }

  const targetDir = join(root, mobileDir);
  // Derive Dart-valid project name (underscores, lowercase)
  const projectName = basename(mobileDir).replace(/-/g, "_").toLowerCase();

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  // flutter create --template=app inside the existing directory
  const r = spawnSync(
    "flutter",
    ["create", "--template=app", `--project-name=${projectName}`, "."],
    { cwd: targetDir, encoding: "utf8", shell: false, timeout: 120_000 }
  );

  if (r.status === 0) {
    result.created.push(join(mobileDir, "pubspec.yaml"));
  } else {
    result.errors.push(
      `flutter create failed: ${(r.stderr ?? r.stdout ?? "").slice(0, 200)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Node / React scaffolding
// ---------------------------------------------------------------------------

const MINIMAL_PACKAGE_JSON = (name: string) =>
  JSON.stringify(
    {
      name,
      version: "0.0.1",
      private: true,
      scripts: {
        dev: "vite",
        build: "vite build",
        test: "vitest run",
        lint: "eslint . --ext .ts,.tsx",
      },
      dependencies: {
        react: "^19.0.0",
        "react-dom": "^19.0.0",
      },
      devDependencies: {
        "@types/react": "^19.0.0",
        "@types/react-dom": "^19.0.0",
        "@vitejs/plugin-react": "^4.0.0",
        eslint: "^9.0.0",
        typescript: "^5.0.0",
        vite: "^6.0.0",
        vitest: "^3.0.0",
      },
    },
    null,
    2
  ) + "\n";

function scaffoldNode(root: string, frontendDir: string, result: ScaffoldResult): void {
  const pkgPath = join(root, frontendDir, "package.json");
  if (existsSync(pkgPath)) {
    result.skipped.push(join(frontendDir, "package.json"));
    return;
  }

  const targetDir = join(root, frontendDir);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const name = basename(frontendDir).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  try {
    writeFileSync(pkgPath, MINIMAL_PACKAGE_JSON(name), "utf8");
    result.created.push(join(frontendDir, "package.json"));
  } catch (e) {
    result.errors.push(`Failed to create package.json: ${String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Scaffold missing project config files based on the detected tech stack
 * and project-structure.md.
 *
 * - C# / .NET: creates *.sln + *.csproj files via `dotnet new`
 * - Flutter:   creates pubspec.yaml via `flutter create`
 * - Node/React: writes a minimal package.json (no npm install)
 *
 * Idempotent: existing files are skipped, never overwritten.
 */
export function scaffoldProject(
  root: string,
  techStackContent: string,
  projectStructureContent: string
): ScaffoldResult {
  const result: ScaffoldResult = { created: [], skipped: [], errors: [] };
  const sections = parseStackSections(techStackContent);
  const allText = [techStackContent, ...Object.values(sections)].join("\n").toLowerCase();

  const needsDotnet =
    allText.includes("c#") ||
    allText.includes(".net") ||
    allText.includes("asp.net") ||
    allText.includes("dotnet");

  const needsFlutter =
    allText.includes("flutter") || allText.includes("dart");

  const needsNode =
    allText.includes("react") ||
    allText.includes("node") ||
    allText.includes("typescript") ||
    allText.includes("javascript") ||
    allText.includes("vue") ||
    allText.includes("angular");

  // C# scaffolding
  if (needsDotnet) {
    const projects = extractCsharpProjects(projectStructureContent);
    const solutionName = extractSolutionName(projectStructureContent, root);
    if (projects.length > 0) {
      scaffoldDotnet(root, projects, solutionName, result);
    } else {
      result.errors.push("C# stack detected but no project names found in project-structure.md");
    }
  }

  // Flutter scaffolding
  if (needsFlutter) {
    const mobileDir = extractMobileDir(projectStructureContent);
    if (mobileDir) {
      scaffoldFlutter(root, mobileDir, result);
    } else {
      result.errors.push("Flutter stack detected but no mobile directory found in project-structure.md");
    }
  }

  // Node / React scaffolding
  if (needsNode) {
    const frontendDir = extractFrontendDir(projectStructureContent);
    if (frontendDir) {
      scaffoldNode(root, frontendDir, result);
    } else {
      result.errors.push("Node/React stack detected but no frontend directory found in project-structure.md");
    }
  }

  return result;
}
