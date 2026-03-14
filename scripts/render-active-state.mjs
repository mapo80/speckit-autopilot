#!/usr/bin/env node
/**
 * render-active-state.mjs
 * Reads docs/autopilot-state.json and docs/iteration-log.md and prints a
 * concise human-readable summary of the current autopilot state.
 * Exit 0 always so hooks never block the session.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const CWD = process.cwd();
const STATE_FILE = join(CWD, "docs", "autopilot-state.json");
const BACKLOG_FILE = join(CWD, "docs", "product-backlog.yaml");
const LOG_FILE = join(CWD, "docs", "iteration-log.md");

function safeRead(path) {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

function safeJson(path) {
  const raw = safeRead(path);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function countBacklogStatuses(raw) {
  if (!raw) return {};
  const counts = { open: 0, in_progress: 0, done: 0, blocked: 0 };
  const statusRe = /status:\s*(\w+)/g;
  let m;
  while ((m = statusRe.exec(raw)) !== null) {
    const s = m[1];
    if (s in counts) counts[s]++;
  }
  return counts;
}

const state = safeJson(STATE_FILE);
const backlogRaw = safeRead(BACKLOG_FILE);
const logRaw = safeRead(LOG_FILE);

if (!state) {
  console.log("=== speckit-autopilot ===");
  console.log("No autopilot state found. Run /speckit-autopilot:bootstrap-product to start.");
  process.exit(0);
}

const counts = countBacklogStatuses(backlogRaw);
const lastLogLines = logRaw
  ? logRaw.split("\n").filter(Boolean).slice(-10).join("\n")
  : "(no log)";

console.log("=== speckit-autopilot RESUME STATE ===");
console.log(`Active feature : ${state.activeFeature ?? "(none)"}`);
console.log(`Current phase  : ${state.currentPhase ?? "(none)"}`);
console.log(`Next feature   : ${state.nextFeature ?? "(none)"}`);
console.log(`Last error     : ${state.lastError ?? "(none)"}`);
console.log(`Failures       : ${state.consecutiveFailures ?? 0}/${state.maxFailures ?? 3}`);
console.log(`Backlog        : open=${counts.open ?? 0}  in_progress=${counts.in_progress ?? 0}  done=${counts.done ?? 0}  blocked=${counts.blocked ?? 0}`);
console.log(`Coverage       : ${state.lastCoverage ?? "unknown"}`);
console.log(`Last test run  : ${state.lastTestRun ?? "never"}`);
console.log("--- last iteration-log entries ---");
console.log(lastLogLines);
console.log("======================================");
