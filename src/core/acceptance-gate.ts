import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { AutopilotState, AcceptanceCriteriaConfig } from "./state-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GateCheckResult {
  name: string;
  passed: boolean;
  details: string;
}

export interface GateResult {
  passed: boolean;
  checks: GateCheckResult[];
  coverage: number | null;
  summary: string;
}

// ---------------------------------------------------------------------------
// Package.json script detection
// ---------------------------------------------------------------------------

export function readPackageScripts(root: string): Record<string, string> {
  const p = join(root, "package.json");
  if (!existsSync(p)) return {};
  try {
    const pkg = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    return (pkg.scripts as Record<string, string>) ?? {};
  } catch {
    return {};
  }
}

export function pickCommand(
  scripts: Record<string, string>,
  candidates: string[],
  fallback: string
): string {
  for (const c of candidates) {
    if (scripts[c]) return `npm run ${c}`;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Coverage extraction
// ---------------------------------------------------------------------------

export function extractCoveragePercent(output: string): number | null {
  // Jest/istanbul table: "All files | 94.5 | ..."
  const tableMatch = output.match(/All files\s*\|\s*([\d.]+)/);
  if (tableMatch) return parseFloat(tableMatch[1]);

  // Vitest: "Coverage: 94.5%"
  const vitestMatch = output.match(/Coverage:\s*([\d.]+)%/i);
  if (vitestMatch) return parseFloat(vitestMatch[1]);

  // Generic fallback
  const genericMatch = output.match(/([\d.]+)%\s+(?:lines|statements)/i);
  if (genericMatch) return parseFloat(genericMatch[1]);

  return null;
}

// ---------------------------------------------------------------------------
// Lint check
// ---------------------------------------------------------------------------

function runLintCheck(root: string): GateCheckResult {
  if (!existsSync(join(root, "package.json"))) {
    return { name: "lint", passed: true, details: "skipped: no package.json found" };
  }
  const scripts = readPackageScripts(root);
  const cmd = pickCommand(scripts, ["lint", "eslint"], "npx eslint .");

  const [prog, ...args] = cmd.split(" ");
  const result = spawnSync(prog, args, { cwd: root, encoding: "utf8", shell: true });
  const passed = result.status === 0;

  return {
    name: "lint",
    passed,
    details: passed ? "Lint passed" : (result.stderr ?? result.stdout ?? "lint failed"),
  };
}

// ---------------------------------------------------------------------------
// Test check
// ---------------------------------------------------------------------------

function runTestCheck(root: string, withCoverage: boolean, timeoutMs = 120_000): { check: GateCheckResult; coverage: number | null } {
  if (!existsSync(join(root, "package.json"))) {
    return {
      check: { name: "tests", passed: true, details: "skipped: no package.json found" },
      coverage: null,
    };
  }
  const scripts = readPackageScripts(root);
  const baseCmd = pickCommand(scripts, ["test", "jest", "vitest"], "npx jest");
  const cmd = withCoverage ? `${baseCmd} --coverage` : baseCmd;

  const [prog, ...args] = cmd.split(" ");
  const result = spawnSync(prog, args, { cwd: root, encoding: "utf8", shell: true, timeout: timeoutMs });
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  const passed = result.status === 0;
  const coverage = withCoverage ? extractCoveragePercent(output) : null;

  return {
    check: {
      name: "tests",
      passed,
      details: passed ? "All tests passed" : output.slice(0, 500),
    },
    coverage,
  };
}

// ---------------------------------------------------------------------------
// Coverage threshold check
// ---------------------------------------------------------------------------

export function runCoverageThresholdCheck(
  coverage: number | null,
  minCoverage: number | null
): GateCheckResult {
  if (minCoverage == null) {
    return { name: "coverage_threshold", passed: true, details: "No minimum coverage configured" };
  }
  if (coverage == null) {
    return { name: "coverage_threshold", passed: false, details: "Coverage could not be extracted from test output" };
  }
  const passed = coverage >= minCoverage;
  return {
    name: "coverage_threshold",
    passed,
    details: passed
      ? `Coverage ${coverage.toFixed(1)}% >= ${minCoverage}%`
      : `Coverage ${coverage.toFixed(1)}% < required ${minCoverage}%`,
  };
}

// ---------------------------------------------------------------------------
// Acceptance items check
// ---------------------------------------------------------------------------

export function checkAcceptanceItems(
  criteria: AcceptanceCriteriaConfig
): GateCheckResult {
  const items = criteria.items ?? [];
  const pending = items.filter((i) => i.status !== "done");
  const passed = pending.length === 0;
  return {
    name: "acceptance_items",
    passed,
    details: passed
      ? "All acceptance criteria items done"
      : `${pending.length} item(s) pending: ${pending.map((i) => i.description).join("; ")}`,
  };
}

// ---------------------------------------------------------------------------
// Main gate runner
// ---------------------------------------------------------------------------

export function runAcceptanceGate(root: string, state: AutopilotState): GateResult {
  if (!state.gatingEnabled) {
    return {
      passed: true,
      checks: [{ name: "gating", passed: true, details: "Gating disabled" }],
      coverage: null,
      summary: "Gating disabled – all checks skipped",
    };
  }

  const criteria = state.acceptanceCriteria;
  const checks: GateCheckResult[] = [];
  let coverage: number | null = null;

  // Lint
  if (criteria.requireLintPass !== false) {
    checks.push(runLintCheck(root));
  }

  // Tests + coverage
  if (criteria.requireTestsPass !== false) {
    const hasCoverageThreshold = criteria.minCoverage != null;
    const { check, coverage: cov } = runTestCheck(root, hasCoverageThreshold, state.testTimeoutMs);
    checks.push(check);
    coverage = cov;

    // Coverage threshold
    checks.push(runCoverageThresholdCheck(coverage, criteria.minCoverage ?? null));
  }

  // Acceptance items
  checks.push(checkAcceptanceItems(criteria));

  const passed = checks.every((c) => c.passed);
  const failed = checks.filter((c) => !c.passed).map((c) => c.name);
  const summary = passed
    ? "All acceptance criteria met"
    : `Gate FAILED: ${failed.join(", ")}`;

  return { passed, checks, coverage, summary };
}

// ---------------------------------------------------------------------------
// State update helper
// ---------------------------------------------------------------------------

export function applyGateResultToState(
  state: AutopilotState,
  result: GateResult
): Partial<AutopilotState> {
  const lintCheck = result.checks.find((c) => c.name === "lint");
  const testCheck = result.checks.find((c) => c.name === "tests");

  return {
    lastLintPassed: lintCheck ? lintCheck.passed : state.lastLintPassed,
    lastTestsPassed: testCheck ? testCheck.passed : state.lastTestsPassed,
    lastCoverage: result.coverage != null ? `${result.coverage.toFixed(1)}` : state.lastCoverage,
    lastTestRun: new Date().toISOString(),
    lastError: result.passed ? null : result.summary,
  };
}
