# speckit-autopilot: resume-loop

Resume interrupted autopilot work after a `/compact`, session restart, or manual pause.
**Source of truth is the file system, not chat history.**

## Resume algorithm

1. Read `docs/autopilot-state.json`
   - If missing or `status: completed`: print message and stop
   - If `status: bootstrapped` and no active feature: jump to ship-product main loop

2. Read `docs/product-backlog.yaml`
   - Identify the feature with `status: in_progress` (if any)
   - Cross-check with `activeFeature` in state; state wins on conflict

3. Read `docs/iteration-log.md`
   - Find the last logged phase for the active feature
   - Cross-check with `currentPhase` in state

4. Print a resume banner:
   ```
   === speckit-autopilot RESUME ===
   Active feature : {activeFeature}
   Current phase  : {currentPhase}
   Resuming from  : {resolvedPhase}
   Failures so far: {consecutiveFailures}/{maxFailures}
   Last error     : {lastError}
   ================================
   ```

5. Resume Spec Kit workflow from the correct phase:
   - `spec`      → start from `/speckit.specify`
   - `clarify`   → start from `/speckit.clarify`
   - `plan`      → start from `/speckit.plan`
   - `tasks`     → start from `/speckit.tasks`
   - `analyze`   → start from `/speckit.analyze`
   - `implement` → start from `/speckit.implement`
   - `qa`        → re-run QA gate only
   - `done`      → feature was done, move to next

6. Continue the main loop from `ship-product` after resuming the current feature

## Edge cases

- If `consecutiveFailures >= maxFailures`: mark feature `blocked`, move to next
- If the feature branch does not exist: recreate it from the last known commit or main
- If Spec Kit artifacts (specs, tasks) are missing for the active feature:
  restart that feature from phase `spec`
- If `autopilot-state.json` is corrupted: print error, suggest running bootstrap again

## Compaction safety

This command is specifically designed to work immediately after `/compact`.
It reads only from files — never from conversation context.
The `session-start-compact` hook calls `render-active-state.mjs` first;
`resume-loop` then re-reads the same files for full workflow resumption.
