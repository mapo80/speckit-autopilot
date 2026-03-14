#!/usr/bin/env node
/**
 * precompact-snapshot.mjs
 * Hook: PreCompact (matcher: auto|manual)
 * Appends a synthetic snapshot of the current state to docs/iteration-log.md
 * before the conversation is compacted so nothing is lost.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const CWD = process.cwd();
const STATE_FILE = join(CWD, "docs", "autopilot-state.json");
const LOG_FILE = join(CWD, "docs", "iteration-log.md");
const DOCS_DIR = join(CWD, "docs");

function safeJson(path) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  } catch {
    return null;
  }
}

const state = safeJson(STATE_FILE);
const timestamp = new Date().toISOString();

if (!existsSync(DOCS_DIR)) {
  mkdirSync(DOCS_DIR, { recursive: true });
}

const entry = [
  `\n## PRE-COMPACT SNAPSHOT – ${timestamp}`,
  `- Active feature: ${state?.activeFeature ?? "(none)"}`,
  `- Current phase:  ${state?.currentPhase ?? "(none)"}`,
  `- Next feature:   ${state?.nextFeature ?? "(none)"}`,
  `- Last error:     ${state?.lastError ?? "(none)"}`,
  `- Failures:       ${state?.consecutiveFailures ?? 0}/${state?.maxFailures ?? 3}`,
  `- Coverage:       ${state?.lastCoverage ?? "unknown"}`,
  `- Mode:           ${state?.mode ?? "unknown"}`,
  `- Status:         compaction triggered – state saved`,
  ""
].join("\n");

try {
  const existing = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, "utf8") : "# Iteration Log\n";
  writeFileSync(LOG_FILE, existing + entry, "utf8");
  console.log(`[speckit-autopilot] Pre-compact snapshot saved to ${LOG_FILE}`);
} catch (err) {
  console.error(`[speckit-autopilot] Failed to write pre-compact snapshot: ${err.message}`);
}

process.exit(0);
