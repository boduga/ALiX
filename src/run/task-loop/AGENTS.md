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
  `COORDINATION_RUN_TOOL_NAME` and their constants/types. It also owns the
  loop-side `buildSelectionObservation` wrapper and the loop's
  `SelectionObservation` view — which is the canonical observation type
  NARROWED to require a scoper ranking, never a re-declaration. That
  re-declaration is what silently dropped `invalidSelection`: a field added to
  the observation reached the emitter but was erased by the local return type,
  so the loop never recorded an invalid selection. Add observation fields to
  `src/observability/tool-selection-observation.ts` and narrow here.
  `emitSelectionObservation` forwards context fields ONE BY ONE, so a new field
  must be added there as well: the `Pick` type accepts it and the runtime drops
  it otherwise. That has silently bitten three fields in a row —
  `invalidSelection`, the wrapper parameter, and `surfaceGaps`.
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
- **The completion tool has TWO vocabularies and this loop only ever holds the
  model-facing one.** `isCompletionTool` here is `isCompletionToolName` from
  `src/agents/tool-manifest.ts`, which matches the name the MODEL called. That is
  correct for every caller in this subsystem because the loop resolves to an
  executor id into a separate variable (`resolveToolExecutionName`) and never
  rewrites `toolCall`, so `toolCall.name` and `usedTools` entries are
  model-facing by construction. The predicate previously ALSO accepted the
  executor id — an arm that could never fire, and a dual-vocabulary acceptance
  the ONE vocabulary contract forbids. The executor-vocabulary surface (runtime
  trace titles, read by the TUI) uses `isCompletionExecName`; the two are
  separate exports precisely so a caller cannot silently hold the wrong one.
  Pinned by `tests/agents/exact-tool-name-resolver.vitest.ts`.
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
- Mutation evidence is judged by OUTCOME, not by tool name. `isMutationEvidence`
  accepts a mutation call only when it changed something: `file.create`'s
  `already_exists_identical` path reports `changed: false` and a `patch.apply`
  can resolve with empty `changedFiles`, so counting the tool NAME let an agent
  satisfy a mutation objective by rewriting a file with content it had already
  written — repeatedly, with no workspace change — and then declare completion.
  The flag is tri-state (`isMutationEvidence` + the loop's record at
  `successfulToolEvidence.push`): `true` wrote something, `false` is a proven
  no-op and is NOT evidence, ABSENT is undecided and still counts because
  `file.delete` never sets a flag. `src/run/event-handlers.ts` must pass
  `changed` through UNCHANGED — collapsing absent into `false` there starves
  this gate of the distinction and fails every legitimate delete. Pinned by
  `tests/run/mutation-evidence.vitest.ts`.
- Verification runs against `deps.cwd` (the agent's real working directory),
  never `"."`, and is never stash-isolated — see `src/skills/AGENTS.md`. A
  check that cannot see the change it verifies is not a verification.
- Verification detection is INDEPENDENT of mutation. It was `verification =
  mutation && <regex>`, which made a verification-only objective undetectable:
  "run the tests and confirm the suite passes" names no file-write verb, so no
  requirement existed, so the completion gate never demanded verification
  evidence and the task could close with zero tests executed (T3 finding 1,
  measured 0 of 8 verification scopes). Two guards keep the widened surface
  honest: a NEGATION guard ("do not run the tests", "without verifying", "never
  run the build") cancels the requirement, and a later AFFIRMATIVE ("…but
  verify the claim") overrides that negation — they must not be OR-ed, which is
  a slip that made the override deepen the decline instead of cancelling it.
  The regex is unchanged; only the precondition moved.
  `tests/run/verification-detection.test.ts` pins all four directions.
- Objective requirement detection scans a tool-name-normalized view of the
  task: exact model-facing names carry their action, and `\brun\b`/`\bverify\b`
  cannot match across the underscore of `alix_coordination_run` /
  `alix_verify_claim`. A successful `verify.claim` call counts as verification
  evidence after the mutation, alongside a shell command matching
  `VERIFICATION_COMMAND_RE`.
- A final answer that repeats the last tool result is not a synthesis: the loop
  re-prompts once (bounded) and otherwise terminates `completed_unverified`
  with `reason: "tool_result_echo"` recorded on `completion.claim_rejected`.
  Quoting a short result inside real prose stays accepted (the echo must
  dominate the answer or match it exactly).
- Tool-selection shadow instrumentation (T0-b): every executed call appends a
  `tool.selection.observed` event (`buildSelectionObservation`) recording the
  frozen candidate surface, the chosen candidate, the resolved executor, and three *separate*
  signals — `selection.outcome` (`novel` | `redundant` by executor+args
  signature), `execution.status` (`success` | `repaired` | `failed`), and
  `evidence.contribution` (`contributed` | `none` | `unknown`). Keeping them
  apart is deliberate: a novel successful call is not automatically useful, and
  `contributed` here only means "returned content, not a provable no-op" — real
  contribution is a labelling step over recorded traces. Nothing reads
  it — the deterministic gates decide as before. It scores the choice that RAN;
  ranking an alternative selector needs replay over recorded state
  (`src/decision/replay/*`, `src/runtime/replay-executor.ts`), and the
  capability-applicable subset is not tracked separately yet, so a scoping
  mistake cannot yet be distinguished from a ranking mistake. A
  `tool-selection` `DecisionType` is deliberately not added: `decision/config.ts`
  forces a route for every new type, and there is no selection engine to route
  to until the experiment justifies one.
- A surface that cannot offer a requirement-closing tool says so TO THE MODEL,
  not only to telemetry. `surfaceGapsForTurn` classifies each miss
  (`scoper-excluded` = reachable but deprioritised, `absent-upstream` = never a
  candidate), and `renderSurfaceBlockNotice` turns any `absent-upstream` gap into
  a `<surface_constraint>` message pushed before the first model turn. Without
  it the model cannot distinguish "impossible here" from "read the file
  instead": cohort `t3d-2026-09-28-c` measured 6 of 8 verification-shaped scopes
  answering "run pnpm typecheck:unused" by inspection, with no error and no
  statement that the check never ran. `scoper-excluded` is deliberately NOT
  surfaced — the tool was reachable, so telling the model it cannot run would be
  a false constraint. The read-only exclusion that causes this lives in
  `src/run/helpers.ts` (`buildReadOnlyToolFilter`), which is the single
  derivation shared with `agent-loop.ts` and `session/setup.ts`.
- The frozen surface is the surface the model was actually offered — scoped core
  + extended, which includes the MCP entries this task admitted — not the
  builtin-only provider list. It is frozen once per scope through
  `freezeToolCandidates` (`src/decision/tool-selection-candidates.ts`): identity
  is `candidateId` (`builtin:<name>`, `mcp:<short hash of the handle>`),
  descriptors are sanitized and bounded, and an MCP handle appears ONLY in the
  local-only `candidateBindings` (candidateId -> model/executor name). Both
  `offered` and the recorded `ranking`/`scoping`/`requirementCandidates`/
  `chosenCandidateId` use candidate ids, so no field can carry a handle
  (`mcp__<opaque>`) into a projection. The same offered name twice is one
  candidate; two different names sharing an id fails closed.
- The recorded `ranking` has two named keys: `scoper` (the scoper's relevance
  ordering — NOT a next-tool preference) and `mcpSelector` (the
  MCP selector's own scores on its own scale). They are never interleaved, and
  neither may be presented as "the deterministic selector baseline".
- The `scoper` ordering is **content-token IDF over the offered surface**, not
  a raw overlap count. A raw count scored connectives as content: T3 finding 8
  recorded `create_hook` above `file_read` for a read-and-summarize prompt,
  and reproduced on this tool set `grep_search` FIRST on four pure function
  words with zero content tokens. IDF alone does not fix it — over 21 long
  descriptions the grammatical commoners are lexically rare, so `it` (df 4) and
  `does` (df 2) outrank `read` (df 6) — hence the English `FUNCTION_WORDS` set
  in `src/config/tool-scoping.ts` on top. That set is English-scoped; a
  non-English surface degrades to the IDF half, never to a wrong ADMISSION.
- **The weighting applies to the ranking ONLY.** Admission stays a raw
  `matched.length > 0` test, deliberately: which tools are offered is a product
  decision, and a connective-only match dropping a tool from the surface is a
  far larger change than F8 describes. `tests/config/tool-scoping-ranking.vitest.ts`
  re-implements the old admission rule and asserts the two agree exactly — if
  that test fails, the surface has changed.
- Final prose that promises another agent action (for example, "Next, I'm
  surfacing...") is a continuation, not a completion. The task loop re-prompts
  within its existing bound and records `completed_unverified` if the promise
  persists.
- The last-attempt `alix_coordination_run` outcome gates completion INDEPENDENTLY
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
