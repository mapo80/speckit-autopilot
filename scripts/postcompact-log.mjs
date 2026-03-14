#!/usr/bin/env node
/**
 * postcompact-log.mjs
 * Hook: PostCompact (matcher: auto|manual)
 * Records the compact event in iteration-log.md and realigns autopilot-state.json.
 * Reads compact summary from COMPACT_SUMMARY env var (set by Claude Code hooks).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const CWD = process.cwd();
const STATE_FILE = join(CWD, "docs", "autopilot-state.json");
const LOG_FILE = join(CWD, "docs", "iteration-log.md");
const DOCS_DIR = join(CWD, "docs");
const compactSummary = process.env.COMPACT_SUMMARY ?? "(no summary provided)";
const timestamp = new Date().toISOString();

if (!existsSync(DOCS_DIR)) {
  mkdirSync(DOCS_DIR, { recursive: true });
}

// Update iteration log
const entry = [
  `\n## POST-COMPACT LOG – ${timestamp}`,
  `- Compact summary: ${compactSummary.replace(/\n/g, " ").slice(0, 300)}`,
  `- Status: context compacted, autopilot-state.json is the source of truth`,
  ""
].join("\n");

try {
  const existing = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, "utf8") : "# Iteration Log\n";
  writeFileSync(LOG_FILE, existing + entry, "utf8");
} catch (err) {
  console.error(`[speckit-autopilot] Failed to write post-compact log: ${err.message}`);
}

// Realign state: mark that we survived a compact
try {
  let state = {};
  if (existsSync(STATE_FILE)) {
    state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  }
  state.lastCompactAt = timestamp;
  state.compactCount = (state.compactCount ?? 0) + 1;
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  console.log(`[speckit-autopilot] Post-compact: state realigned at ${timestamp}`);
} catch (err) {
  console.error(`[speckit-autopilot] Failed to realign state: ${err.message}`);
}

process.exit(0);
