# speckit-autopilot: resume-loop

Resume interrupted autopilot work after a `/compact`, session restart, or manual pause.
The `ship` command is idempotent and automatically resumes — this skill is a convenience alias.

## Usage

```bash
speckit-autopilot ship --root .
```

Then show the output to the user.

## How it works

`ship` always reads `docs/autopilot-state.json` and `docs/product-backlog.yaml` first.
It resets any features stuck in `in_progress` back to `open` and resumes from the next open feature.
No data is lost between runs.

## Check current state first

```bash
speckit-autopilot status --root .
```
