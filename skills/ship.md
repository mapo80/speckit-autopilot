# speckit-autopilot: ship

Implement features: all open features or a specific one by ID/title.
Safe to re-run — automatically resumes after interruption or /compact.

## Arguments

`$ARGUMENTS` — optional feature ID (e.g. `F-003`) or title substring.
If not provided, ships all open features in dependency + priority order.

## Usage

All open features:
```bash
speckit-autopilot ship --root .
```

Single feature by ID:
```bash
speckit-autopilot ship --root . --feature F-001
```

Single feature by title substring (case-insensitive):
```bash
speckit-autopilot ship --root . --feature "payment gateway"
```

Then show the JSON output to the user. If the command fails, show the full error.

## What it does

For each feature (one or all):
1. Detects greenfield vs brownfield automatically (checks for existing src/ files and deps)
2. In brownfield: generates `docs/brownfield-snapshot.md` if not already present
3. Runs the full Spec Kit workflow: spec → plan → tasks → implement
4. Runs the QA gate (lint, tests, coverage) — skipped gracefully if no package.json
5. Marks the feature done and moves to the next
6. Stops when all features are done, or consecutive failures exceed the threshold (default: 3)

## Return value

All features: `{ success, completed, failed, blocked, finalStatus, iterations }`
Single feature: also includes `featureId`, `featureTitle`, `mode`, `brownfieldSnapshotWritten`, `coverage`

`finalStatus` values:
- `"completed"` — all features done (or single feature succeeded)
- `"failed"` — single feature failed
- `"empty_backlog"` — no features in backlog
- `"no_open_features"` — all features already done or blocked
- `"blocked"` — a feature is blocked by unmet dependencies

## Prerequisites

- `docs/product-backlog.yaml` must exist — run `generate` + `bootstrap` first
- `docs/tech-stack.md` (optional) — improves code generation for your specific stack

## Monitoring

While running, check progress with:
```bash
speckit-autopilot status --root .
```
