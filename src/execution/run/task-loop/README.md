# Task Loop

## Overview
`runTaskLoop` is the agent's main iteration loop: it assembles a budgeted context, calls the model, dispatches tools (serially or in parallel), runs end-of-iteration verification with a bounded repair loop, and decides completion. The orchestrator in `main.ts` stays thin; each phase lives in an owning module (`context-phase`, `verification-phase`, `completion-phase`, `pending-action-phase`, `session-lifecycle`, `execution-state-phase`), and the pure evidence/claim predicates live in `predicates.ts`. `../task-loop.ts` is a re-export barrel preserving public import paths.

## Interface
- `TaskLoopDeps`, `SelectionObservationContextKey`, `runTaskLoop(deps)` — the loop's dependency contract and entry point `[main.ts:runTaskLoop]`.
- `emitAgent` — appends an `actor: "agent"` event under the `<sessionId>-agent` log identity `[predicates.ts:emitAgent]`.
- `objectiveEvidenceRequirements`, `objectiveEvidenceGaps`, `SuccessfulToolEvidence`, `MUTATION_TOOL_NAMES`, `VERIFICATION_EVIDENCE_GAP`, `COORDINATION_EVIDENCE_GAP`, `COORDINATION_RUN_TOOL_NAME` — objective evidence model `[predicates.ts:objectiveEvidenceRequirements]`.
- `findUnsubstantiatedClaims`, `CLAIM_TOOL_MAP`, `CLAIM_TOOL_NAMES`, `explicitMutationTargets`, `hasExecutedActionTool`, `hasPendingAgentAction`, `isContinuationMessage`, `CONTINUATION_RE` — claim and continuation predicates `[predicates.ts:findUnsubstantiatedClaims]`.
- `buildUnconfirmedDonePrompt`, `buildSynthesisReprompt`, `buildShedToolRetryMessage`, `missingEvidenceSummary`, `durableCompletionSummary`, `latestToolFailure`, `latestToolResultContent`, `lastToolResultShowsClientError`, `toolResultFailureBody`, `toolResultBody`, `isToolResultEcho`, `extractErrors`, `claimsArtifactWritten`, `ARTIFACT_WRITE_RE` — bounded completion/repair prompt builders and result inspection helpers `[predicates.ts:buildUnconfirmedDonePrompt]`.
- `buildSelectionObservation`, `SelectionObservation`, `deriveSurfaceGaps`, `surfaceBlockedTheObjective`, `renderSurfaceBlockNotice`, `rankingOutsideOffered`, `unexplainedRequirementCandidates`, `buildRequirementCandidates`, `resolveToolExecutionName`, `isCompletionTool` — tool-selection observation and surface-gap derivation `[predicates.ts:buildSelectionObservation]`.
- `assembleBudgetedContext`, `AssembleContextParams`, `buildEffectiveSystemPrompt`, `injectProgressLedger` — context budget admission and prompt assembly `[context-phase.ts:assembleBudgetedContext]`.
- `classifyMessageToCategory`, `classifyCandidateContext`, `reconstructRequest`, `sourceIndexOf`, `toBudgetedItems`, `evaluatePattern` — context assembly helpers and pattern evaluation `[context-helpers.ts:evaluatePattern]`.
- `runIterationVerification`, `IterationVerificationParams` — end-of-iteration verification + repair `[verification-phase.ts:runIterationVerification]`.
- `runNoToolsCompletion`, `runDeferredCompletion`, `coordinationRunIsVerified`, `CompletionState`, `CompletionContext` — completion routes `[completion-phase.ts:runNoToolsCompletion]`.
- `gatePendingAgentAction` — shared bounded rejection of prose that promises unfinished operator-authorized work `[pending-action-phase.ts:gatePendingAgentAction]`.
- `completeSession`, `maybeEmitRotRisk`, `isIrreducibleContextBudgetOverflow`, `buildContextBudgetOverflowSummary`, `classifyIrreducibleKind`, `getHistoricalSuggestions`, `RESEARCH_LIMITS`, `persistSessionState` — terminal session lifecycle `[session-lifecycle.ts:completeSession]`.
- `RefineStrategyName`, `RefineStrategy`, `listStrategies`, `getStrategy`, `selectStrategy`, `applyStrategy`, `buildRefinePrompt` — repair refine strategies `[refine-strategies.ts:buildRefinePrompt]`.
- `RepairOutcome`, `classifyFailureType`, `getStrategyPerformance`, `recommendStrategy`, `getRecommendationConfidence` — learned repair-strategy selection `[strategy-learner.ts:recommendStrategy]`.
- `createExecutionStateEmitter`, `initExecutionStateEmission`, `reconcileTurnArtifacts`, `buildLiveSendRequest`, `SessionLogRef` — opt-in execution-state emission `[execution-state-phase.ts:initExecutionStateEmission]`.
- `refine-strategies` (template Markdown only, no contract file) — strategy bodies resolved module-relative.

## Invariants
- Verification requires a successful check *after* the latest mutation: `objectiveEvidenceGaps` compares ordinals and reports `VERIFICATION_EVIDENCE_GAP` when nothing verifies the change `[predicates.ts:objectiveEvidenceGaps]`.
- Verification detection is independent of mutation detection; a negated verification instruction cancels the requirement, and a later affirmative overrides the negation `[predicates.ts:objectiveEvidenceRequirements]`.
- Coordination evidence is required only when the objective names an execution subject or an execution verb next to `coordination`; a read noun (`coordination list|status|results`) never demands `coordination.run` `[predicates.ts:objectiveEvidenceRequirements]`.
- `coordinationRunIsVerified` fails closed unless all four facts hold: execution `completed`, aggregation `generated`, outcome known, verification `verified` `[completion-phase.ts:coordinationRunIsVerified]`.
- `latestToolFailure` reflects only the most recent tool result; a recovered failure must not mislabel a run, while durable mutation evidence still survives a later failed retry `[predicates.ts:latestToolFailure]`.
- Claim substantiation matches only literal first-person claims: entries carry explicit `excusedBy` model-facing `alix_*` names matched by direct set membership, never an executor-id translation `[predicates.ts:CLAIM_TOOL_MAP]`.
- `gatePendingAgentAction` retries only while under both `maxAttempts` and `maxIterations - 1`, and otherwise ends the turn `completed_unverified` `[pending-action-phase.ts:gatePendingAgentAction]`.
- `evaluatePattern` derives the pattern root from the `<root>/.alix/sessions/<id>` path shape; when the shape does not match it skips the registry write and records `patternRecorded: false` with a `patternSkipReason` `[context-helpers.ts:evaluatePattern]`.
- `persistSessionState` is best-effort: a save failure appends `session.state_persist_failed` instead of propagating `[session-lifecycle.ts:persistSessionState]`.
- `maybeEmitRotRisk` is a no-op when the threshold or context pressure is unset, and is advisory only — never a hard gate `[session-lifecycle.ts:maybeEmitRotRisk]`.
- `buildRefinePrompt` escalates to the `escalate` strategy at three or more repairs and otherwise consults the learned recommendation `[refine-strategies.ts:buildRefinePrompt]`.
- `selectStrategy` maps syntax→`simplify`, tests→`verify_only`, scope→`analyze`, bugfix→`decompose`, default→`retry` `[refine-strategies.ts:selectStrategy]`.
- `getStrategy` falls back to a built-in `retry` template when a strategy file cannot be loaded or parsed `[refine-strategies.ts:getStrategy]`.
- `RESEARCH_LIMITS` is fixed: quick `{ maxIterations: 3, maxSearchCalls: 3 }`, deep `{ maxIterations: 15, maxSearchCalls: 10 }` `[session-lifecycle.ts:RESEARCH_LIMITS]`.
- Execution-state emission is inert unless `ALIX_EXECUTION_STATE_EMIT=1`; `createExecutionStateEmitter` returns `null` when the flag is off `[execution-state-phase.ts:createExecutionStateEmitter]`.
- The shadow state prompt is assembled and recorded as `context.shadow.assembled` but never sent to the provider `[context-phase.ts:AssembleContextParams]`.
- Every completion route checks cancellation first and runs the pending-action gate before emitting terminal success `[completion-phase.ts:runNoToolsCompletion]`.

## Side Effects
- `completeSession` appends the terminal session event, reads the full event log, saves memory decisions (non-interactive by default), and evaluates the context pattern `[session-lifecycle.ts:completeSession]`.
- `maybeEmitRotRisk` appends one `context.rot_risk` event when the configured threshold is crossed `[session-lifecycle.ts:maybeEmitRotRisk]`.
- `persistSessionState` writes session state to `sessionDir` on every iteration and appends `session.state_persist_failed` on error `[session-lifecycle.ts:persistSessionState]`.
- `evaluatePattern` reads the session outcome and records it in `<root>/.alix/patterns`, then appends `context.pattern_evaluated` `[context-helpers.ts:evaluatePattern]`.
- `runIterationVerification` appends `verification.skipped` when policy blocks checks, and runs repository verification against the real `cwd` for changed files `[verification-phase.ts:runIterationVerification]`.
- `gatePendingAgentAction` appends `completion.claim_rejected` and pushes a corrective user message into the conversation when it retries `[pending-action-phase.ts:gatePendingAgentAction]`.
- The loop appends agent-scoped events through `emitAgent` under the `${sessionId}-agent` identity `[predicates.ts:emitAgent]`.
- `strategy-learner` reads repair history from `~/.config/alix/repair-history.jsonl` and falls back to heuristics when the file is absent or malformed `[strategy-learner.ts:getStrategyPerformance]`.
- `initExecutionStateEmission` bootstraps and sets the objective on the `ExecutionStateEmitter`; `reconcileTurnArtifacts` registers `artifact.created` events after the fact `[execution-state-phase.ts:initExecutionStateEmission]`.

## Verification
- Run: `pnpm test`
