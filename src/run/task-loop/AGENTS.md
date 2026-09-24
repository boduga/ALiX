# DOX — Task loop

**Purpose:** `runTaskLoop` — the agent's main iteration loop (model turn → tool
dispatch → verification/repair → completion). Extracted from the former
`../task-loop.ts` megafile (#717); `../task-loop.ts` is now a re-export barrel so
existing import paths are unchanged.

**Ownership:**
- `session-lifecycle.ts` — `completeSession`, `maybeEmitRotRisk`, context-budget
  overflow classification/summaries, `getHistoricalSuggestions`,
  `persistSessionState`, `RESEARCH_LIMITS`.
- `predicates.ts` — completion/evidence predicates and pure helpers:
  `emitAgent`, `buildShedToolRetryMessage`, `buildUnconfirmedDonePrompt`,
  `buildSynthesisReprompt`, `explicitMutationTargets`,
  `isContinuationMessage`, `objectiveEvidenceRequirements`,
  `objectiveEvidenceGaps`, `missingEvidenceSummary`,
  `lastToolResultShowsClientError`, `latestToolFailure`,
  `durableCompletionSummary`, `claimsArtifactWritten`, `extractErrors`,
  `COORDINATION_RUN_TOOL_NAME` and their constants/types.
- `context-helpers.ts` — context assembly helpers: `classifyMessageToCategory`,
  `classifyCandidateContext`, `reconstructRequest`, `sourceIndexOf`,
  `toBudgetedItems`, `evaluatePattern`.
- `context-phase.ts` — `assembleBudgetedContext`: budget admission gate
  (assembly + tool-schema reservation + T6 context events + preflight).
- `verification-phase.ts` — `runIterationVerification`: end-of-iteration
  verification + repair loop (returns an `earlyReturn` RunResult on repair limit).
- `execution-state-phase.ts` — `initExecutionStateEmission`: opt-in
  (`ALIX_EXECUTION_STATE_EMIT=1`) bootstrap + objective emission through the
  `ExecutionStateEmitter`; inert/fail-soft otherwise.
  `createExecutionStateEmitter` builds the session-level instance,
  `reconcileTurnArtifacts(emitter, log, cursor)` registers a turn's
  `artifact.created` events afterwards, `emitTurnShadow` builds the bounded
  shadow prompt per invocation and records the token delta as
  `context.shadow.assembled` (never sent), and `buildLiveSendRequest`
  builds the research-only live-send request (state prompt + task cue,
  top-2 prior turns as evidence) when `ALIX_EXECUTION_STATE_SEND` is on.
  `initExecutionStateEmission` accepts an `existing` emitter so the loop and
  the session caller share one instance (threaded via
  `TaskLoopDeps.executionState`).
- `main.ts` — `TaskLoopDeps` + `runTaskLoop` orchestrator.

**Local Contracts:**
- `../task-loop.ts` re-exports the public surface (`runTaskLoop`, `TaskLoopDeps`,
  `emitAgent`, `buildShedToolRetryMessage`, `explicitMutationTargets`,
  `isContinuationMessage`, `objectiveEvidenceRequirements`,
  `lastToolResultShowsClientError`, `latestToolFailure`,
  `durableCompletionSummary`, `claimsArtifactWritten`); do not add logic there.
- All modules ≤ 1,500 lines; `main.ts` is the orchestrator and must stay ≤ 1,500
  (extract phases rather than inlining).
- `runTaskLoop`'s body is written at **column 0** (unindented), so
  `grep '^function|^const'` over-reports inner statements as top-level — do not
  slice this file by that grep.
- Relative imports: `../../` → `src/`, `../` → `src/run/`.
- Execution-state emission is opt-in and fail-soft: `runTaskLoop` calls
  `initExecutionStateEmission` once at start; it must never throw into the loop
  and must not change behavior when `ALIX_EXECUTION_STATE_EMIT` is unset.
- Explicit coordinated-worker objectives require a successful
  `coordination.run` tool result before completion. A synthesis prompt must
  never assert that work is complete; missing objective evidence terminates as
  `completed_unverified` after bounded retries.
- The last-attempt `coordination.run` outcome gates completion INDEPENDENTLY
  of objective-text matching: `runTaskLoop` tracks a per-invocation
  `coordinationRunFailed` flag (set on error, cleared by a later success) and
  every completed-status emission consults it — Path A trust gate and
  trackCompleted via `objectiveEvidenceGaps(..., { coordinationRunFailed })`,
  verification-pass Path B via an explicit bounded-retry gate
  (`source: "coordination_failed"`), shell-complete and research-limit
  returns via a conditional `completed_unverified` reason. A failed run must
  never surface `task.done` / `graph.completed` / `workflow.completed` /
  `session.ended: completed`.

**Verification:**
- `tests/run/*.vitest.ts`, `tests/providers/task-loop-truncation.vitest.ts`,
  `tests/runtime/parallel-tool-execution.vitest.ts`,
  `tests/events/token-calibration.vitest.ts`, `tests/tracing/*.vitest.ts`,
  `tests/execution-state-emitter.vitest.ts` (emitter phase),
  `tests/execution-state-phase.vitest.ts` (shared instance, turn reconcile,
  shadow emit, live-send request).
