#!/usr/bin/env node
// run.mjs — CLI entry point for speckit-autopilot
// Usage:
//   node run.mjs generate  --root /path/to/project --spec /path/to/spec.md
//   node run.mjs bootstrap --root /path/to/project
//   node run.mjs ship      --root /path/to/project
//   node run.mjs all       --root /path/to/project --spec /path/to/spec.md

import { bootstrapProduct } from './dist/cli/bootstrap-product.js';
import { resolve, join, dirname } from 'path';
import { spawnSync } from 'child_process';
import { readdirSync, existsSync } from 'fs';

// Ensure 'claude' CLI is resolvable — if not in PATH, search the VSCode extension directory.
(function ensureClaudeInPath() {
  const check = spawnSync('claude', ['--version'], { shell: false, stdio: 'pipe' });
  if (check.status === 0) return; // already in PATH
  const extDir = join(process.env.HOME ?? '', '.vscode', 'extensions');
  if (!existsSync(extDir)) return;
  const candidates = readdirSync(extDir)
    .filter(d => d.startsWith('anthropic.claude-code-'))
    .map(d => join(extDir, d, 'resources', 'native-binary', 'claude'))
    .filter(p => existsSync(p))
    .sort();
  if (candidates.length > 0) {
    const bin = candidates.at(-1);
    process.env.PATH = `${dirname(bin)}:${process.env.PATH}`;
    console.log(`[speckit-autopilot] claude resolved via VSCode extension: ${bin}`);
  }
})();

const args = process.argv.slice(2);
const command = args[0];
const rootIndex = args.indexOf('--root');
const root = rootIndex !== -1 ? resolve(args[rootIndex + 1]) : process.cwd();
const specIndex = args.indexOf('--spec');
const specFile = specIndex !== -1 ? resolve(args[specIndex + 1]) : null;
const featureIndex = args.indexOf('--feature');
const featureTarget = featureIndex !== -1 ? args[featureIndex + 1] : undefined;

const COMMANDS = ['generate', 'generate-techstack', 'bootstrap', 'ship', 'all', 'audit', 'status'];

if (!command || command === '--help' || command === '-h') {
  console.log(`
speckit-autopilot runner

Commands:
  generate         Read any spec file and write docs/product.md, then validate it (requires --spec)
  generate-techstack  Infer tech stack from docs/product.md and write docs/tech-stack.md (backs up existing)
  bootstrap        Parse docs/product.md and create backlog + roadmap + state
  ship             Implement features; all open by default, or a single one with --feature
  all              generate (if --spec) + bootstrap + ship in sequence
  audit            Full quality audit: validate product.md + backlog + AI review per feature → docs/audit-report.md
  status           Print current phase, backlog summary, and recent log

Options:
  --root <path>      Target project directory (default: current directory)
  --spec <path>      Source specification file — required for generate
  --feature <id>     Feature ID or title substring for ship (e.g. F-001 or "payment"); omit to ship all

Examples:
  node run.mjs generate        --root /path/to/project --spec /path/to/spec.md
  node run.mjs bootstrap       --root /path/to/project
  node run.mjs ship            --root /path/to/project
  node run.mjs ship            --root /path/to/project --feature F-003
  node run.mjs all             --root /path/to/project --spec /path/to/spec.md
  node run.mjs audit           --root /path/to/project
  node run.mjs status          --root /path/to/project
`);
  process.exit(0);
}

if (!COMMANDS.includes(command)) {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

console.log(`[speckit-autopilot] command=${command} root=${root}`);
console.log(`[speckit-autopilot] started at ${new Date().toISOString()}\n`);

try {
  if (command === 'generate' || (command === 'all' && specFile)) {
    if (!specFile) {
      console.error('ERROR: --spec <path> is required for the generate command');
      process.exit(1);
    }
    console.log('--- GENERATE PRODUCT.MD ---');
    const { generateProduct } = await import('./dist/cli/generate-product.js');
    const genResult = await generateProduct(specFile, root);
    console.log(`  Written: ${genResult.productMdPath}`);
    console.log(`  Features extracted: ${genResult.featureCount}`);
    if (genResult.warnings.length > 0) {
      console.warn(`  AUDIT WARNINGS: ${genResult.warnings.join('; ')}`);
    } else {
      console.log(`  Audit: product.md valid (${genResult.featureCount} features, no warnings)`);
    }
    if (genResult.featureCount === 0) {
      console.warn('  WARNING: no features extracted — check that the spec has recognizable feature sections');
    }
    console.log();
  }

  if (command === 'generate-techstack') {
    console.log('--- GENERATE TECH STACK ---');
    const { generateTechStack } = await import('./dist/cli/generate-techstack.js');
    const { callClaudeForReview } = await import('./dist/cli/audit.js');
    const tsResult = await generateTechStack(root, callClaudeForReview, { overwrite: true });
    if (tsResult.created) {
      if (tsResult.backupPath) {
        console.log(`  Backed up previous: ${tsResult.backupPath}`);
      }
      console.log(`  Written: ${tsResult.techStackPath}`);
    } else {
      console.log(`  Skipped: ${tsResult.techStackPath} already exists`);
    }
    console.log();
  }

  if (command === 'bootstrap' || command === 'all') {
    console.log('--- BOOTSTRAP ---');
    const result = await bootstrapProduct(root);
    console.log(JSON.stringify(result, null, 2));
    console.log();
  }

  if (command === 'ship' || command === 'all') {
    console.log('--- SHIP ---');
    const { ship } = await import('./dist/cli/ship.js');
    const result = await ship({ root, featureTarget });
    console.log(JSON.stringify(result, null, 2));
  }

  if (command === 'status') {
    const { printStatus } = await import('./dist/cli/status.js');
    printStatus(root);
  }

  if (command === 'audit') {
    console.log('--- AUDIT ---');
    const { auditAll } = await import('./dist/cli/audit.js');
    await auditAll(root);
  }

  console.log(`\n[speckit-autopilot] done at ${new Date().toISOString()}`);
} catch (err) {
  console.error(`\n[speckit-autopilot] ERROR: ${err.message}`);
  process.exit(1);
}
