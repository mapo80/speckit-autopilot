# speckit-autopilot: status

Print a concise status report: current phase, backlog summary, and recent log entries.

## Usage

```bash
speckit-autopilot status --root .
```

Then show the output to the user.

## What it shows

- Mode (greenfield / brownfield) and overall status
- Active feature and current phase
- Next feature in queue
- Consecutive failure count
- Last test run, coverage, lint result
- Backlog summary (open / in-progress / done / blocked / total)
- Last 10 lines of `docs/iteration-log.md`
