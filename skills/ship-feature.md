# speckit-autopilot: ship-feature

Implement a single feature using the full Spec Kit workflow.
Works for both **greenfield** and **brownfield** repositories.

## Arguments

The skill accepts an optional feature target:
- If provided as text (e.g. `/speckit-autopilot:ship-feature "user authentication"`):
  look up the matching feature in the backlog by title or ID
- If not provided: pick the next open feature from `docs/product-backlog.yaml`
- If `docs/product-backlog.yaml` does not exist: treat as a standalone brownfield feature
  using the user's description

## Brownfield detection

A repo is brownfield if ANY of these is true:
- There are existing source files (src/, lib/, app/) with non-trivial content
- There is a package.json / Cargo.toml / go.mod / pyproject.toml with dependencies
- There is a git history with more than 1 commit

If brownfield:
1. Invoke the `brownfield-analyst` agent to inspect the repo
2. Write/update `docs/brownfield-snapshot.md`
3. Update `autopilot-state.json` with `mode: brownfield`

## Workflow

1. Detect greenfield vs brownfield (see above)
2. Resolve the target feature (from backlog or user input)
3. If greenfield and no backlog: run `/speckit-autopilot:bootstrap-product` first
4. Mark feature `in_progress` in backlog and state
5. Run Spec Kit workflow:
   a. `/speckit.constitution` – only if missing
   b. `/speckit.specify`
   c. `/speckit.clarify`
   d. `/speckit.plan`
   e. `/speckit.tasks`
   f. `/speckit.analyze`
   g. `/speckit.implement`
6. Run QA gate via `qa-gatekeeper` agent
7. On pass: mark feature `done`, update state and log
8. On fail: log error, update state, print actionable feedback

## Brownfield-snapshot.md format

```markdown
# Brownfield Snapshot

Generated: {ISO_DATE}

## Tech Stack
{DETECTED_STACK}

## Existing Modules
{MODULE_LIST}

## Entry Points
{ENTRY_POINTS}

## Test Framework
{TEST_FRAMEWORK}

## Relevant Conventions
{CONVENTIONS}

## Integration Points for Feature: {FEATURE_TITLE}
{INTEGRATION_NOTES}
```

## Notes

- Do NOT overwrite existing tests unless explicitly approved
- Do NOT refactor code outside the scope of the feature
- Update `docs/brownfield-snapshot.md` only with facts derived from the current repo state
