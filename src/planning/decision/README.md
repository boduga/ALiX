# Decision Subsystem (Jev / System One)

## Overview
Bounded probabilistic decision primitive. ALiX owns workflow and governance; decision engines only classify, score, or choose among candidates ALiX supplies. Local-first: the local baseline works with Jev absent, and the Jev remote adapter is opt-in. The subsystem also owns an offline tool-selection experiment that reuses decision engines without becoming a runtime decision.

## Interface
- `DecisionType`, `ChoiceResult`/`ScoreResult`/`NoulResult`, `DecisionProvenance`, `DecisionUsage`, `outcomeIssue()`, `isValidChoice()` — the closed decision vocabulary, the native result union, provenance, and the pure shape/candidate gate `[contracts.ts:DecisionType]` `[contracts.ts:DecisionResult]` `[contracts.ts:outcomeIssue]`.
- `DecisionEngine`, `EngineRegistry`, `createEngineRegistry()`, `createDefaultRegistry()` — capability metadata, per-decision support, and resolution that fails closed `[registry.ts:DecisionEngine]` `[registry.ts:createEngineRegistry]` `[registry.ts:createDefaultRegistry]`.
- `DecisionExecutor`, `ExecuteInput`, `ExecutorOutcome`, `executeWithTimeout()`, `assertValidOutcome()` — the narrow work seam plus the shared timeout/failure-model gate `[executors.ts:DecisionExecutor]` `[executors.ts:executeWithTimeout]` `[executors.ts:assertValidOutcome]`.
- `buildPlan()`, `executeWithFallback()`, `ExecutionPlan`, `AttemptRecord`, `DEFAULT_FALLBACK_TIMEOUT_MS` — pure route planning and primary→fallback execution `[fallback.ts:buildPlan]` `[fallback.ts:executeWithFallback]`.
- `Projector`, `projectForRemote()` — project → gate → seal, the only path into remote transport `[projector.ts:projectForRemote]`.
- `sealForRemote()`, `verifySealedProjection()`, `inspectRemoteProjection()`, `hashProjection()`, `RemoteDecisionSubject`, `RemoteSealedProjection` — remote-boundary gates, seal brand, and hash `[boundary.ts:sealForRemote]` `[boundary.ts:verifySealedProjection]` `[boundary.ts:inspectRemoteProjection]`.
- `recordDecision()`, `createDecisionJournalStore()`, `DecisionJournalRecord`, `writeDebugPayload()` — payload-free ledger record builder, JSONL store, queries, and separate debug retention `[journal.ts:recordDecision]` `[journal.ts:createDecisionJournalStore]` `[journal.ts:writeDebugPayload]`.
- `DecisionConfig`, `routePolicyFor()`, `isRemoteEngineAllowed()`, `validateDecisionConfig()`, `DEFAULT_DECISION_CONFIG`, `DECISION_MODE_VALUES` — per-decision routes, remote opt-in, and a pure validator `[config.ts:DecisionConfig]` `[config.ts:routePolicyFor]` `[config.ts:isRemoteEngineAllowed]` `[config.ts:validateDecisionConfig]`.
- `composeApproval()`, `exceedsRiskThreshold()` — deterministic approval floor composed with a calibrated risk signal `[approval.ts:composeApproval]` `[approval.ts:exceedsRiskThreshold]`.
- `resolveDecisionPaths()` — decision-owned `<cwd>/.alix/decisions` state paths `[paths.ts:resolveDecisionPaths]`.
- `ExecutionOutcome`, `SelectionOutcome`, `EvidenceContribution` — the three uncollapsed selection dimensions shared with the run layer `[selection-outcome.ts:ExecutionOutcome]` `[selection-outcome.ts:SelectionOutcome]` `[selection-outcome.ts:EvidenceContribution]`.
- `freezeToolCandidates()`, `candidateIdFor()`, `FrozenToolCandidate`, `LocalToolBinding` — sanitized, bounded candidate identity plus the local-only handle binding `[tool-selection-candidates.ts:freezeToolCandidates]` `[tool-selection-candidates.ts:candidateIdFor]`.
- `replayToolSelection()`, `extractToolSelectionScopes()`, `createEngineToolSelector()`, `ToolSelectionScope`, `ToolSelectionSelector` — offline replay of one frozen scope against one selector `[tool-selection-replay.ts:replayToolSelection]` `[tool-selection-replay.ts:extractToolSelectionScopes]` `[tool-selection-replay.ts:ToolSelectionSelector]`.
- `evaluateToolSelection()`, `replayabilityOf()`, `SelectionEvaluation` — observed/replayed/unknown comparison without invented counterfactuals `[tool-selection-evaluation.ts:evaluateToolSelection]` `[tool-selection-evaluation.ts:replayabilityOf]`.
- `createReplaySnapshot()`, `replayToolInIsolation()`, `createSnapshotReplayRunner()` — isolated hermetic replay with cleanup `[tool-selection-snapshot.ts:createReplaySnapshot]` `[tool-selection-snapshot.ts:replayToolInIsolation]`.
- `loadExternalReplayFixtures()`, `replayFromRecordedResponse()`, `createRecordedResponseRunner()` — recorded-response replay for external tools `[tool-selection-fixtures.ts:loadExternalReplayFixtures]` `[tool-selection-fixtures.ts:replayFromRecordedResponse]`.
- `createJevExperimentScorer()`, `projectToolSelectionCandidate()`, `assertNoPostSelectionFields()`, `TOOL_SELECTION_PROJECTOR_VERSION` — the experiment-only scorer and its pinned projection `[tool-selection-experiment.ts:createJevExperimentScorer]` `[tool-selection-experiment.ts:projectToolSelectionCandidate]` `[tool-selection-experiment.ts:TOOL_SELECTION_PROJECTOR_VERSION]`.
- `createJevToolSelectionScorer()`, `TOOL_SELECTION_JEV_MAPPING` — one-call offline composition registered through `experimentMappings` `[tool-selection-jev-mapping.ts:createJevToolSelectionScorer]` `[tool-selection-jev-mapping.ts:TOOL_SELECTION_JEV_MAPPING]`.
- `deriveEvaluationEligibility()`, `SELECTION_EXCLUSION_CODES`, `buildBlindLabellingCard()`, `parseLabelRecord()`, `summarizeCorpus()`, `T3_CHECKPOINT` — the pre-registered corpus contract `[tool-selection-corpus.ts:deriveEvaluationEligibility]` `[tool-selection-corpus.ts:SELECTION_EXCLUSION_CODES]` `[tool-selection-corpus.ts:buildBlindLabellingCard]` `[tool-selection-corpus.ts:summarizeCorpus]`.

## Invariants
- `DecisionType` is closed to `claim-verification`, `context-relevance`, `model-tier`, and `risk-escalation`; adding a type without a route fails compile `[contracts.ts:DecisionType]` `[config.ts:routePolicyFor]`.
- Native results stay Choice/Score/Noul. They are never flattened to `{value, confidence}`, and Noul carries a probability, never a confidence `[contracts.ts:DecisionResult]` `[contracts.ts:NoulResult]`.
- An unknown or malformed result is rejected, never coerced; a choice outside the supplied candidate set is invalid `[contracts.ts:outcomeIssue]` `[executors.ts:assertValidOutcome]`.
- Engine resolution fails closed: missing engines, remote engines without `allowRemote`, and engines that opt out via `supportsDecision` all throw `[registry.ts:resolve]` `[fallback.ts:assertSupportsDecision]`.
- Only `local` and `existing-routing` are allowed unconditionally; `jev` requires `remote.jev.enabled === true`, and unknown engines are denied `[config.ts:isRemoteEngineAllowed]`.
- A throwing projector blocks the remote call — validation failure never reaches the provider `[projector.ts:projectForRemote]`.
- Secret material is rejected, never masked, and the gate rejects prohibited key names, raw ExecutionState-shaped payloads, tool-result carriers, over-deep, oversize, and non-JSON-safe payloads `[boundary.ts:inspectRemoteProjection]` `[boundary.ts:EXECUTION_STATE_KEYS]` `[boundary.ts:MAX_PROJECTION_DEPTH]` `[boundary.ts:MAX_PROJECTION_JSON_BYTES]`.
- Only a brand-and-hash-verified sealed projection may cross; the Jev adapter re-verifies before transport `[boundary.ts:verifySealedProjection]` `[engines/jev.ts:createJevExecutor]`.
- The journal stores provenance and hashes, never payloads; a choice outcome requires non-empty `candidates`, capped by `MAX_CANDIDATES` `[journal.ts:recordDecision]` `[journal.ts:MAX_CANDIDATES]`.
- Journal write and read failures surface as `JournalWriteError`/`JournalReadError` with cause; callers degrade per decision policy rather than losing the failure `[journal.ts:JournalWriteError]` `[journal.ts:JournalReadError]`.
- Risk context is captured at decision time on the journal record and validated against the closed `low|medium|high` vocabulary `[contracts.ts:RiskContext]` `[journal.ts:recordDecision]`.
- Fallback engages only on known engine errors (unavailable, timeout, malformed); unexpected engine bugs propagate `[fallback.ts:executeWithFallback]`.
- Approval composition is monotonic: `policy OR riskExceedsThreshold`. A low risk score never cancels a policy-required approval `[approval.ts:composeApproval]`.
- `DEFAULT_DECISION_CONFIG` is a fallback only; `AlixConfig.decision` is canonical, and every route carries `enabled` where absent/false preserves existing behavior `[config.ts:DEFAULT_DECISION_CONFIG]` `[config.ts:DecisionRoutePolicy]`.
- Tool selection is an offline experiment, not a `DecisionType`: no route entry, no policy authority, and no import from the live loop `[tool-selection-experiment.ts:createJevExperimentScorer]`.
- The experiment uses the sealed `experiment:<id>` subject and refuses a foreign projector version rather than producing incomparable results `[boundary.ts:RemoteDecisionSubject]` `[tool-selection-experiment.ts:TOOL_SELECTION_PROJECTOR_VERSION]`.
- A projection carries selection-time information only; post-selection fields (`actualChoice`, outcome, evidence, rankings) and raw `mcp__<handle>` strings are refused `[tool-selection-experiment.ts:assertNoPostSelectionFields]` `[tool-selection-experiment.ts:assertNoRawHandlesOnSurface]`.
- Candidate identity is `builtin:<name>` or `mcp:<short hash>`; the executable handle lives only in the local binding and is never projected `[tool-selection-candidates.ts:mcpCandidateId]` `[tool-selection-candidates.ts:LocalToolBinding]`.
- A selector scores one candidate at a time; ALiX owns enumeration, sorting, and tie-breaking by offered order `[tool-selection-replay.ts:ToolSelectionSelector]` `[tool-selection-replay.ts:replayToolSelection]`.
- Replay requires exact set equality with the offered set, and one failed candidate invalidates the whole attempt rather than returning a partial ordering `[tool-selection-replay.ts:replayToolSelection]`.
- Builtin and MCP candidates are ranked inside their own domain and never merged into one ordering `[tool-selection-replay.ts:replayToolSelection]`.
- An evaluation is only `observed`, `replayed`, or `unknown`; no selector receives a label from a counterfactual that was never observed or replayed `[tool-selection-evaluation.ts:SelectionEvaluation]`.
- Fixture replay matches `(tool, argsSignature)` exactly, rejects an ambiguous match, and a miss stays `unknown` — never a live call `[tool-selection-fixtures.ts:createExternalReplayFixtureStore]` `[tool-selection-fixtures.ts:replayFromRecordedResponse]`.
- Only hermetic tools replay in a snapshot; a dirty tree falls back to a copy, and the runner never writes to the source root `[tool-selection-snapshot.ts:createReplaySnapshot]` `[tool-selection-snapshot.ts:replayToolInIsolation]`.
- T3 eligibility keeps two independent tracks over a closed exclusion vocabulary with no generic `bad-run`; the summary reports facts and prerequisites and never ranks selectors `[tool-selection-corpus.ts:deriveEvaluationEligibility]` `[tool-selection-corpus.ts:SELECTION_EXCLUSION_CODES]` `[tool-selection-corpus.ts:summarizeCorpus]`.
- Blind card A/B order is derived deterministically from the scope key, and cards carry no provenance field `[tool-selection-corpus.ts:buildBlindLabellingCard]` `[tool-selection-corpus.ts:CARD_KEYS]`.
- The recorded `scoperRanking` is a relevance ordering, not a next-tool preference or a selector baseline `[tool-selection-replay.ts:ToolSelectionScope]`.
- Boundary caps and timeouts are uncalibrated operational defaults pending calibration evidence `[boundary.ts:MAX_PROJECTION_JSON_BYTES]` `[fallback.ts:DEFAULT_FALLBACK_TIMEOUT_MS]`.

## Side Effects
- Journal appends one JSON line per decision to `<dir>/decisions.jsonl`, creating the directory recursively `[journal.ts:createDecisionJournalStore]`.
- Debug payloads are written to `<dir>/debug/<decisionId>.json` only when explicitly enabled; the primary ledger never carries payloads `[journal.ts:writeDebugPayload]`.
- Decision state defaults to `<cwd>/.alix/decisions`, with `fixtures/` and `profiles.json` beneath it `[paths.ts:resolveDecisionPaths]`.
- Snapshot replay creates `alix-selection-replay-*` temp directories, may run `git worktree add --detach` against the source, and removes the holder on cleanup `[tool-selection-snapshot.ts:createReplaySnapshot]` `[tool-selection-snapshot.ts:SNAPSHOT_TEMP_PREFIX]`.
- Fixture replay reads a JSON fixture file from disk; a missing or unparsable file yields an empty corpus `[tool-selection-fixtures.ts:loadExternalReplayFixtures]`.
- The Jev executor performs network transport only when enabled and after seal verification; without an API key it raises `EngineUnavailableError` `[engines/jev.ts:createJevExecutor]`.
- Timeout wrappers arm one timer per attempt and clear it in `finally` `[executors.ts:executeWithTimeout]` `[tool-selection-replay.ts:rankWithTimeout]`.
- Projection inspection, hashing, and approval composition perform no I/O `[boundary.ts:inspectRemoteProjection]` `[approval.ts:composeApproval]`.
- `writeDebugPayload` and journal append are the only filesystem writes in this subsystem's foundation modules `[journal.ts:writeDebugPayload]`.

## Verification
- Run: `pnpm test`
- Decision foundation, boundary, journal, fallback, and approval suites: `tests/decision/decision-foundation.test.ts`, `tests/decision/decision-boundary.test.ts`, `tests/decision/decision-journal.test.ts`, `tests/decision/decision-fallback.test.ts`, `tests/decision/decision-approval.test.ts`.
- Tool-selection experiment suites: `tests/run/tool-selection-experiment.vitest.ts`, `tests/run/tool-selection-snapshot.vitest.ts`, `tests/run/tool-selection-fixtures.vitest.ts`, `tests/run/tool-selection-corpus.vitest.ts`.
