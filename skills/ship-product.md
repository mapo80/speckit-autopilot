# speckit-autopilot: ship-product

Iteratively implement every open feature in `docs/product-backlog.yaml` using
the full Spec Kit workflow, one feature at a time, until:
- all features are `done`, OR
- an unresolvable blocking error occurs, OR
- consecutive failures exceed `maxFailures` (default 3)

**This skill is idempotent and resumable.** It reads state from files, not chat history.

## Pre-flight checks

1. If `docs/product-backlog.yaml` does NOT exist → invoke `/speckit-autopilot:bootstrap-product` first
2. If `docs/autopilot-state.json` does NOT exist → same as above
3. Detect Spec Kit: check `specify --version` or `.speckit/` directory
   - If missing: run `specify init . --ai claude --ai-skills`

## Main loop (repeat until done or blocked)

For each iteration:

1. **Pick next feature**: Read backlog, find next `status: open` feature ordered by:
   - `priority` (high → medium → low)
   - `dependsOn` (only pick features whose dependencies are all `done`)
   - Preserve original order within same priority tier

2. **Update state**: Set `activeFeature`, `currentPhase: spec`, `status: in_progress`
   in both `docs/autopilot-state.json` and the backlog entry

3. **Create feature branch**: `git checkout -b feature/{feature-id}`
   (skip if branch already exists – resume scenario)

4. **Run Spec Kit workflow** (in order):
   a. `/speckit.constitution` – only if `.speckit/constitution.md` is missing
   b. `/speckit.specify` – create spec for this feature
   c. `/speckit.clarify` – resolve ambiguities
   d. `/speckit.plan` – create implementation plan
   e. `/speckit.tasks` – generate task list
   f. `/speckit.analyze` – technical analysis
   g. `/speckit.implement` – write the code

   After each phase: update `currentPhase` in `autopilot-state.json`

5. **QA gate**: Invoke the `qa-gatekeeper` agent
   - Run lint, tests, coverage
   - Update `lastLintPassed`, `lastTestsPassed`, `lastCoverage` in state
   - If gate FAILS: increment `consecutiveFailures`, log error, retry this feature
     - After `maxFailures` attempts: mark feature `blocked`, move to next

6. **On success**:
   - Mark feature `status: done` in backlog
   - Reset `consecutiveFailures` to 0
   - Update `docs/roadmap.md` (mark feature done)
   - Append entry to `docs/iteration-log.md`
   - Update `autopilot-state.json` (`activeFeature: null`, `status: running`)
   - Commit: `git commit -m "feat: implement {feature-title} [speckit-autopilot]"`

7. Loop back to step 1

## Completion

When backlog has no more open features:
- Set `status: completed` in `autopilot-state.json`
- Print final summary: features shipped, total time, coverage

## Error handling

- Catch and log all errors to `lastError` in `autopilot-state.json` and `iteration-log.md`
- Never silently swallow errors
- If a Spec Kit command is not available, fall back to inline implementation guided by the spec
