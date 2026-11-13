# Subsystem Correlation Graph

## Overview

Computes a cross-subsystem correlation graph from executive trend snapshots and
baseline comparisons: one node per canonical subsystem (score + status + drift)
and directed edges between subsystems whose score deltas correlate over time,
with a temporal lag. The graph is persisted as a single JSON document and
validated strictly on load. The engine is read-only over its inputs; persistence
is an explicit `save()`.

## Interface

- `CorrelationEngine` — constructor `(registry: BaselineRegistry, trendStore: ExecutiveTrendStore, config = DEFAULT_CORRELATION_CONFIG)`; `run(): Promise<CorrelationGraph>` [baseline-correlation-engine.ts:CorrelationEngine]
- `buildCorrelationGraph(comparisons: BaselineComparison[], snapshots: ExecutiveTrendSnapshot[], config): CorrelationGraph` — pure graph builder [build-correlation-graph.ts:buildCorrelationGraph]
- `CorrelationGraphStore` — `save(graph)`, `loadLatest({ staleAfterMs? })`, `exists()`, `filePath`, `tmpPath` [correlation-graph-store.ts:CorrelationGraphStore]
- `CorrelationGraphLoadError` — `code: "CORRELATION_GRAPH_LOAD_ERROR"` [correlation-types.ts:CorrelationGraphLoadError]
- Types: `CorrelationSubsystemId` (memory, workflow, skills, agents, tools, security, governance, adaptation), `CorrelationEdge`, `CorrelationNode`, `CorrelationGraph` (`schemaVersion: "p11.1.0"`), `CorrelationEngineConfig` [correlation-types.ts:CorrelationGraph]
- `DEFAULT_CORRELATION_CONFIG` — `windowSize: 12`, `minSamples: 6`, `maxTemporalLag: 3`, `degradationDeltaThreshold: -5`, `minEdgeConfidence: 0.35`, `staleAfterWindows: 3`, `excludedSubsystems: ["demo"]` [correlation-config.ts:DEFAULT_CORRELATION_CONFIG]
- `PRODUCTION_SUBSYSTEMS` — the eight canonical ids [correlation-config.ts:PRODUCTION_SUBSYSTEMS]
- `executiveToCorrelationSubsystem(name)` / `EXECUTIVE_TO_CORRELATION` — maps executive `learning` → `skills`; unknown names return `null` [normalize-subsystem.ts:executiveToCorrelationSubsystem]

## Invariants

- Graph `schemaVersion` must be exactly `"p11.1.0"`; any other value throws `CorrelationGraphLoadError` [correlation-graph-store.ts:loadLatest]
- On load, every node `subsystem` and edge `source`/`target` must be a `PRODUCTION_SUBSYSTEMS` id [correlation-graph-store.ts:loadLatest]
- `coOccurrenceRate` and `correlationConfidence` must be finite in `[0,1]`; `temporalLag` must be finite and `>= 0` [correlation-graph-store.ts:loadLatest]
- `generatedAt` must be a string containing `T` and parse to a valid date — validated *before* staleness math so `NaN` cannot silently bypass the stale check [correlation-graph-store.ts:loadLatest]
- `minSamples` is required history: fewer snapshots yields `status: "insufficient_history"` with `edges: []` [build-correlation-graph.ts:buildCorrelationGraph]
- Every canonical subsystem gets a node; a subsystem with no comparison is filled with `score: 0`, `status: "unknown"` [build-correlation-graph.ts:buildCorrelationGraph]
- Node status thresholds: `>= 90` excellent, `>= 70` healthy, `>= 40` warning, `>= 0` critical, otherwise unknown [build-correlation-graph.ts:computeNodeStatus]
- Edges are directed and computed for every ordered pair `a !== b`; an edge is dropped when blended confidence `< minEdgeConfidence` [build-correlation-graph.ts:computeEdge]
- Confidence blend weights: `0.4 * coOccurrenceRate + 0.3 * similarity + 0.2 * sampleRatio + 0.1 * lagStrength`, clamped to `[0,1]` [build-correlation-graph.ts:computeEdge]
- Snapshots are sorted oldest→newest before delta computation, so `delta[t] = score[t] - score[t-1]` is well ordered [build-correlation-graph.ts:buildCorrelationGraph]
- `status: "stale"` when the latest snapshot is older than `staleAfterWindows * windowDays * 24h` [build-correlation-graph.ts:buildCorrelationGraph]
- `save()` writes `graph.json.tmp`, `fsync`s it, then `renameSync`s over `graph.json` (atomic replace) [correlation-graph-store.ts:save]
- `cosineSimilarity` is a deliberate local copy of the repomap implementation; the two must be kept in sync if the algorithm changes [build-correlation-graph.ts:cosineSimilarity]
- `CorrelationEngine.loadTrendHistory` walks back using `findBaseline(current - 1ms)` for exclusive semantics and stops at `windowSize - 1` predecessors [baseline-correlation-engine.ts:CorrelationEngine]

## Side Effects

- `CorrelationEngine.run` performs network-free reads through `BaselineRegistry.runAll()` and `ExecutiveTrendStore.loadLatest`/`findBaseline` [baseline-correlation-engine.ts:CorrelationEngine]
- `CorrelationGraphStore.save` creates the root directory, writes temp file, fsyncs, and atomically renames [correlation-graph-store.ts:save]
- `loadLatest({ staleAfterMs })` mutates the returned graph's `status` to `"stale"` when the file age exceeds the threshold [correlation-graph-store.ts:loadLatest]
- Reads of an unparseable `graph.json` throw rather than returning `null`; only a missing file returns `null` [correlation-graph-store.ts:loadLatest]

## Verification

- Run: `pnpm test`
