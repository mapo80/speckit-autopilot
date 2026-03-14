# speckit-autopilot: status

Print a concise status report of the current autopilot session.

## Output format

```
=== speckit-autopilot STATUS ===

Mode          : {greenfield|brownfield}
Overall status: {bootstrapped|running|completed|blocked|error}

Active feature : {featureId} – {featureTitle}
Current phase  : {phase}
Next feature   : {featureId} – {featureTitle}

Failures       : {consecutiveFailures}/{maxFailures}
Last error     : {lastError}

Test results   : {lastTestRun} – {pass|fail}
Coverage       : {lastCoverage}%
Lint           : {lastLintPassed ? "pass" : "fail"}

--- Backlog summary ---
  Open       : {count}
  In progress: {count}
  Done       : {count}
  Blocked    : {count}
  Total      : {count}

--- Recent iteration log (last 5 entries) ---
{LOG_ENTRIES}

Compact count  : {compactCount}
Last compact   : {lastCompactAt}
================================
```

## Steps

1. Read `docs/autopilot-state.json`
2. Read and parse `docs/product-backlog.yaml` to count statuses
3. Read last 5 entries from `docs/iteration-log.md`
4. If any file is missing, show `(not found)` for that section
5. Print the report in the format above

## No side effects

This skill is read-only. It does not modify any file or trigger any workflow.
