# speckit-autopilot Plugin – Operational Rules

## Source of Truth
State is always read from files, never from chat history:
- `docs/autopilot-state.json` – current phase, active feature, failure counts
- `docs/product-backlog.yaml` – backlog with per-feature status
- `docs/iteration-log.md` – chronological log of all events

## After /compact or Session Resume
Always run `/speckit-autopilot:resume-loop` (or the hook fires automatically).
Do NOT reconstruct state from conversation context.

## Feature Workflow Order
For every feature, run Spec Kit phases in this exact order:
1. `/speckit.constitution` (only if `.speckit/constitution.md` is missing)
2. `/speckit.specify`
3. `/speckit.clarify`
4. `/speckit.plan`
5. `/speckit.tasks`
6. `/speckit.analyze`
7. `/speckit.implement`

Then run the `qa-gatekeeper` agent before marking any feature done.

## Gating Rules
A feature is `done` only when ALL of the following pass:
- Lint passes
- All tests pass
- Coverage >= configured threshold (if set)
- All acceptance criteria items are `done`

## Failure Handling
- On any phase failure: increment `consecutiveFailures` in state
- After `maxFailures` (default 3) consecutive failures: mark feature `blocked`, advance to next
- Always log errors to `docs/iteration-log.md` and `lastError` in state

## Scope Discipline
- One feature at a time; never implement two features simultaneously
- Do NOT refactor code outside the current feature's scope
- Do NOT modify existing tests unless explicitly approved

## Spec Kit Detection
Before any implementation step, verify Spec Kit is available:
- `specify --version` or check `.speckit/` directory
- If missing, suggest: `specify init . --ai claude --ai-skills`

## Language
All code, comments, method names, class names, and documentation must be in English.
