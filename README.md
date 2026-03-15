# speckit-autopilot

A production-ready Claude Code plugin that orchestrates [Spec Kit](https://speckit.dev)
to autonomously ship full products and individual features, one spec at a time.

## Features

- **Greenfield mode** – read any spec file, generate a backlog, and implement every feature iteratively
- **Brownfield mode** – analyse an existing repo and implement a single targeted feature
- **Dual-mode runner** – uses `claude --print` CLI (default) or `@anthropic-ai/sdk` (when `ANTHROPIC_API_KEY` is set)
- **Multi-language** – tech-stack aware: inject `.NET/C#`, `Flutter/Dart`, `React/TypeScript` or any stack via `docs/tech-stack.md`
- **Compaction-safe** – survives `/compact`, session restarts, and IDE reboots via file-based state
- **Spec Kit integration** – drives the full `/speckit.*` workflow per feature
- **Acceptance gating** – blocks completion if lint, tests, or coverage do not pass
- **Coverage report** – static gap analysis: missing project files, task counts, file counts per feature
- **AI review** – semantic review of each feature against the original spec using Claude

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

## Workflows

### Greenfield — new product from spec

```
┌──────────────────────────────────────────────────────────────────┐
│                     GREENFIELD WORKFLOW                          │
└──────────────────────────────────────────────────────────────────┘

  Your spec file (any format)
         │
         ▼
  ┌─────────────────┐
  │  node run.mjs   │  or  /generate-product --spec ./my-spec.md
  │    generate     │
  └────────┬────────┘
           │  writes docs/product.md
           ▼
  ┌─────────────────┐
  │  node run.mjs   │  or  /bootstrap-product
  │   bootstrap     │
  └────────┬────────┘
           │  writes docs/product-backlog.yaml
           │          docs/roadmap.md
           │          docs/autopilot-state.json
           ▼
  ┌─────────────────┐
  │  node run.mjs   │  or  /ship-product
  │      ship       │
  └────────┬────────┘
           │
           │  ┌─────────────────────────────────────────────────┐
           │  │  For each open feature (dependency order):      │
           │  │                                                  │
           │  │   spec → clarify → plan → tasks → analyze       │
           │  │                                    │             │
           │  │                               implement          │
           │  │                                    │             │
           │  │                              QA gate             │
           │  │                         (lint / tests / cov)     │
           │  │                                    │             │
           │  │                    pass ◄──────────┴──────► fail │
           │  │                      │                      │    │
           │  │                  mark done              retry (3x)│
           │  │                      │                  then block│
           │  └──────────────────────┘                           │
           │                                                      │
           ▼                                                      │
  All features done  ◄─────────────────────────────────────────── ┘
           │
           ▼
  ┌─────────────────┐
  │  node run.mjs   │  Verify completeness
  │ coverage-report │
  └────────┬────────┘
           │  writes docs/coverage-report.md
           │  (structural gaps, task counts, file counts)
           ▼
  ┌─────────────────┐
  │  node run.mjs   │  Semantic gap analysis vs original spec
  │   ai-review     │
  └────────┬────────┘
           │  writes docs/ai-review-report.md
           ▼
  Review & iterate
```

**Shortcut — run all three setup steps in one command:**
```bash
node run.mjs all --root /path/to/project --spec /path/to/spec.md
```

---

### Brownfield — add a feature to an existing repo

```
┌──────────────────────────────────────────────────────────────────┐
│                    BROWNFIELD WORKFLOW                           │
└──────────────────────────────────────────────────────────────────┘

  Existing codebase (src/ + deps already present)
         │
         ▼
  ┌──────────────────────────────┐
  │  /ship-feature "feature name"│  or  node run.mjs ship --root .
  └──────────────┬───────────────┘
                 │
                 ▼
  ┌──────────────────────────────┐
  │  Detect brownfield           │
  │  (checks src/, package.json, │
  │   .csproj, pubspec.yaml …)   │
  └──────────────┬───────────────┘
                 │
                 ▼
  ┌──────────────────────────────┐
  │  Build brownfield snapshot   │
  │  docs/brownfield-snapshot.md │
  │  (tech stack, entry points,  │
  │   conventions, test setup)   │
  └──────────────┬───────────────┘
                 │
                 ▼
  ┌──────────────────────────────────────────────────────────┐
  │  Spec Kit phases (scoped to this feature):               │
  │                                                          │
  │   spec → clarify → plan → tasks → analyze → implement   │
  └──────────────────────────────┬───────────────────────────┘
                                 │
                                 ▼
                         ┌──────────────┐
                         │   QA gate    │
                         │ lint / tests │
                         │  / coverage  │
                         └──────┬───────┘
                      pass ◄────┴────► fail → error returned
                        │
                        ▼
                   feature done
                   (backlog updated)
```

---

## Commands reference

### Slash commands (Claude Code skills)

| Command | Description |
|---------|-------------|
| `/generate-product` | Read any spec file → `docs/product.md` |
| `/bootstrap-product` | Parse `docs/product.md` → roadmap + backlog + state |
| `/ship-product` | Ship all open features iteratively |
| `/ship-feature [target]` | Ship one feature (greenfield or brownfield) |
| `/resume-loop` | Resume after `/compact` or session restart |
| `/status` | Show current phase, backlog summary, last error |

### CLI commands (`node run.mjs`)

| Command | Description | Key options |
|---------|-------------|-------------|
| `generate` | Read spec → `docs/product.md` | `--spec <path>` (required) |
| `bootstrap` | Parse `docs/product.md` → backlog + state | — |
| `ship` | Implement all open features | — |
| `all` | `generate` + `bootstrap` + `ship` in sequence | `--spec <path>` (required) |
| `coverage-report` | Static gap analysis → `docs/coverage-report.md` | — |
| `ai-review` | AI semantic review → `docs/ai-review-report.md` | `--spec <path>` (optional) |

**Global option:** `--root <path>` — target project directory (default: current directory)

```bash
# Examples
node run.mjs generate        --root ./my-project --spec ./requirements.md
node run.mjs bootstrap       --root ./my-project
node run.mjs ship            --root ./my-project
node run.mjs all             --root ./my-project --spec ./requirements.md
node run.mjs coverage-report --root ./my-project
node run.mjs ai-review       --root ./my-project --spec ./requirements.md
```

---

## Tech-stack awareness

speckit-autopilot generates code in the correct language and framework by reading `docs/tech-stack.md` in the target project.

Create the file before running `ship` to get idiomatic code:

```markdown
# My Project Tech Stack

## Backend
- Language: C# 12 / .NET 10 (ASP.NET Core)
- ORM: Entity Framework Core with PostgreSQL
- Architecture: Clean Architecture — Domain / Services / Dal / Api
- Test framework: xUnit

## Frontend
- Framework: React 19 + TypeScript + Ant Design + Vite
- State: Redux Toolkit
- Source files: .tsx

## Mobile
- Framework: Flutter (Dart 3) + Riverpod
- Source files: .dart
```

If the file is absent, `TypeScript` is assumed.

---

## State files

All state is stored in the **target repo** (not the plugin directory):

| File | Purpose |
|------|---------|
| `docs/product.md` | Input: product description |
| `docs/tech-stack.md` | Input: language and framework hints |
| `docs/roadmap.md` | Generated: ordered feature roadmap |
| `docs/product-backlog.yaml` | Generated: machine-readable backlog |
| `docs/autopilot-state.json` | Runtime: current phase, failure counts, coverage |
| `docs/brownfield-snapshot.md` | Generated: tech stack and integration points |
| `docs/iteration-log.md` | Log: all events with file counts and QA details |
| `docs/specs/{id}/spec.md` | Generated per feature: specification |
| `docs/specs/{id}/plan.md` | Generated per feature: implementation plan |
| `docs/specs/{id}/tasks.md` | Generated per feature: task breakdown |
| `docs/specs/{id}/implementation-report.json` | Generated per feature: files changed + QA results |
| `docs/coverage-report.md` | Generated: structural gap analysis |
| `docs/ai-review-report.md` | Generated: AI semantic review |

---

## Resume after /compact or session restart

If Claude Code compacts the context or you restart the session:

```
/resume-loop
```

The plugin reads `docs/autopilot-state.json` and `docs/iteration-log.md`
and resumes from the exact phase where work stopped.

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
│   ├── generate-product.md
│   ├── ship-product.md
│   ├── ship-feature.md
│   ├── resume-loop.md
│   └── status.md
├── src/
│   ├── core/                # Business logic
│   │   ├── spec-kit-runner.ts   # SpecKitRunner, readTechStack
│   │   ├── acceptance-gate.ts   # lint / test / coverage / acceptance checks
│   │   ├── feature-picker.ts    # dependency-ordered feature selection
│   │   ├── backlog-schema.ts    # Zod schema for product-backlog.yaml
│   │   ├── state-store.ts       # autopilot-state.json read/write
│   │   └── compact-state.ts     # iteration-log.md append
│   └── cli/                 # CLI orchestration
│       ├── ship-product.ts      # full product ship loop
│       ├── ship-feature.ts      # single feature ship
│       ├── bootstrap-product.ts # backlog + state init
│       ├── coverage-report.ts   # static gap analysis
│       └── ai-review.ts         # AI semantic review
├── tests/
│   ├── unit/
│   └── integration/
├── install.sh               # Installs skills into ~/.claude/skills/
├── run.mjs                  # CLI entry point
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
