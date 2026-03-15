#!/usr/bin/env node
// run.mjs — CLI entry point for speckit-autopilot
// Usage:
//   node run.mjs generate  --root /path/to/project --spec /path/to/spec.md
//   node run.mjs bootstrap --root /path/to/project
//   node run.mjs ship      --root /path/to/project
//   node run.mjs all       --root /path/to/project --spec /path/to/spec.md

import { bootstrapProduct } from './dist/cli/bootstrap-product.js';
import { shipProduct } from './dist/cli/ship-product.js';
import { spawnSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const args = process.argv.slice(2);
const command = args[0];
const rootIndex = args.indexOf('--root');
const root = rootIndex !== -1 ? resolve(args[rootIndex + 1]) : process.cwd();
const specIndex = args.indexOf('--spec');
const specFile = specIndex !== -1 ? resolve(args[specIndex + 1]) : null;
const featureIndex = args.indexOf('--feature');
const featureTarget = featureIndex !== -1 ? args[featureIndex + 1] : undefined;

const COMMANDS = ['generate', 'bootstrap', 'ship', 'ship-feature', 'all', 'audit', 'coverage-report', 'ai-review', 'status'];

if (!command || command === '--help' || command === '-h') {
  console.log(`
speckit-autopilot runner

Commands:
  generate         Read any spec file and write docs/product.md, then validate it (requires --spec)
  bootstrap        Parse docs/product.md and create backlog + roadmap + state
  ship             Implement all open features one by one (auto-resumes after interruption)
  ship-feature     Implement a single feature (--feature F-001 or next open)
  all              generate (if --spec) + bootstrap + ship in sequence
  audit            Full quality audit: validate product.md + backlog + AI review per feature → docs/audit-report.md
  coverage-report  Generate docs/coverage-report.md — structural gaps + file counts (deprecated: use audit)
  ai-review        Generate docs/ai-review-report.md — AI analysis vs original spec (deprecated: use audit)
  status           Print current phase, backlog summary, and recent log

Options:
  --root <path>      Target project directory (default: current directory)
  --spec <path>      Source specification file — required for generate; optional for ai-review
  --feature <id>     Feature ID for ship-feature (e.g. F-001); omit to pick next open

Examples:
  node run.mjs generate        --root /path/to/project --spec /path/to/spec.md
  node run.mjs bootstrap       --root /path/to/project
  node run.mjs ship            --root /path/to/project
  node run.mjs ship-feature    --root /path/to/project --feature F-003
  node run.mjs all             --root /path/to/project --spec /path/to/spec.md
  node run.mjs coverage-report --root /path/to/project
  node run.mjs ai-review       --root /path/to/project --spec /path/to/spec.md
  node run.mjs status          --root /path/to/project
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// generate-product: call claude --print to convert any spec into product.md
// ---------------------------------------------------------------------------

function findClaudePath() {
  const home = process.env.HOME || '';
  const candidates = [
    `${home}/.local/bin/claude`,
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    'claude',
  ];
  for (const p of candidates) {
    try {
      const r = spawnSync(p, ['--version'], { encoding: 'utf8', timeout: 5000 });
      if (r.status === 0) return p;
    } catch { /* skip */ }
  }
  return 'claude';
}

async function generateProductMd(specPath, projectRoot) {
  if (!existsSync(specPath)) {
    throw new Error(`Spec file not found: ${specPath}`);
  }

  const specContent = readFileSync(specPath, 'utf8');
  console.log(`  Reading spec: ${specPath} (${specContent.length} chars)`);

  const prompt = `You are a product analyst. Read the following specification document carefully and completely.
Convert it into a structured product.md file that will be used to generate a feature backlog.

The output MUST follow this EXACT format — no deviations, no preamble, no closing remarks:

# <Product Title>

## Vision
<2-4 sentences describing the product, its goals, and intended users>

## In Scope

### Feature 1 - <Epic>: <Feature Title>
- <specific, testable acceptance criterion derived from the spec>
- <specific, testable acceptance criterion derived from the spec>
(5 to 15 criteria per feature)

### Feature 2 - <Epic>: <Feature Title>
- ...

(repeat for ALL features)

## Out of Scope
- <item explicitly excluded or clearly outside scope>

## Delivery Preference
1. <title matching EXACTLY the ### Feature N heading above>
2. ...
(list ALL features in dependency order: infrastructure first, UI last)

RULES:
- Read the ENTIRE document before writing — do not stop early
- Extract ALL significant features — missing one means it will never be built
- Group features by epic/component (e.g. Backend, Frontend Web, Mobile App, Design System)
- Each acceptance criterion must be concrete and testable, referencing specific API endpoints, UI components, data fields, state transitions or business rules from the spec
- Delivery Preference must list ALL features in implementation order
- Titles in Delivery Preference must match EXACTLY the ### Feature N headings
- All output must be in English regardless of the source language
- Output ONLY the markdown — no explanations, no "Here is the file:"

SPECIFICATION DOCUMENT:
${specContent}`;

  const claudePath = findClaudePath();
  const env = {
    ...process.env,
    PATH: `${process.env.HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
  };

  console.log(`  Calling claude CLI to analyze spec (streaming output)...\n`);

  // Use spawn + streaming so output is visible in real time
  const output = await new Promise((resolveP, rejectP) => {
    const proc = spawn(claudePath, ['--print', '--dangerously-skip-permissions'], {
      shell: false,
      env,
      cwd: projectRoot,
    });

    proc.stdin.write(prompt);
    proc.stdin.end();

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text); // stream to terminal in real time
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text); // show stderr in real time too
    });

    const timer = setTimeout(() => {
      proc.kill();
      rejectP(new Error('claude CLI timed out after 10 minutes'));
    }, 600_000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      console.error(`\n  [debug] claude exited with code=${code} stdout=${stdout.length}chars stderr=${stderr.length}chars`);
      if (code !== 0) {
        rejectP(new Error(`claude CLI failed (exit ${code}):\n${stderr.slice(0, 500)}`));
      } else if (!stdout.trim()) {
        rejectP(new Error(`claude CLI returned empty stdout (stderr: ${stderr.slice(0, 300)})`));
      } else {
        resolveP(stdout.trim());
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      rejectP(new Error(`claude CLI error: ${err.message}`));
    });
  });

  console.log('\n');

  const productMdPath = join(projectRoot, 'docs', 'product.md');
  mkdirSync(join(projectRoot, 'docs'), { recursive: true });
  writeFileSync(productMdPath, output, 'utf8');

  // Validate the generated product.md immediately
  const { auditGenerate } = await import('./dist/cli/audit.js');
  const auditResult = auditGenerate(projectRoot);
  if (auditResult.warnings.length > 0) {
    console.warn(`  AUDIT WARNINGS: ${auditResult.warnings.join('; ')}`);
  } else {
    console.log(`  Audit: product.md valid (${auditResult.featureCount} features, no warnings)`);
  }

  // Count extracted features
  const featureCount = (output.match(/^### Feature \d+/gm) ?? []).length;
  console.log(`  Written: ${productMdPath}`);
  console.log(`  Features extracted: ${featureCount}`);

  return { featureCount, productMdPath };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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
    const genResult = generateProductMd(specFile, root);
    if (genResult.featureCount === 0) {
      console.warn('  WARNING: no features extracted — check that the spec has recognizable feature sections');
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

  if (command === 'coverage-report') {
    console.log('--- COVERAGE REPORT ---');
    const { coverageReport } = await import('./dist/cli/coverage-report.js');
    coverageReport(root);
  }

  if (command === 'ai-review') {
    console.log('--- AI REVIEW ---');
    const { aiReview } = await import('./dist/cli/ai-review.js');
    const effectiveSpec = specFile ?? join(root, 'docs', 'specifiche_finali_sistema_stanze_di_firma_v_3_ascii.md');
    await aiReview(root, effectiveSpec);
  }

  console.log(`\n[speckit-autopilot] done at ${new Date().toISOString()}`);
} catch (err) {
  console.error(`\n[speckit-autopilot] ERROR: ${err.message}`);
  process.exit(1);
}
