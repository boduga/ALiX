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
  `emitAgent`, `buildShedToolRetryMessage`, `explicitMutationTargets`,
  `isContinuationMessage`, `objectiveEvidenceRequirements`,
  `objectiveEvidenceGaps`, `missingEvidenceSummary`,
  `lastToolResultShowsClientError`, `latestToolFailure`,
  `durableCompletionSummary`, `claimsArtifactWritten`, `extractErrors`, and
  their constants/types.
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

**Verification:**
- `tests/run/*.vitest.ts`, `tests/providers/task-loop-truncation.vitest.ts`,
  `tests/runtime/parallel-tool-execution.vitest.ts`,
  `tests/events/token-calibration.vitest.ts`, `tests/tracing/*.vitest.ts`,
  `tests/execution-state-emitter.vitest.ts` (emitter phase).
