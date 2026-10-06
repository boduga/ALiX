# DOX — Task loop

## Purpose

 `runTaskLoop` — the agent's main iteration loop (model turn → tool
dispatch → verification/repair → completion). `../task-loop.ts` is a re-export
barrel preserving public import paths.

## Ownership

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
  `COORDINATION_RUN_TOOL_NAME` and their constants/types. It also owns the
  loop-side `buildSelectionObservation` wrapper and the loop's
  `SelectionObservation` view, narrowed from the canonical observation type to
  require a scoper ranking. Add fields to
  `src/observability/tool-selection-observation.ts`, narrow here, and explicitly
  forward them in `emitSelectionObservation`; its field-by-field emission can
  otherwise omit fields accepted by its parameter type.
- `context-helpers.ts` — context assembly helpers: `classifyMessageToCategory`,
  `classifyCandidateContext`, `reconstructRequest`, `sourceIndexOf`,
  `toBudgetedItems`, `evaluatePattern`.
- `context-phase.ts` — `assembleBudgetedContext`: budget admission gate
  (assembly + tool-schema reservation + context events + preflight).
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

## Local Contracts

- **Pattern store path derives from the session path shape.** `evaluatePattern`
  records outcomes at `<root>/.alix/patterns`, the store the governance CLI
  (`src/cli/commands/governance/main.ts`) and the context compiler
  (`src/repomap/context-compiler.ts`) read. The root is derived by locating
  `.alix/sessions` inside the resolved `sessionDir`, never by counting `..`
  segments: `sessionDir` is `<root>/.alix/sessions/<id>`, and a mis-counted
  relative chain writes a second `.alix` tree inside the sessions directory.
  When `sessionDir` does not match that shape the pattern write is skipped;
  the `context.pattern_evaluated` outcome event still appends with
  `patternRecorded: false` and `patternSkipReason: "sessionDir not under
  .alix/sessions"` (recorded path sets `patternRecorded: true`).
- **Resolve telemetry against the offered surface.** `resolveToolExecutionName`
  labels hooks, evidence, and selection observations; `handleToolCall` in
  `src/run/event-handlers.ts` performs dispatch. Both use
  `resolveExecutableToolName` over
  `buildOfferedExecutableTools(wireTools, mcpToolIndex)`, never the
  relevance-truncated `selectedTools` list. The call site is pinned by
  `tests/run/task-loop-shed-tool.vitest.ts` with an empty selector list.
- **Keep callable and dispatch identities separate.** `toolCall.name` and
  `usedTools` hold exact model-facing names. `isCompletionToolName` checks that
  vocabulary; runtime trace consumers use `isCompletionExecName`. Resolution
  must not rewrite the original call. See
  `tests/agents/exact-tool-name-resolver.vitest.ts`.
- `../task-loop.ts` re-exports the public surface; do not add logic there.
- Keep every module, including the orchestrator `main.ts`, within 1,500 lines;
  extract phases rather than inlining.
- The unindented `runTaskLoop` body contains inner statements at column zero;
  do not infer top-level declarations from indentation alone.
- Relative imports: `../../` → `src/`, `../` → `src/run/`.
- Execution-state emission is opt-in and fail-soft.
  `initExecutionStateEmission` runs once at loop start and must not throw into
  the loop or change behavior when `ALIX_EXECUTION_STATE_EMIT` is unset.
- Explicit coordinated-worker objectives require `alix_coordination_run`
  evidence and worker outcomes. A successful invocation alone is insufficient:
  resolve its run identity and require terminal execution, generated aggregate,
  known outcome, and matching verification evidence. Missing objective evidence
  yields `completed_unverified` after bounded retries; synthesis prompts must
  not assert completion before evidence exists.
- **Mutation evidence is outcome-based and tri-state.** `isMutationEvidence`
  rejects explicit `changed: false` and empty `changedFiles`, including identical
  `alix_file_create` content and no-op `alix_patch_apply` calls. Absent `changed`
  remains undecided and counts, including `alix_file_delete` results.
  `src/run/event-handlers.ts` and `successfulToolEvidence.push` preserve the flag
  unchanged. See `tests/run/mutation-evidence.vitest.ts`.
- Verification runs against `deps.cwd`, the actual agent working tree, never a
  literal dot or stash-hidden edits. See `src/skills/AGENTS.md`.
- **Verification detection is independent of mutation.** Negated verification
  cancels the requirement; a later affirmative overrides negation. Do not OR
  those clauses or require a mutation verb. See
  `tests/run/verification-detection.test.ts`.
- Objective requirement detection normalizes model-facing tool names before
  matching action words. `alix_verify_claim` counts as verification after
  mutation, as does a shell command matching `VERIFICATION_COMMAND_RE`.
- Tool-result echoes are not synthesis. Re-prompt once, then terminate
  `completed_unverified` with a tool-result-echo rejection reason if the echo
  persists. A short quotation within substantive prose stays accepted.
- Tool-selection instrumentation records the frozen offered surface, chosen
  candidate, resolved executor, and separate novelty, execution, and evidence
  signals in `tool.selection.observed`. Novel successful output does not prove
  usefulness; contribution labels require trace review. Instrumentation must
  not drive deterministic gates. Alternative selectors need recorded-state
  replay; capability-applicable subsets are not separately tracked. Do not add
  a selection decision type without an engine and justified experiment.
- `surfaceGapsForTurn` distinguishes reachable-but-deprioritized scoper gaps
  from absent-upstream tools. `renderSurfaceBlockNotice` emits a surface
  constraint before the first model turn only for absent-upstream gaps; never
  misreport a reachable tool as unavailable. `buildReadOnlyToolFilter` in
  `src/run/helpers.ts` is the single derivation shared with legacy and session
  routes.
- Freeze the actual scoped core + extended surface, including admitted MCP
  entries, once per scope with `freezeToolCandidates`. Use `candidateId` for
  offered/ranking/scoping/requirements/chosen identities; bounded sanitized
  descriptors cannot carry opaque handles into projections. Handles remain in
  local-only `candidateBindings`. Duplicate offered names collapse; distinct
  names sharing an identity fail closed.
- Recorded ranking keeps `scoper` relevance ordering and `mcpSelector` scores
  separate; neither is a deterministic next-tool baseline and scores are never
  interleaved.
- Scoper ranking uses content-token IDF plus English `FUNCTION_WORDS` filtering
  in `src/config/tool-scoping.ts`. Non-English surfaces degrade to IDF without
  changing admission. Weighting affects ranking only: admission remains raw
  token overlap. `tests/config/tool-scoping-ranking.vitest.ts` pins exact parity.
- Final prose promising another agent action is continuation. Re-prompt within
  existing bounds; persistent promises terminate `completed_unverified`.
- `coordinationUnverified` tracks the latest coordination call's error or
  unverified run, independently of objective text, and clears only after a
  verified run. All completion routes consult it: objective evidence gates,
  verification-pass retries, shell completion, and research-limit returns.
  Failed or unverified coordination cannot emit completed task, graph,
  workflow, or session state.

## Work Guidance

- Add phases to their owning modules; keep the orchestrator and public barrel thin.
- Update observation forwarding, evidence gates, and their regression coverage
  together when changing tool-result or completion contracts.

## Verification

- `tests/run/*.vitest.ts`, `tests/providers/task-loop-truncation.vitest.ts`,
  `tests/runtime/parallel-tool-execution.vitest.ts`,
  `tests/events/token-calibration.vitest.ts`, `tests/tracing/*.vitest.ts`,
  `tests/execution-state-emitter.vitest.ts` (emitter phase),
  `tests/execution-state-phase.vitest.ts` (shared instance, turn reconcile,
  shadow emit, live-send request).

## Child DOX Index

None.
