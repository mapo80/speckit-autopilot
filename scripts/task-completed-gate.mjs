#!/usr/bin/env node
/**
 * task-completed-gate.mjs
 * Hook: TaskCompleted
 * Blocks task completion if acceptance criteria have not been met:
 *   - lint must pass
 *   - tests must pass
 *   - coverage must meet threshold
 * Reads criteria from docs/autopilot-state.json.
 * Exits 1 to block, 0 to allow.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const CWD = process.cwd();
const STATE_FILE = join(CWD, "docs", "autopilot-state.json");

function safeJson(path) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  } catch {
    return null;
  }
}

const state = safeJson(STATE_FILE);

// If no state or gating disabled, allow
if (!state || state.gatingEnabled === false) {
  process.exit(0);
}

// Only gate if a feature is actively in progress
if (!state.activeFeature || state.currentPhase !== "implement") {
  process.exit(0);
}

const acceptanceCriteria = state.acceptanceCriteria ?? {};
let blocked = false;
const reasons = [];

// Check lint
if (acceptanceCriteria.requireLintPass !== false && state.lastLintPassed === false) {
  blocked = true;
  reasons.push("Lint has not passed. Run lint and fix errors before completing.");
}

// Check tests
if (acceptanceCriteria.requireTestsPass !== false && state.lastTestsPassed === false) {
  blocked = true;
  reasons.push("Tests have not passed. Fix failing tests before completing.");
}

// Check coverage
if (acceptanceCriteria.minCoverage != null) {
  const cov = parseFloat(state.lastCoverage ?? "0");
  const min = parseFloat(acceptanceCriteria.minCoverage);
  if (!isNaN(min) && cov < min) {
    blocked = true;
    reasons.push(`Coverage ${cov.toFixed(1)}% is below required ${min}%.`);
  }
}

// Check custom acceptance items
if (Array.isArray(acceptanceCriteria.items)) {
  const pending = acceptanceCriteria.items.filter((i) => i.status !== "done");
  if (pending.length > 0) {
    blocked = true;
    reasons.push(`${pending.length} acceptance criteria item(s) not done: ${pending.map((i) => i.description).join("; ")}`);
  }
}

if (blocked) {
  console.error("[speckit-autopilot] TASK BLOCKED – acceptance criteria not met:");
  reasons.forEach((r) => console.error(`  - ${r}`));
  console.error("Fix the issues above and retry.");
  process.exit(1);
}

console.log("[speckit-autopilot] Acceptance gate: all criteria met, task allowed.");
process.exit(0);
