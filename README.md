# speckit-autopilot

A production-ready Claude Code plugin that orchestrates [Spec Kit](https://speckit.dev)
to autonomously ship full products and individual features, one spec at a time.

## Features

- **Greenfield mode** – read `docs/product.md`, generate a backlog, and implement every feature iteratively
- **Brownfield mode** – analyse an existing repo and implement a single targeted feature
- **Dual-mode runner** – uses `claude --print` CLI (default) or `@anthropic-ai/sdk` (when `ANTHROPIC_API_KEY` is set)
- **Compaction-safe** – survives `/compact`, session restarts, and IDE reboots via file-based state
- **Spec Kit integration** – drives the full `/speckit.*` workflow per feature
- **Acceptance gating** – blocks completion if lint, tests, or coverage do not pass

## Requirements

- Claude Code >= 2.0.0 (`claude` CLI available in PATH)
- Node.js >= 18
- [Spec Kit](https://speckit.dev) (`specify` CLI) – optional at bootstrap time, required at implementation time

---

## Installation

```bash
git clone https://github.com/mapo80/speckit-autopilot
cd speckit-autopilot
npm install
npm run build

# Install skills globally for Claude Code
bash install.sh
```

The `install.sh` script copies the skill definitions into `~/.claude/skills/speckit-autopilot/`
so they are available in every Claude Code session.

Restart Claude Code (or open a new session) after running the script.

---

## Greenfield flow

Use this flow when starting a new product from a product description.

### 1. Create `docs/product.md`

Write your product description following this structure:

```markdown
# Product: My App

## Vision
...

## In Scope
### Feature 1 - Core Feature
- criterion 1
- criterion 2

### Feature 2 - Secondary Feature
...

## Out of Scope
- ...

## Delivery Preference
1. Core Feature
2. Secondary Feature
```

### 2. Bootstrap the backlog

```
/bootstrap-product
```

Creates:
- `docs/roadmap.md` – ordered feature list with dependencies
- `docs/product-backlog.yaml` – machine-readable backlog
- `docs/autopilot-state.json` – initial state

### 3. Ship the entire product

```
/ship-product
```

The plugin will:
1. Pick the next open feature (by priority and dependency order)
2. Run the full Spec Kit workflow for that feature
3. Run the QA gate (lint, tests, coverage)
4. Mark the feature done and loop to the next one
5. Stop when all features are done, a blocking error occurs, or failures exceed the threshold

### 4. Check progress at any time

```
/status
```

---

## Brownfield flow

Use this flow when adding a feature to an existing codebase.

### 1. (Optional) Create `docs/product.md` or just describe the feature

### 2. Run ship-feature

```
/ship-feature "user authentication"
```

Or without arguments to pick the next open backlog item:

```
/ship-feature
```

The plugin will:
1. Detect that the repo is brownfield (existing src/ + dependencies)
2. Generate `docs/brownfield-snapshot.md` (tech stack, entry points, conventions)
3. Run the full Spec Kit workflow scoped to this feature
4. Run the QA gate and mark the feature done

---

## Resume after /compact or session restart

If Claude Code compacts the context or you restart the session:

```
/resume-loop
```

The plugin reads `docs/autopilot-state.json` and `docs/iteration-log.md`
and resumes from the exact phase where work stopped.

---

## Commands reference

| Command | Description |
|---------|-------------|
| `/bootstrap-product` | Parse `docs/product.md` → roadmap + backlog + state |
| `/ship-product` | Ship all open features iteratively |
| `/ship-feature [target]` | Ship one feature (greenfield or brownfield) |
| `/resume-loop` | Resume after /compact or restart |
| `/status` | Show current phase, backlog summary, last error |

---

## State files

All state is stored in the **target repo** (not the plugin directory):

| File | Purpose |
|------|---------|
| `docs/product.md` | Input: product description (you write this) |
| `docs/roadmap.md` | Generated: ordered feature roadmap |
| `docs/product-backlog.yaml` | Generated: machine-readable backlog |
| `docs/autopilot-state.json` | Runtime: current phase, failure counts, coverage |
| `docs/brownfield-snapshot.md` | Generated: tech stack and integration points |
| `docs/iteration-log.md` | Log: all events, snapshots, and gate results |

---

## Agents

| Agent | Role |
|-------|------|
| `product-planner` | Extracts epics, features, priorities from product.md |
| `brownfield-analyst` | Analyses existing repo structure and conventions |
| `spec-auditor` | Reviews spec artifacts for completeness and consistency |
| `qa-gatekeeper` | Runs lint, tests, coverage checks; decides PASS/FAIL |

---

## Development

```bash
# Install dependencies
npm install

# Type-check
npm run typecheck

# Lint
npm run lint

# Run tests
npm test

# Run tests with coverage report
npm run test:coverage

# Build
npm run build
```

### Project structure

```
speckit-autopilot/
├── agents/                  # Agent definitions (markdown)
├── examples/
│   └── simple-demo/         # Example product with expected artifacts
├── skills/                  # Skill definitions (source — copied by install.sh)
│   ├── bootstrap-product.md
│   ├── ship-product.md
│   ├── ship-feature.md
│   ├── resume-loop.md
│   └── status.md
├── src/
│   ├── core/                # Business logic (SpecKitRunner, feature-picker, …)
│   └── cli/                 # CLI orchestration (ship-product, ship-feature, …)
├── tests/
│   ├── unit/
│   └── integration/
├── install.sh               # Installs skills into ~/.claude/skills/
├── CHANGELOG.md
├── CLAUDE.md                # Operational rules
└── README.md
```

---

## Coverage

The test suite enforces >= 90% coverage on all metrics (lines, functions, branches, statements).
Run `npm run test:coverage` to verify.

---

## License

MIT
