# speckit-autopilot: coverage-report

Generate a static coverage report comparing planned tasks against generated files.
Detects critical structural gaps (missing .csproj, pubspec.yaml, package.json, .sln, etc.).

## Usage

```bash
speckit-autopilot coverage-report --root .
```

Then show the output and tell the user where the report was written.

## What it produces

`docs/coverage-report.md` containing:
- **Structural gaps (critical)** — project config files missing that would prevent builds
- **Structural gaps (warnings)** — non-critical missing files
- **Feature coverage table** — task count vs file count per feature
- **Full source file list** grouped by extension

## Next step

For a deeper semantic analysis of what is missing vs the original spec, run `/ai-review`.
