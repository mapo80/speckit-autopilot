# speckit-autopilot

A production-ready Claude Code plugin that orchestrates [Spec Kit](https://speckit.dev)
to autonomously ship full products and individual features, one spec at a time.

## Features

- **Greenfield mode** – read any spec file, generate a backlog, and implement every feature iteratively
- **Brownfield mode** – analyse an existing repo and implement a single targeted feature
- **CLI runner** – drives all Claude calls via `claude --print`; no API key or SDK required
- **Multi-language** – tech-stack aware: inject `.NET/C#`, `Flutter/Dart`, `React/TypeScript` or any stack via `docs/tech-stack.md`
- **Compaction-safe** – survives `/compact`, session restarts, and IDE reboots via file-based state
- **Spec Kit integration** – drives the full `/speckit.*` workflow per feature
- **Acceptance gating** – blocks completion if lint, tests, or coverage do not pass
- **Unified audit** – built-in QA loop at every stage: validate product.md, validate backlog, AI review per feature

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

# Install skills globally for Claude Code + create speckit-autopilot binary
bash install.sh
```

The `install.sh` script:
- copies skill definitions into `~/.claude/skills/`
- creates `~/.local/bin/speckit-autopilot` wrapper (add `~/.local/bin` to `PATH`)

Restart Claude Code (or open a new session) after running the script.

---

## Workflows

### Greenfield — new product from spec

```
┌──────────────────────────────────────────────────────────────────────┐
│                        GREENFIELD WORKFLOW                           │
└──────────────────────────────────────────────────────────────────────┘

  Your spec file (any format: .md, .txt, .pdf text)
         │
         ▼
  ┌──────────────────────┐
  │  generate            │  node run.mjs generate --spec ./spec.md
  └──────────┬───────────┘
             │  writes docs/product.md
             │  ┌──────────────────────────────────────────────┐
             │  │ CALL 1: extract feature manifest (JSON)      │
             │  │   → writes docs/feature-manifest.json        │
             │  │ CALL 2: guided generation (manifest as       │
             │  │   contractual checklist, up to 3 retries)    │
             │  │ AUDIT [static]: validate product.md          │
             │  │  - Vision section present?                   │
             │  │  - Feature count >= 5?                       │
             │  │  - Each feature has acceptance criteria?     │
             │  │  - Delivery Preference section present?      │
             │  │  - Manifest keywords found in product.md?    │
             │  └──────────────────────────────────────────────┘
             ▼
  ┌──────────────────────┐
  │  bootstrap           │  node run.mjs bootstrap
  └──────────┬───────────┘
             │  writes docs/product-backlog.yaml
             │          docs/roadmap.md
             │          docs/autopilot-state.json
             │  ┌─────────────────────────────────────────────┐
             │  │ AUDIT [static]: validate backlog            │
             │  │  - Feature count matches product.md?        │
             │  │  - All features have acceptanceCriteria?    │
             │  │  - autopilot-state.json created?            │
             │  └─────────────────────────────────────────────┘
             ▼
  ┌──────────────────────┐
  │  ship                │  node run.mjs ship
  └──────────┬───────────┘
             │
             │  ┌──────────────────────────────────────────────────────┐
             │  │  For each open feature (dependency order):           │
             │  │                                                      │
             │  │   spec → clarify → plan → tasks → analyze           │
             │  │                                  │                  │
             │  │                             implement               │
             │  │                                  │                  │
             │  │                            QA gate                  │
             │  │                     (lint / tests / cov)            │
             │  │                                  │                  │
             │  │                  pass ◄──────────┴──────► fail      │
             │  │                    │                      │         │
             │  │                mark done           retry (3x)       │
             │  │                    │               then block       │
             │  │                    │                                │
             │  │      ┌─────────────────────────────────────────┐   │
             │  │      │ AUDIT [AI]: per-feature review           │   │
             │  │      │  - spec.md vs implementation files       │   │
             │  │      │  - 1 Claude call → docs/specs/{id}/      │   │
             │  │      │    audit.md (informational, non-blocking)│   │
             │  │      └─────────────────────────────────────────┘   │
             │  └────────────────────────────────────────────────────┘
             ▼
  All features done
             │
             ▼
  ┌──────────────────────┐
  │  audit               │  node run.mjs audit   (optional standalone)
  └──────────┬───────────┘
             │  writes docs/audit-report.md
             │          docs/specs/{id}/audit.md  (per feature)
             ▼
  Review & iterate
```

**Shortcut — run generate + bootstrap + ship in one command:**
```bash
node run.mjs all --root /path/to/project --spec /path/to/spec.md
```

---

### Brownfield — add a feature to an existing repo

```
┌──────────────────────────────────────────────────────────────────┐
│                      BROWNFIELD WORKFLOW                         │
└──────────────────────────────────────────────────────────────────┘

  Existing codebase (src/ + deps already present)
         │
         ▼
  ┌──────────────────────────────┐
  │  ship-feature [F-ID]         │  node run.mjs ship-feature --feature F-003
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
                        │
              ┌─────────────────────────────────┐
              │ AUDIT [AI]: feature review       │
              │  - spec.md vs implementation     │
              │  - writes docs/specs/{id}/       │
              │    audit.md (informational)      │
              └─────────────────────────────────┘
```

---

### Quality Assurance Loop

The audit runs automatically at every stage — no manual invocation needed during normal operation.

```
┌─────────────────────────────────────────────────────────────────────┐
│                       QUALITY ASSURANCE LOOP                        │
└─────────────────────────────────────────────────────────────────────┘

  generate ──► [AUDIT static] product.md validation
                 - feature count, criteria presence, delivery order

  bootstrap ──► [AUDIT static] backlog consistency
                 - count match vs product.md, empty criteria check

  ship/ship-feature (per feature)
     ──► implement
     ──► QA gate (lint + tests + coverage)  ← BLOCKS on failure
     ──► [AUDIT AI] spec.md → file list     ← informational only
           writes docs/specs/{id}/audit.md

  audit (standalone)
     ──► re-run all static checks
     ──► structural gap detection (.sln, .csproj, pubspec.yaml, package.json)
     ──► AI review for each "done" feature
     ──► writes docs/audit-report.md (incrementally, interrupt-safe)
```

The AI audit is **informational**: it never blocks the gate and never increments the failure counter.
One Claude call per feature; for 19 features that adds ~20-40 min to `audit` standalone.

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
| `/audit` | Full quality audit → `docs/audit-report.md` |

### CLI commands (`node run.mjs` / `speckit-autopilot`)

| Command | Description | Key options |
|---------|-------------|-------------|
| `generate` | Read spec → `docs/product.md`, then audit product.md | `--spec <path>` (required) |
| `bootstrap` | Parse `docs/product.md` → backlog + state, then audit backlog | — |
| `ship` | Implement all open features, audit each after completion | — |
| `ship-feature` | Implement a single feature | `--feature F-001` (optional, picks next open if omitted) |
| `all` | `generate` + `bootstrap` + `ship` in sequence | `--spec <path>` (required) |
| `status` | Print current phase, backlog summary, recent log | — |
| `audit` | Full QA audit → `docs/audit-report.md` + per-feature `audit.md` | — |

**Global option:** `--root <path>` — target project directory (default: current directory)

```bash
# Examples
node run.mjs generate        --root ./my-project --spec ./requirements.md
node run.mjs bootstrap       --root ./my-project
node run.mjs ship            --root ./my-project
node run.mjs ship-feature    --root ./my-project --feature F-003
node run.mjs all             --root ./my-project --spec ./requirements.md
node run.mjs status          --root ./my-project
node run.mjs audit           --root ./my-project

# Or via the installed binary
speckit-autopilot ship         --root ./my-project
speckit-autopilot ship-feature --root ./my-project --feature F-003
speckit-autopilot audit        --root ./my-project
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
| `docs/product.md` | Input: product description + acceptance criteria |
| `docs/feature-manifest.json` | Generated by `generate`: feature titles extracted from spec; used as completeness checklist |
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
| `docs/specs/{id}/audit.md` | Generated per feature: AI review vs spec (Score 1-5) |
| `docs/audit-report.md` | Generated: full audit — generate + bootstrap + gaps + features |

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
│   ├── audit.md
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
│       ├── generate-product.ts  # two-call generate: manifest extraction + guided product.md
│       ├── audit.ts             # unified audit (generate + bootstrap + feature AI review)
│       ├── status.ts            # status printer
│       ├── coverage-report.ts   # static gap analysis
│       └── ai-review.ts         # AI semantic review per feature
├── tests/
│   ├── unit/
│   │   ├── audit.test.ts        # auditGenerate + auditBootstrap unit tests
│   │   └── ...
│   └── integration/
│       ├── audit-feature.test.ts  # auditFeature with injectable callClaude
│       └── ...
├── install.sh               # Installs skills + creates ~/.local/bin/speckit-autopilot
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
