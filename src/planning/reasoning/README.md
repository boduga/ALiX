# Root Cause Reasoning

## Overview
P11.2 causal analysis over a correlation graph. `buildRootCauseAnalysis` is a pure deterministic function that turns a `CorrelationGraph` into a `RootCauseAnalysis` of per-degraded-subsystem causes, chain-of-failure detection, and templated recommendation text; `ReasoningEngine` orchestrates load → analyze → persist, and `RootCauseStore` keeps results in an append-only JSONL file ([build-root-cause-analysis.ts:buildRootCauseAnalysis] file doc, [reasoning-engine.ts:ReasoningEngine]).

## Interface
- `CausalMechanism` — `temporal_cascade` | `concurrent_degradation` | `inverse_correlation` | `degradation_chain` ([reasoning-types.ts:CausalMechanism])
- `LikelyCause`, `CausalFinding`, `AnalysisStatus`, `RootCauseAnalysis` (schemaVersion `"p11.2.0"`) ([reasoning-types.ts:RootCauseAnalysis])
- `ReasoningEngineConfig` — `minCauseConfidence`, `maxCausesPerSubsystem`, `degradationThreshold`, optional `staleAfterMs` ([reasoning-types.ts:ReasoningEngineConfig])
- `DEFAULT_REASONING_CONFIG` — 0.40 / 3 / 40 ([reasoning-config.ts:DEFAULT_REASONING_CONFIG])
- `buildRootCauseAnalysis(graph, config, generatedAt?)` ([build-root-cause-analysis.ts:buildRootCauseAnalysis])
- `ReasoningEngine` — `run()` and `loadLatest()` ([reasoning-engine.ts:ReasoningEngine])
- `RootCauseStore` — `save`, `loadLatest`, `loadById`, `list` ([root-cause-store.ts:RootCauseStore])
- `RootCauseAnalysisMeta` — `analysisId`, `status`, `generatedAt`, `findings` count ([root-cause-store.ts:RootCauseAnalysisMeta])
- `RootCauseAnalysisError` with code `ROOT_CAUSE_ANALYSIS_ERROR` ([reasoning-types.ts:RootCauseAnalysisError])

## Invariants
- `buildRootCauseAnalysis` is pure: no I/O and no `node:*` import beyond `createHash` ([build-root-cause-analysis.ts:buildRootCauseAnalysis] file doc).
- `analysisId` is the literal string `` `reason-${now}` `` and `generatedAt` defaults to `new Date().toISOString()` when not supplied ([build-root-cause-analysis.ts:buildRootCauseAnalysis]).
- `correlationGraphId` is a SHA-256 over graph `schemaVersion` + `generatedAt` + serialized nodes + serialized edges, so identical snapshots hash identically ([build-root-cause-analysis.ts:buildRootCauseAnalysis]).
- Graph-level `insufficient_history` and `stale` short-circuit to an empty-findings early exit before any node work ([build-root-cause-analysis.ts:buildRootCauseAnalysis]).
- Degraded nodes are `warning`, `critical`, or `unknown` with `score < config.degradationThreshold`; no degraded nodes yields `no_degradation` ([build-root-cause-analysis.ts:buildRootCauseAnalysis]).
- Only incoming edges at or above `minCauseConfidence` qualify; an edge with `none` direction or a non-qualifying combination is skipped ([build-root-cause-analysis.ts:buildRootCauseAnalysis]).
- `temporal_cascade` requires positive direction and `temporalLag >= 1` and boosts confidence by 0.1 capped at 0.95; `concurrent_degradation` requires lag 0 and co-occurrence ≥ 0.5; `inverse_correlation` scales confidence by 0.8 ([build-root-cause-analysis.ts:buildRootCauseAnalysis]).
- Duplicate causes merge evidence and drift ids by set union, keeping the higher confidence ([build-root-cause-analysis.ts:buildRootCauseAnalysis]).
- Chain detection is 2-hop only, excludes cycles back to the target, requires the upstream edge to qualify, and multiplies confidences capped at 0.95; a direct mechanism is preferred over a chain for the same subsystem ([build-root-cause-analysis.ts:buildRootCauseAnalysis]).
- Causes are sorted by descending confidence and truncated to `maxCausesPerSubsystem` ([build-root-cause-analysis.ts:buildRootCauseAnalysis]).
- `drivingMetric` is the drift item id with the largest absolute `delta`, or `null` when the node has no drift ([build-root-cause-analysis.ts:buildRootCauseAnalysis]).
- Status is `insufficient_edges` when no finding has any likely cause, otherwise `ok` ([build-root-cause-analysis.ts:buildRootCauseAnalysis]).
- `ReasoningEngine.run` throws `RootCauseAnalysisError` when no correlation graph is available and delegates `staleAfterMs` to the graph store's `loadLatest` ([reasoning-engine.ts:ReasoningEngine]).
- `RootCauseStore` rejects anything whose `schemaVersion` is not `"p11.2.0"` or whose `findings` is not an array ([root-cause-store.ts:RootCauseStore]).
- `loadLatest` reads only the last non-empty line; `loadById` returns the first matching `analysisId`; malformed lines are skipped except a matching line, whose validation error propagates ([root-cause-store.ts:RootCauseStore]).
- `list` silently skips malformed lines and entries with a foreign schema version ([root-cause-store.ts:RootCauseStore]).

## Side Effects
- `RootCauseStore.save` creates the directory with `mkdirSync({recursive: true})` when missing and appends a JSON line to `<dir>/root-causes.jsonl` ([root-cause-store.ts:RootCauseStore]).
- Store reads use synchronous `readFileSync` of the whole JSONL file ([root-cause-store.ts:RootCauseStore]).
- `ReasoningEngine.run` persists the analysis and `loadLatest` reads it back ([reasoning-engine.ts:ReasoningEngine]).

## Verification
- Run: `pnpm test`
