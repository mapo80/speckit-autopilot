/**
 * Additional tests for brownfield-snapshot.ts branches not covered by the main test file:
 * - malformed package.json (readJson catch branch)
 * - vitest / mocha / pytest test framework detection
 * - additional entry point / language detection branches
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildBrownfieldSnapshot } from "../../src/core/brownfield-snapshot.js";

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "brownfield-extra-test-"));
}

// ---------------------------------------------------------------------------
// readJson catch branch (line 41): malformed JSON in package.json
// ---------------------------------------------------------------------------

describe("buildBrownfieldSnapshot – malformed package.json", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("does not throw and treats pkg as null", () => {
    writeFileSync(join(tmp, "package.json"), "{ invalid json }", "utf8");
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src", "index.ts"), "export {};", "utf8");
    const snap = buildBrownfieldSnapshot(tmp, "Test");
    // pkg is null → no framework/runtime detection from deps
    expect(snap.techStack.frameworks).toEqual([]);
    expect(snap.testFramework).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// vitest detection (line 122)
// ---------------------------------------------------------------------------

describe("buildBrownfieldSnapshot – vitest detection", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("detects vitest as test framework", () => {
    const pkg = {
      name: "app",
      version: "1.0.0",
      dependencies: {},
      devDependencies: { vitest: "^1.0.0", vite: "^5.0.0" },
    };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg), "utf8");
    const snap = buildBrownfieldSnapshot(tmp, "Feature");
    expect(snap.testFramework?.name).toBe("Vitest");
  });
});

// ---------------------------------------------------------------------------
// mocha detection (line 124-125)
// ---------------------------------------------------------------------------

describe("buildBrownfieldSnapshot – mocha detection", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("detects mocha as test framework", () => {
    const pkg = {
      name: "app",
      version: "1.0.0",
      dependencies: {},
      devDependencies: { mocha: "^10.0.0" },
    };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg), "utf8");
    const snap = buildBrownfieldSnapshot(tmp, "Feature");
    expect(snap.testFramework?.name).toBe("Mocha");
    expect(snap.testFramework?.coverageTool).toBe("nyc");
  });
});

// ---------------------------------------------------------------------------
// pytest detection (lines 127-128)
// ---------------------------------------------------------------------------

describe("buildBrownfieldSnapshot – pytest detection", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("detects pytest from pytest.ini", () => {
    // Package.json with no jest/vitest/mocha so the function reaches the pytest check
    const pkg = { name: "app", version: "1.0.0", dependencies: {}, devDependencies: {} };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg), "utf8");
    writeFileSync(join(tmp, "pytest.ini"), "[pytest]\n", "utf8");
    const snap = buildBrownfieldSnapshot(tmp, "Feature");
    expect(snap.testFramework?.name).toBe("pytest");
  });

  it("detects pytest from setup.cfg", () => {
    const pkg = { name: "app", version: "1.0.0", dependencies: {}, devDependencies: {} };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg), "utf8");
    writeFileSync(join(tmp, "setup.cfg"), "[tool:pytest]\n", "utf8");
    const snap = buildBrownfieldSnapshot(tmp, "Feature");
    expect(snap.testFramework?.name).toBe("pytest");
  });
});

// ---------------------------------------------------------------------------
// Additional language detection: TSX, JS, MJS, Python, Go files
// ---------------------------------------------------------------------------

describe("buildBrownfieldSnapshot – language detection variety", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("detects TSX files", () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src", "App.tsx"), "export default function App() {}", "utf8");
    const snap = buildBrownfieldSnapshot(tmp, "Feature");
    expect(snap.techStack.language.some((l) => l.includes("TSX"))).toBe(true);
  });

  it("detects JavaScript files", () => {
    writeFileSync(join(tmp, "index.js"), "module.exports = {};", "utf8");
    const snap = buildBrownfieldSnapshot(tmp, "Feature");
    expect(snap.techStack.language.some((l) => l.includes("JavaScript"))).toBe(true);
  });

  it("detects ESM JavaScript files (.mjs)", () => {
    writeFileSync(join(tmp, "app.mjs"), "export default {};", "utf8");
    const snap = buildBrownfieldSnapshot(tmp, "Feature");
    expect(snap.techStack.language.some((l) => l.includes("ESM"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Entry point detection: main, module from package.json
// ---------------------------------------------------------------------------

describe("buildBrownfieldSnapshot – entry point from package.json", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("picks up main and module fields from package.json", () => {
    const pkg = {
      name: "app",
      version: "1.0.0",
      main: "dist/index.js",
      module: "dist/index.mjs",
      dependencies: {},
      devDependencies: {},
    };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg), "utf8");
    const snap = buildBrownfieldSnapshot(tmp, "Feature");
    expect(snap.entryPoints.some((ep) => ep.file === "dist/index.js")).toBe(true);
    expect(snap.entryPoints.some((ep) => ep.file === "dist/index.mjs")).toBe(true);
  });

  it("detects server.js as entry point", () => {
    writeFileSync(join(tmp, "server.js"), "// server", "utf8");
    const snap = buildBrownfieldSnapshot(tmp, "Feature");
    expect(snap.entryPoints.some((ep) => ep.file === "server.js")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Build tool detection: webpack, rollup
// ---------------------------------------------------------------------------

describe("buildBrownfieldSnapshot – build tool detection", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("detects webpack from devDependencies", () => {
    const pkg = {
      name: "app",
      version: "1.0.0",
      dependencies: {},
      devDependencies: { webpack: "^5.0.0" },
    };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg), "utf8");
    const snap = buildBrownfieldSnapshot(tmp, "Feature");
    expect(snap.techStack.buildTools.some((t) => t.includes("Webpack"))).toBe(true);
  });

  it("detects rollup from devDependencies", () => {
    const pkg = {
      name: "app",
      version: "1.0.0",
      dependencies: {},
      devDependencies: { rollup: "^3.0.0" },
    };
    writeFileSync(join(tmp, "package.json"), JSON.stringify(pkg), "utf8");
    const snap = buildBrownfieldSnapshot(tmp, "Feature");
    expect(snap.techStack.buildTools.some((t) => t.includes("Rollup"))).toBe(true);
  });
});
