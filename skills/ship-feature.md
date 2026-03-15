# speckit-autopilot: ship-feature

Implement a single feature. Works for both greenfield and brownfield repositories.

## Arguments

`$ARGUMENTS` — feature ID (e.g. `F-003`) or title substring.
If not provided, picks the next open feature from the backlog.

## Usage

```bash
speckit-autopilot ship-feature --root . --feature $ARGUMENTS
```

If no argument was given (no feature target):
```bash
speckit-autopilot ship-feature --root .
```

Then show the JSON output to the user. If the command fails, show the full error.

## What it does

1. Detects greenfield vs brownfield (checks for existing src/ files and deps)
2. In brownfield: generates `docs/brownfield-snapshot.md` (tech stack, conventions)
3. Runs the full Spec Kit workflow for the feature: spec → plan → tasks → implement
4. Runs the QA gate and marks the feature done

Returns JSON: `{ success, featureId, featureTitle, mode, coverage }`.
