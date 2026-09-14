# DOX — Task loop

**Purpose:** `runTaskLoop` — the agent's main iteration loop (model turn → tool
dispatch → verification/repair → completion). Extracted from the former
`../task-loop.ts` megafile (#717); `../task-loop.ts` is now a re-export barrel so
existing import paths are unchanged.

**Ownership:**
- `session-lifecycle.ts` — `completeSession`, `maybeEmitRotRisk`, context-budget
  overflow classification/summaries, `getHistoricalSuggestions`, `RESEARCH_LIMITS`.
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
- `main.ts` — `TaskLoopDeps` + `runTaskLoop`.

**Local Contracts:**
- `../task-loop.ts` re-exports the public surface (`runTaskLoop`, `TaskLoopDeps`,
  `emitAgent`, `buildShedToolRetryMessage`, `explicitMutationTargets`,
  `isContinuationMessage`, `objectiveEvidenceRequirements`,
  `lastToolResultShowsClientError`, `latestToolFailure`,
  `durableCompletionSummary`, `claimsArtifactWritten`); do not add logic there.
- **Pending (#717):** `runTaskLoop` itself (1,537 lines) is not yet decomposed;
  `main.ts` is therefore still above the 1,500-line orchestrator threshold. The
  mandatory method decomposition is a separate, behavior-preserving step.
- Much of `runTaskLoop`'s body is written at **column 0**, so
  `grep '^function|^const'` over-reports inner statements as top-level — do not
  slice this file by that grep.
- Relative imports: `../../` → `src/`, `../` → `src/run/`.

**Verification:**
- `tests/run/*.vitest.ts`, `tests/providers/task-loop-truncation.vitest.ts`,
  `tests/runtime/parallel-tool-execution.vitest.ts`,
  `tests/events/token-calibration.vitest.ts`, `tests/tracing/*.vitest.ts`.
