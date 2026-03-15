# speckit-autopilot: ship-product

Implement all open features in the backlog, one at a time, until the product is complete.
Safe to re-run — automatically resumes from where it stopped after interruption or /compact.

## Usage

```bash
speckit-autopilot ship --root .
```

Then show the JSON output to the user. If the command fails, show the full error.

## What it does

For each open feature (in dependency + priority order):
1. Runs the full Spec Kit workflow: spec → plan → tasks → implement
2. Runs the QA gate (lint, tests, coverage) — skipped gracefully if no package.json
3. Marks the feature done and moves to the next
4. Stops when all features are done, or failures exceed the threshold (default: 3)

Returns JSON: `{ completed, failed, blocked, finalStatus }`.

## Prerequisites

- `docs/product-backlog.yaml` must exist — run `/bootstrap-product` first if missing
- `docs/tech-stack.md` (optional) — create to get idiomatic code generation for your stack

## Monitoring

While running, check progress with:
```bash
speckit-autopilot status --root .
```
