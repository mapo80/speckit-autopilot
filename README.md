# speckit-autopilot

A production-ready Claude Code plugin that orchestrates [Spec Kit](https://speckit.dev)
to autonomously ship full products and individual features, one spec at a time.

## Features

- **Greenfield mode** – read `docs/product.md`, generate a backlog, and implement every feature iteratively
- **Brownfield mode** – analyse an existing repo and implement a single targeted feature
- **Compaction-safe** – survives `/compact`, session restarts, and IDE reboots via file-based state
- **Spec Kit integration** – drives the full `/speckit.*` workflow per feature
- **Acceptance gating** – blocks completion if lint, tests, or coverage do not pass

## Requirements

- Claude Code >= 1.0.0
- Node.js >= 18
- [Spec Kit](https://speckit.dev) (`specify` CLI) – optional at bootstrap time, required at implementation time

---

## Installation

### Load the plugin in Claude Code

```bash
# Clone the plugin
git clone https://github.com/your-org/speckit-autopilot
cd speckit-autopilot
npm install

# Load via --plugin-dir flag
claude --plugin-dir /path/to/speckit-autopilot
```

### Local development setup

```bash
npm install
npm run build
npm test
```

---

## Local testing with --plugin-dir

Start Claude Code pointing at the plugin directory:

```bash
claude --plugin-dir /absolute/path/to/speckit-autopilot
```

Verify the plugin loaded by typing `/speckit-autopilot:status` in the chat.
You should see the status report (or a "no state found" message if this is a fresh repo).

Run the smoke test for the example product:

```bash
# In the target repo (e.g. examples/simple-demo as the project root)
claude --plugin-dir /path/to/speckit-autopilot
# Then run:
# /speckit-autopilot:bootstrap-product
```

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
/speckit-autopilot:bootstrap-product
```

Creates:
- `docs/roadmap.md` – ordered feature list with dependencies
- `docs/product-backlog.yaml` – machine-readable backlog
- `docs/autopilot-state.json` – initial state

### 3. Ship the entire product

```
/speckit-autopilot:ship-product
```

The plugin will:
1. Pick the next open feature (by priority and dependency order)
2. Run the full Spec Kit workflow for that feature
3. Run the QA gate (lint, tests, coverage)
4. Mark the feature done and loop to the next one
5. Stop when all features are done, a blocking error occurs, or failures exceed the threshold

### 4. Check progress at any time

```
/speckit-autopilot:status
```

---

## Brownfield flow

Use this flow when adding a feature to an existing codebase.

### 1. (Optional) Create `docs/product.md` or just describe the feature

### 2. Run ship-feature

```
/speckit-autopilot:ship-feature "user authentication"
```

Or without arguments to pick the next open backlog item:

```
/speckit-autopilot:ship-feature
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
/speckit-autopilot:resume-loop
```

The plugin reads `docs/autopilot-state.json` and `docs/iteration-log.md`
and resumes from the exact phase where work stopped.

The `SessionStart` hook also fires automatically after a compact and prints
the current state to help Claude Code orient itself.

---

## Commands reference

| Command | Description |
|---------|-------------|
| `/speckit-autopilot:bootstrap-product` | Parse `docs/product.md` → roadmap + backlog + state |
| `/speckit-autopilot:ship-product` | Ship all open features iteratively |
| `/speckit-autopilot:ship-feature [target]` | Ship one feature (greenfield or brownfield) |
| `/speckit-autopilot:resume-loop` | Resume after /compact or restart |
| `/speckit-autopilot:status` | Show current phase, backlog summary, last error |

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

## Hooks

| Hook | Trigger | Effect |
|------|---------|--------|
| `SessionStart` (matcher: `compact`) | After `/compact` | Prints resume state summary |
| `PreCompact` | Before compaction | Saves snapshot to iteration-log.md |
| `PostCompact` | After compaction | Updates compactCount in state |
| `TaskCompleted` | On task done | Blocks if acceptance criteria not met |

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
├── .claude-plugin/
│   └── plugin.json          # Plugin manifest
├── agents/                  # Agent definitions (markdown)
├── examples/
│   └── simple-demo/         # Example product with expected artifacts
├── hooks/
│   └── hooks.json           # Hook configuration
├── scripts/                 # Hook scripts (.mjs)
├── skills/                  # Skill definitions (markdown)
├── src/
│   ├── core/                # Business logic modules
│   └── cli/                 # CLI orchestration modules
├── tests/
│   ├── unit/                # Unit tests
│   └── integration/         # Integration tests
├── CHANGELOG.md
├── CLAUDE.md                # Operational rules for the plugin
└── README.md
```

---

## Coverage

The test suite enforces >= 90% coverage on all metrics (lines, functions, branches, statements).
Run `npm run test:coverage` to verify.

---

## License

MIT
