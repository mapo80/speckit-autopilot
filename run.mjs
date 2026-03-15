#!/usr/bin/env node
// run.mjs — CLI entry point for speckit-autopilot
// Usage:
//   node run.mjs generate  --root /path/to/project --spec /path/to/spec.md
//   node run.mjs bootstrap --root /path/to/project
//   node run.mjs ship      --root /path/to/project
//   node run.mjs all       --root /path/to/project --spec /path/to/spec.md

import { bootstrapProduct } from './dist/cli/bootstrap-product.js';
import { shipProduct } from './dist/cli/ship-product.js';
import { resolve } from 'path';

const args = process.argv.slice(2);
const command = args[0];
const rootIndex = args.indexOf('--root');
const root = rootIndex !== -1 ? resolve(args[rootIndex + 1]) : process.cwd();
const specIndex = args.indexOf('--spec');
const specFile = specIndex !== -1 ? resolve(args[specIndex + 1]) : null;
const featureIndex = args.indexOf('--feature');
const featureTarget = featureIndex !== -1 ? args[featureIndex + 1] : undefined;

const COMMANDS = ['generate', 'generate-techstack', 'bootstrap', 'ship', 'ship-feature', 'all', 'audit', 'status'];

if (!command || command === '--help' || command === '-h') {
  console.log(`
speckit-autopilot runner

Commands:
  generate         Read any spec file and write docs/product.md, then validate it (requires --spec)
  generate-techstack  Infer tech stack from docs/product.md and write docs/tech-stack.md (backs up existing)
  bootstrap        Parse docs/product.md and create backlog + roadmap + state
  ship             Implement all open features one by one (auto-resumes after interruption)
  ship-feature     Implement a single feature (--feature F-001 or next open)
  all              generate (if --spec) + bootstrap + ship in sequence
  audit            Full quality audit: validate product.md + backlog + AI review per feature → docs/audit-report.md
  status           Print current phase, backlog summary, and recent log

Options:
  --root <path>      Target project directory (default: current directory)
  --spec <path>      Source specification file — required for generate
  --feature <id>     Feature ID for ship-feature (e.g. F-001); omit to pick next open

Examples:
  node run.mjs generate        --root /path/to/project --spec /path/to/spec.md
  node run.mjs bootstrap       --root /path/to/project
  node run.mjs ship            --root /path/to/project
  node run.mjs ship-feature    --root /path/to/project --feature F-003
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
    console.log('--- SHIP PRODUCT ---');
    const result = await shipProduct({ root });
    console.log(JSON.stringify(result, null, 2));
  }

  if (command === 'ship-feature') {
    console.log('--- SHIP FEATURE ---');
    const { shipFeature } = await import('./dist/cli/ship-feature.js');
    const result = await shipFeature({ root, featureTarget });
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
