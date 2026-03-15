import { readFileSync, existsSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { parseBacklog } from "../core/backlog-schema.js";
import { StateStore } from "../core/state-store.js";

export function printStatus(root: string): void {
  // ── State ──────────────────────────────────────────────────────────────
  const store = new StateStore(root);
  if (!store.exists()) {
    console.log("No autopilot-state.json found. Run bootstrap-product first.");
    return;
  }
  const state = store.read();

  // ── Backlog ────────────────────────────────────────────────────────────
  const backlogPath = join(root, "docs", "product-backlog.yaml");
  let open = 0, inProgress = 0, done = 0, blocked = 0, total = 0;
  let nextFeatureTitle = "—";

  if (existsSync(backlogPath)) {
    try {
      const raw = yaml.load(readFileSync(backlogPath, "utf8")) as unknown;
      const backlog = parseBacklog(raw);
      total = backlog.features.length;
      for (const f of backlog.features) {
        if (f.status === "open") open++;
        else if (f.status === "in_progress") inProgress++;
        else if (f.status === "done") done++;
        else if (f.status === "blocked") blocked++;
      }
      const nextOpen = backlog.features.find((f) => f.status === "open");
      if (nextOpen) nextFeatureTitle = `${nextOpen.id} – ${nextOpen.title}`;
    } catch {
      // backlog unreadable
    }
  }

  // ── Iteration log tail ─────────────────────────────────────────────────
  const logPath = join(root, "docs", "iteration-log.md");
  let logTail = "—";
  if (existsSync(logPath)) {
    const lines = readFileSync(logPath, "utf8").split("\n");
    logTail = lines.slice(-20).filter((l) => l.trim()).slice(-10).join("\n  ");
  }

  // ── Output ─────────────────────────────────────────────────────────────
  const pad = (label: string) => label.padEnd(16);
  console.log(`\n=== speckit-autopilot STATUS ===`);
  console.log(`${pad("Mode")} : ${state.mode ?? "—"}`);
  console.log(`${pad("Status")} : ${state.status ?? "—"}`);
  console.log(`${pad("Active feature")} : ${state.activeFeature ?? "—"}`);
  console.log(`${pad("Current phase")} : ${state.currentPhase ?? "—"}`);
  console.log(`${pad("Next feature")} : ${nextFeatureTitle}`);
  console.log(`${pad("Failures")} : ${state.consecutiveFailures ?? 0}/${state.maxFailures ?? 3}`);
  console.log(`${pad("Last error")} : ${state.lastError ?? "—"}`);
  console.log(`${pad("Last test run")} : ${state.lastTestRun ?? "—"}`);
  console.log(`${pad("Coverage")} : ${state.lastCoverage ?? "—"}`);
  console.log(`${pad("Lint")} : ${state.lastLintPassed == null ? "—" : state.lastLintPassed ? "pass" : "fail"}`);
  console.log(`\n--- Backlog summary ---`);
  console.log(`  Open        : ${open}`);
  console.log(`  In progress : ${inProgress}`);
  console.log(`  Done        : ${done}`);
  console.log(`  Blocked     : ${blocked}`);
  console.log(`  Total       : ${total}`);
  console.log(`\n--- Recent log (last 10 lines) ---`);
  console.log(`  ${logTail}`);
  console.log(`================================\n`);
}
