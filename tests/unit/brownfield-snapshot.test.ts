import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildBrownfieldSnapshot,
  renderBrownfieldMarkdown,
  writeBrownfieldSnapshot,
  isBrownfieldRepo,
  BrownfieldSnapshot,
} from "../../src/core/brownfield-snapshot.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "brownfield-test-"));
}

function setupNodeProject(root: string, withDeps = true): void {
  const pkg = {
    name: "test-app",
    version: "1.0.0",
    scripts: { test: "jest", lint: "eslint ." },
    dependencies: withDeps ? { react: "^18.0.0" } : {},
    devDependencies: withDeps ? { jest: "^29.0.0", typescript: "^5.0.0" } : {},
  };
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg), "utf8");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "index.ts"), "export default {};\n", "utf8");
  writeFileSync(join(root, "tsconfig.json"), "{}", "utf8");
}

// ---------------------------------------------------------------------------
// buildBrownfieldSnapshot
// ---------------------------------------------------------------------------

describe("buildBrownfieldSnapshot", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("produces a snapshot with correct feature title", () => {
    setupNodeProject(tmp);
    const snap = buildBrownfieldSnapshot(tmp, "User Authentication");
    expect(snap.featureTitle).toBe("User Authentication");
  });

  it("detects TypeScript in src/", () => {
    setupNodeProject(tmp);
    const snap = buildBrownfieldSnapshot(tmp, "Auth");
    expect(snap.techStack.language.some((l) => l.includes("TypeScript"))).toBe(true);
  });

  it("detects Node.js runtime from package.json", () => {
    setupNodeProject(tmp);
    const snap = buildBrownfieldSnapshot(tmp, "Auth");
    expect(snap.techStack.runtime).toBe("Node.js");
  });

  it("detects React framework from dependencies", () => {
    setupNodeProject(tmp);
    const snap = buildBrownfieldSnapshot(tmp, "Auth");
    expect(snap.techStack.frameworks.some((f) => f.includes("React"))).toBe(true);
  });

  it("detects Jest as test framework", () => {
    setupNodeProject(tmp);
    const snap = buildBrownfieldSnapshot(tmp, "Auth");
    expect(snap.testFramework?.name).toBe("Jest");
  });

  it("detects entry point src/index.ts", () => {
    setupNodeProject(tmp);
    const snap = buildBrownfieldSnapshot(tmp, "Auth");
    expect(snap.entryPoints.some((ep) => ep.file.includes("index.ts"))).toBe(true);
  });

  it("includes generatedAt timestamp", () => {
    const snap = buildBrownfieldSnapshot(tmp, "Test");
    expect(() => new Date(snap.generatedAt)).not.toThrow();
  });

  it("works on an empty directory without crashing", () => {
    expect(() => buildBrownfieldSnapshot(tmp, "Empty")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// renderBrownfieldMarkdown
// ---------------------------------------------------------------------------

describe("renderBrownfieldMarkdown", () => {
  const snapshot: BrownfieldSnapshot = {
    generatedAt: "2024-01-01T00:00:00.000Z",
    featureTitle: "Auth Feature",
    techStack: { language: ["TypeScript"], frameworks: ["React"], buildTools: ["tsc"], runtime: "Node.js" },
    projectStructure: ["├── src/", "└── package.json"],
    entryPoints: [{ file: "src/index.ts", purpose: "Main TypeScript entry" }],
    testFramework: { name: "Jest", location: "*.test.ts", coverageTool: "jest --coverage" },
    conventions: ["camelCase naming"],
    integrationPoints: [{ module: "src/auth.ts", interaction: "exports login()" }],
    risks: ["No test coverage for legacy code"],
  };

  it("renders markdown with all sections", () => {
    const md = renderBrownfieldMarkdown(snapshot);
    expect(md).toContain("# Brownfield Snapshot");
    expect(md).toContain("## Tech Stack");
    expect(md).toContain("## Project Structure");
    expect(md).toContain("## Entry Points");
    expect(md).toContain("## Test Framework");
    expect(md).toContain("## Relevant Conventions");
    expect(md).toContain("## Integration Points");
    expect(md).toContain("## Risks & Constraints");
  });

  it("includes feature title", () => {
    const md = renderBrownfieldMarkdown(snapshot);
    expect(md).toContain("Auth Feature");
  });

  it("shows none detected for empty collections", () => {
    const emptySnapshot: BrownfieldSnapshot = { ...snapshot, conventions: [], integrationPoints: [], risks: [], entryPoints: [], testFramework: null };
    const md = renderBrownfieldMarkdown(emptySnapshot);
    expect(md).toContain("_(none detected)_");
  });
});

// ---------------------------------------------------------------------------
// writeBrownfieldSnapshot
// ---------------------------------------------------------------------------

describe("writeBrownfieldSnapshot", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("writes docs/brownfield-snapshot.md", () => {
    const snap = buildBrownfieldSnapshot(tmp, "Test Feature");
    writeBrownfieldSnapshot(tmp, snap);
    expect(existsSync(join(tmp, "docs", "brownfield-snapshot.md"))).toBe(true);
  });

  it("creates docs/ directory if missing", () => {
    const snap = buildBrownfieldSnapshot(tmp, "Test Feature");
    writeBrownfieldSnapshot(tmp, snap);
    expect(existsSync(join(tmp, "docs"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isBrownfieldRepo
// ---------------------------------------------------------------------------

describe("isBrownfieldRepo", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns false for an empty directory", () => {
    expect(isBrownfieldRepo(tmp)).toBe(false);
  });

  it("returns true for a Node.js project with src/ and dependencies", () => {
    setupNodeProject(tmp);
    expect(isBrownfieldRepo(tmp)).toBe(true);
  });

  it("returns false for a project with src/ but no dependencies", () => {
    setupNodeProject(tmp, false);
    expect(isBrownfieldRepo(tmp)).toBe(false);
  });
});
