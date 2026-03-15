# speckit-autopilot: ai-review

> **Deprecated** — use `/audit` instead, which performs per-feature AI review against
> `docs/specs/{featureId}/spec.md` (more precise than comparing against the original spec).

Generate an AI-powered review of each feature's implementation vs the original spec document.

## Usage

```bash
speckit-autopilot ai-review --root . --spec $ARGUMENTS
```

For a more precise per-feature audit, use:
```bash
speckit-autopilot audit --root .
```
