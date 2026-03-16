import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  parseStackSections,
  findConfigDir,
  findAllConfigDirs,
  detectStackCommands,
  runStackCommand,
} from "../../src/core/tech-stack-commands.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "tech-stack-cmd-test-"));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// parseStackSections
// ---------------------------------------------------------------------------

describe("parseStackSections", () => {
  it("parses multiple ## sections", () => {
    const content = `# Tech Stack\n\n## Backend\n- C# 12 / .NET 10\n\n## Frontend\n- React 19\n\n## Mobile\n- Flutter\n`;
    const sections = parseStackSections(content);
    expect(sections["Backend"]).toContain("C# 12");
    expect(sections["Frontend"]).toContain("React 19");
    expect(sections["Mobile"]).toContain("Flutter");
  });

  it("returns empty object for content with no ## headings", () => {
    expect(parseStackSections("# Tech Stack\nsome text")).toEqual({});
  });

  it("trims section bodies", () => {
    const content = `## Backend\n\n- Item\n\n`;
    const sections = parseStackSections(content);
    expect(sections["Backend"]).toBe("- Item");
  });

  it("handles single section", () => {
    const sections = parseStackSections("## Infrastructure\n- Azure");
    expect(sections["Infrastructure"]).toBe("- Azure");
  });
});

// ---------------------------------------------------------------------------
// findConfigDir
// ---------------------------------------------------------------------------

describe("findConfigDir", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => cleanup(tmp));

  it("finds file in root", () => {
    writeFileSync(join(tmp, "project.sln"), "");
    const result = findConfigDir(tmp, /\.sln$/);
    expect(result).toBe(tmp);
  });

  it("finds file in nested directory", () => {
    const nested = join(tmp, "src", "app");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "pubspec.yaml"), "");
    const result = findConfigDir(tmp, "pubspec.yaml", 4);
    expect(result).toBe(nested);
  });

  it("returns null when file not found", () => {
    const result = findConfigDir(tmp, "pubspec.yaml");
    expect(result).toBeNull();
  });

  it("respects maxDepth", () => {
    // depth 3 directories
    const deep = join(tmp, "a", "b", "c", "d");
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, "pubspec.yaml"), "");
    // maxDepth=2 should not find it
    expect(findConfigDir(tmp, "pubspec.yaml", 2)).toBeNull();
    // maxDepth=4 should find it
    expect(findConfigDir(tmp, "pubspec.yaml", 4)).toBe(deep);
  });

  it("skips node_modules", () => {
    const nm = join(tmp, "node_modules", "pkg");
    mkdirSync(nm, { recursive: true });
    writeFileSync(join(nm, "pubspec.yaml"), "");
    expect(findConfigDir(tmp, "pubspec.yaml")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAllConfigDirs
// ---------------------------------------------------------------------------

describe("findAllConfigDirs", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => cleanup(tmp));

  it("finds multiple package.json files", () => {
    const web = join(tmp, "src", "web");
    const mobile = join(tmp, "src", "mobile");
    mkdirSync(web, { recursive: true });
    mkdirSync(mobile, { recursive: true });
    writeFileSync(join(web, "package.json"), JSON.stringify({ scripts: { test: "jest" } }));
    writeFileSync(join(mobile, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    const dirs = findAllConfigDirs(tmp, "package.json", 5, 8);
    expect(dirs).toHaveLength(2);
    expect(dirs).toContain(web);
    expect(dirs).toContain(mobile);
  });
});

// ---------------------------------------------------------------------------
// detectStackCommands — C# / .NET
// ---------------------------------------------------------------------------

describe("detectStackCommands — dotnet", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => cleanup(tmp));

  it("detects dotnet build + test when C# in Backend section and .sln exists", () => {
    writeFileSync(join(tmp, "MyApp.sln"), "");
    const techStack = `# Tech Stack\n\n## Backend\n- Language / Runtime: C# 12 / .NET 10\n- Framework: ASP.NET Core\n`;
    const cmds = detectStackCommands(tmp, techStack);
    const labels = cmds.map((c) => c.label);
    expect(labels).toContain("dotnet build");
    expect(labels).toContain("dotnet test");
  });

  it("includes sln filename in dotnet build args", () => {
    writeFileSync(join(tmp, "SignHub.sln"), "");
    const cmds = detectStackCommands(tmp, "## Backend\n- C# 12 / .NET 10");
    const build = cmds.find((c) => c.label === "dotnet build");
    expect(build?.args).toContain("SignHub.sln");
  });

  it("does not detect dotnet when no .sln file exists", () => {
    const cmds = detectStackCommands(tmp, "## Backend\n- C# 12 / .NET 10");
    expect(cmds.find((c) => c.command === "dotnet")).toBeUndefined();
  });

  it("sets correct cwd for dotnet commands", () => {
    const srcDir = join(tmp, "src");
    mkdirSync(srcDir);
    writeFileSync(join(srcDir, "App.sln"), "");
    const cmds = detectStackCommands(tmp, "## Backend\n- C# / .NET");
    const build = cmds.find((c) => c.label === "dotnet build");
    expect(build?.cwd).toBe(srcDir);
  });
});

// ---------------------------------------------------------------------------
// detectStackCommands — Flutter
// ---------------------------------------------------------------------------

describe("detectStackCommands — flutter", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => cleanup(tmp));

  it("detects flutter test when Flutter in Mobile section and pubspec.yaml exists", () => {
    const mobileDir = join(tmp, "src", "app-mobile");
    mkdirSync(mobileDir, { recursive: true });
    writeFileSync(join(mobileDir, "pubspec.yaml"), "name: app");
    const techStack = `## Mobile\n- Framework: Flutter (latest stable) / Dart`;
    const cmds = detectStackCommands(tmp, techStack);
    const flutter = cmds.find((c) => c.label === "flutter test");
    expect(flutter).toBeDefined();
    expect(flutter?.cwd).toBe(mobileDir);
  });

  it("does not detect flutter when no pubspec.yaml exists", () => {
    const cmds = detectStackCommands(tmp, "## Mobile\n- Flutter");
    expect(cmds.find((c) => c.command === "flutter")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// detectStackCommands — Node / React
// ---------------------------------------------------------------------------

describe("detectStackCommands — node", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => cleanup(tmp));

  it("detects npm run build/test/lint when React in Frontend section and package.json exists", () => {
    const webDir = join(tmp, "src", "web");
    mkdirSync(webDir, { recursive: true });
    writeFileSync(join(webDir, "package.json"), JSON.stringify({
      scripts: { build: "vite build", test: "vitest", lint: "eslint ." },
    }));
    const techStack = `## Frontend\n- Framework: React 19+ with TypeScript`;
    const cmds = detectStackCommands(tmp, techStack);
    const labels = cmds.map((c) => c.label);
    expect(labels.some((l) => l.includes("build"))).toBe(true);
    expect(labels.some((l) => l.includes("test"))).toBe(true);
    expect(labels.some((l) => l.includes("lint"))).toBe(true);
  });

  it("skips missing scripts", () => {
    const webDir = join(tmp, "src", "web");
    mkdirSync(webDir, { recursive: true });
    writeFileSync(join(webDir, "package.json"), JSON.stringify({
      scripts: { test: "vitest" },
    }));
    const cmds = detectStackCommands(tmp, "## Frontend\n- React");
    const labels = cmds.map((c) => c.label);
    expect(labels.some((l) => l.includes("test"))).toBe(true);
    expect(labels.some((l) => l.includes("build"))).toBe(false);
    expect(labels.some((l) => l.includes("lint"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectStackCommands — multi-stack (C# + Flutter + React)
// ---------------------------------------------------------------------------

describe("detectStackCommands — multi-stack", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => cleanup(tmp));

  it("detects all stacks in a C# + Flutter + React project", () => {
    writeFileSync(join(tmp, "App.sln"), "");
    const mobileDir = join(tmp, "src", "mobile");
    mkdirSync(mobileDir, { recursive: true });
    writeFileSync(join(mobileDir, "pubspec.yaml"), "");
    const webDir = join(tmp, "src", "web");
    mkdirSync(webDir, { recursive: true });
    writeFileSync(join(webDir, "package.json"), JSON.stringify({ scripts: { test: "vitest", build: "vite build" } }));

    const techStack = [
      "## Backend",
      "- Language / Runtime: C# 12 / .NET 10",
      "## Frontend",
      "- Framework: React 19+ with TypeScript",
      "## Mobile",
      "- Framework: Flutter / Dart",
    ].join("\n");

    const cmds = detectStackCommands(tmp, techStack);
    const labels = cmds.map((c) => c.label);
    expect(labels).toContain("dotnet build");
    expect(labels).toContain("dotnet test");
    expect(labels).toContain("flutter test");
    expect(labels.some((l) => l.includes("test") && l.includes("web"))).toBe(true);
  });

  it("returns empty array when no known stack detected and no config files exist", () => {
    const cmds = detectStackCommands(tmp, "## Infrastructure\n- Azure");
    expect(cmds).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// detectStackCommands — deduplication
// ---------------------------------------------------------------------------

describe("detectStackCommands — deduplication", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => cleanup(tmp));

  it("does not produce duplicate commands", () => {
    writeFileSync(join(tmp, "App.sln"), "");
    // Both "C#" and ".NET" mentioned multiple times
    const techStack = "## Backend\n- C# 12 / .NET 10\n- Framework: ASP.NET Core .NET";
    const cmds = detectStackCommands(tmp, techStack);
    const labels = cmds.map((c) => c.label);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });
});

// ---------------------------------------------------------------------------
// runStackCommand — binary not found → fails gate
// ---------------------------------------------------------------------------

describe("runStackCommand", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => cleanup(tmp));

  it("fails (does not skip) when binary is not in PATH", () => {
    const result = runStackCommand({
      label: "nonexistent-tool test",
      type: "test",
      command: "nonexistent-tool-xyz-123",
      args: ["test"],
      cwd: tmp,
    });
    expect(result.passed).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.details).toMatch(/not found in PATH/i);
  });

  it("fails when cwd does not exist", () => {
    const result = runStackCommand({
      label: "dotnet build",
      type: "build",
      command: "dotnet",
      args: ["build"],
      cwd: join(tmp, "does-not-exist"),
    });
    // cwd check happens before binary check for non-existent dirs
    // — either cwd-not-found or binary-not-found failure is acceptable
    expect(result.passed).toBe(false);
  });
});
