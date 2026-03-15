# speckit-autopilot: ai-review

Generate an AI-powered semantic review of each feature's implementation
compared to the original specification document.

## Arguments

`$ARGUMENTS` — path to the original spec file.
If not provided, the command will look for the default spec in `docs/`.

## Usage

```bash
speckit-autopilot ai-review --root . --spec $ARGUMENTS
```

If no spec path was provided:
```bash
speckit-autopilot ai-review --root .
```

Then show the output and tell the user where the report was written.

## What it produces

`docs/ai-review-report.md` containing per-feature analysis grouped by domain
(Backend / Frontend / Mobile / Other):
- ✓ What appears complete
- ⚠ Gaps and missing pieces
- 🔧 Recommended next steps

The command writes results incrementally — partial output is saved even if it is interrupted.

## Prerequisites

Run `/coverage-report` first to have the static gap analysis as context.
Requires either `ANTHROPIC_API_KEY` (SDK mode) or `claude` CLI in PATH.
