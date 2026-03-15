# speckit-autopilot: audit

Run a full quality audit of the project: validate product.md structure, backlog consistency,
structural gaps, and an AI review of each implemented feature against its spec.

## Arguments

`$ARGUMENTS` — optional path to the original spec file (not required — audit uses the generated
specs in docs/specs/{featureId}/spec.md as source of truth).

## Usage

```bash
speckit-autopilot audit --root .
```

Then show the output and tell the user where the report was written (`docs/audit-report.md`).

## What it does

1. **Generate audit** — validates `docs/product.md` (feature count, acceptance criteria, delivery order)
2. **Bootstrap audit** — validates `docs/product-backlog.yaml` (schema, count consistency, criteria)
3. **Structural gaps** — detects missing build-critical files (.csproj, pubspec.yaml, package.json, .sln)
4. **Feature audits** — for each done feature, calls Claude with `spec.md + tasks.md + generated files`
   and writes `docs/specs/{featureId}/audit.md` with: ✓ Complete / ⚠ Gaps / 🔧 Recommendations / Score

## Output

- `docs/audit-report.md` — aggregated report with all checks
- `docs/specs/{featureId}/audit.md` — per-feature detail (one per implemented feature)

Results are written incrementally — safe to interrupt and resume.

## Note

This command is automatically called inside `generate`, `bootstrap`, and after each feature
in `ship`. Running it standalone produces a full retroactive audit of all done features.
