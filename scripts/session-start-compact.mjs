#!/usr/bin/env node
/**
 * session-start-compact.mjs
 * Hook: SessionStart (matcher: compact)
 * Prints a dynamic resume of autopilot state after a /compact so Claude
 * can continue without relying on chat history.
 */
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const renderScript = join(__dirname, "render-active-state.mjs");

const result = spawnSync(process.execPath, [renderScript], {
  stdio: "inherit",
  cwd: process.cwd()
});

process.exit(result.status ?? 0);
