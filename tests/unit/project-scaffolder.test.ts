import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  extractCsharpProjects,
  extractSolutionName,
  extractFrontendDir,
  extractMobileDir,
  scaffoldProject,
} from "../../src/core/project-scaffolder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "project-scaffolder-test-"));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// extractCsharpProjects
// ---------------------------------------------------------------------------

describe("extractCsharpProjects", () => {
  const projectStructure = `
# Project Structure

\`\`\`
SignHub/
├── src/
│   ├── SignHub.Api/
│   ├── SignHub.Services/
│   ├── SignHub.Dal/
│   ├── SignHub.Shared/
│   ├── signhub-web/
│   └── signhub-mobile/
├── tests/
│   ├── SignHub.Api.Tests/
│   └── SignHub.Services.Tests/
└── SignHub.sln
\`\`\`
`;

  it("extracts all C# project names", () => {
    const projects = extractCsharpProjects(projectStructure);
    const names = projects.map((p) => p.name);
    expect(names).toContain("SignHub.Api");
    expect(names).toContain("SignHub.Services");
    expect(names).toContain("SignHub.Dal");
    expect(names).toContain("SignHub.Shared");
  });

  it("extracts test projects", () => {
    const projects = extractCsharpProjects(projectStructure);
    const tests = projects.filter((p) => p.isTest);
    expect(tests.length).toBeGreaterThan(0);
    expect(tests.some((p) => p.name.endsWith(".Tests"))).toBe(true);
  });

  it("assigns correct template for API project", () => {
    const projects = extractCsharpProjects(projectStructure);
    const api = projects.find((p) => p.name === "SignHub.Api");
    expect(api?.template).toBe("webapi");
  });

  it("assigns classlib template for non-API, non-test projects", () => {
    const projects = extractCsharpProjects(projectStructure);
    const services = projects.find((p) => p.name === "SignHub.Services");
    expect(services?.template).toBe("classlib");
  });

  it("assigns xunit template for test projects", () => {
    const projects = extractCsharpProjects(projectStructure);
    const tests = projects.filter((p) => p.isTest);
    expect(tests.every((p) => p.template === "xunit")).toBe(true);
  });

  it("does not include non-C# directories", () => {
    const projects = extractCsharpProjects(projectStructure);
    const names = projects.map((p) => p.name);
    expect(names).not.toContain("signhub-web");
    expect(names).not.toContain("signhub-mobile");
  });

  it("returns empty array when no C# projects found", () => {
    const projects = extractCsharpProjects("## Structure\n- src/app/\n- src/mobile/");
    expect(projects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractSolutionName
// ---------------------------------------------------------------------------

describe("extractSolutionName", () => {
  it("extracts sln name from project-structure.md", () => {
    const content = "├── SignHub.sln\n";
    expect(extractSolutionName(content, "/some/root")).toBe("SignHub");
  });

  it("falls back to root directory name when no .sln found", () => {
    expect(extractSolutionName("no sln here", "/path/to/MyProject")).toBe("MyProject");
  });
});

// ---------------------------------------------------------------------------
// extractFrontendDir
// ---------------------------------------------------------------------------

describe("extractFrontendDir", () => {
  it("extracts frontend dir matching *web* pattern", () => {
    const content = "├── src/signhub-web/\n";
    const result = extractFrontendDir(content);
    expect(result).toContain("signhub-web");
  });

  it("returns null when no frontend dir found", () => {
    const content = "├── src/SignHub.Api/\n";
    expect(extractFrontendDir(content)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractMobileDir
// ---------------------------------------------------------------------------

describe("extractMobileDir", () => {
  it("extracts mobile dir matching *mobile* pattern", () => {
    const content = "├── src/signhub-mobile/\n";
    const result = extractMobileDir(content);
    expect(result).toContain("signhub-mobile");
  });

  it("returns null when no mobile dir found", () => {
    const content = "├── src/SignHub.Api/\n";
    expect(extractMobileDir(content)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// scaffoldProject — Node/React (no external tools needed)
// ---------------------------------------------------------------------------

describe("scaffoldProject — node/react package.json", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => cleanup(tmp));

  const techStack = "## Frontend\n- Framework: React 19 with TypeScript";
  const projectStructure = "├── src/signhub-web/\n";

  it("creates package.json when it does not exist", () => {
    const webDir = join(tmp, "src", "signhub-web");
    mkdirSync(webDir, { recursive: true });

    const result = scaffoldProject(tmp, techStack, projectStructure);
    expect(result.errors.filter((e) => e.includes("package.json"))).toHaveLength(0);
    expect(existsSync(join(webDir, "package.json"))).toBe(true);
    expect(result.created.some((f) => f.includes("package.json"))).toBe(true);
  });

  it("skips package.json when it already exists", () => {
    const webDir = join(tmp, "src", "signhub-web");
    mkdirSync(webDir, { recursive: true });
    writeFileSync(join(webDir, "package.json"), '{"name":"existing"}', "utf8");

    const result = scaffoldProject(tmp, techStack, projectStructure);
    expect(result.skipped.some((f) => f.includes("package.json"))).toBe(true);
    expect(result.created.some((f) => f.includes("package.json"))).toBe(false);
  });

  it("generates package.json with required scripts", () => {
    const webDir = join(tmp, "src", "signhub-web");
    mkdirSync(webDir, { recursive: true });

    scaffoldProject(tmp, techStack, projectStructure);

    const pkg = JSON.parse(readFileSync(join(webDir, "package.json"), "utf8"));
    expect(pkg.scripts.build).toBeTruthy();
    expect(pkg.scripts.test).toBeTruthy();
    expect(pkg.scripts.lint).toBeTruthy();
  });

  it("returns error (not throw) when no frontend dir found in project-structure", () => {
    const result = scaffoldProject(tmp, techStack, "no frontend dir here");
    expect(result.errors.some((e) => e.toLowerCase().includes("frontend"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scaffoldProject — skips non-matching stacks
// ---------------------------------------------------------------------------

describe("scaffoldProject — non-matching stack", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => cleanup(tmp));

  it("returns empty result for infrastructure-only tech stack", () => {
    const result = scaffoldProject(
      tmp,
      "## Infrastructure\n- Azure\n- PostgreSQL",
      "## Structure\n- docs/"
    );
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});
