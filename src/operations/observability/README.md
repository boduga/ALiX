# Observability Platform

## Overview
The observability surface for ALiX: a closed-set metric registry, append-only JSONL metric and diagnostic stores, a unified telemetry envelope with a buffered sink port, a stateful alert engine, cost attribution over `model.usage` events, a side-effect-free runtime health projection, windowed trend/anomaly analysis, tool-selection observation, and the read-only CLI/HTTP routes that expose them.

## Interface
- `MetricRegistry` (`register`/`registerAll`/`get`/`has`/`validate`/`mode`) plus `SECURITY_METRIC_DEFINITIONS`, `PRODUCTION_METRIC_DEFINITIONS`, `STATE_METRIC_DEFINITIONS`, `CONTEXT_ASSEMBLY_METRIC_DEFINITIONS`, `createMetricRegistry` [metric-registry.ts:MetricRegistry]
- `MetricsStore` (`append`/`readAll`/`close`) and `RollupStore` (`rollUp`/`enforceRetention`) with `MetricRow`, `MetricsQuery` [metrics-store.ts:MetricsStore]
- `createMetricsStoreSink(store, options)` and `MetricsStoreSink` (`observe`/`flush`) [metrics-sink.ts:createMetricsStoreSink]
- `TelemetryEnvelope`, `createTelemetryEnvelope`, `CATEGORY_MAP`, `inferCategory`, `normalizeCanonicalEvent`, `normalizeTraceEvent`, `normalizeMetricEvent`, `TelemetryBuffer`, `TelemetrySink` [telemetry-envelope.ts:TelemetryEnvelope]
- `DiagnosticEvent`, `DiagnosticEventType`, `DiagnosticSeverity`, `nextDiagnosticId`, `runtimeDiagToEvent`, `contractDiagToEvent` [diagnostic-event.ts:DiagnosticEvent]
- `DiagnosticEventStore` (`append`/`appendRuntime`/`appendContract`), `createDiagnosticStoreSink`, `createDefaultDiagnosticSink` [diagnostic-event-store.ts:DiagnosticEventStore]
- `ExecutionContext`, `EMPTY_CONTEXT`, `hasExecutionContext`, `mergeExecutionContext` [execution-context.ts:ExecutionContext]
- `AlertEngine` (`evaluate`/`addRule`/`acknowledge`/`getState`/`reset`), `HEALTH_RULES`, `AlertEvent`, `fingerprintAlert`, `EvaluateResult` [alert-engine.ts:AlertEngine]
- `PricingCatalog`, `defaultPricingCatalog`, `CostAttribution`, `CostSummary`, `CostCompleteness`, `isNonBillableProvider` [cost-attribution.ts:CostAttribution]
- `RuntimeHealthSnapshot`, `HealthProjectionCollector`, `ObservabilitySnapshotService` (`getHealth`/`invalidateHealth`), `HealthStatus`, `overallHealth`, `healthStatusFromAge` [health-snapshot.ts:ObservabilitySnapshotService]
- `ObservabilityConfig`, `DEFAULT_OBSERVABILITY_CONFIG`, `mergeObservabilityConfig` [observability-config.ts:ObservabilityConfig]
- `handleObservabilityRoute(ctx)` for `/api/observability/health|metrics|alerts|state|...` [observability-routes.ts:handleObservabilityRoute]
- `SecurityTelemetry` / `FakeSecurityTelemetry` [security-telemetry.ts:SecurityTelemetry]
- `StateTelemetry` / `FakeStateTelemetry` and `collectStateMetrics(store, opts)` [state-telemetry.ts:StateTelemetry]
- `TrendAnalyzer` (`computeWindowed`/`detectAnomalies`), `WindowedSummary`, `AnomalyResult` [trend-analyzer.ts:TrendAnalyzer]
- `SelectionObservation`, `buildSelectionObservation`, `emitSelectionObservation`, `emitSelectionNotApplicable`, `selectionTraceEnabled`, `SurfaceGap` [tool-selection-observation.ts:SelectionObservation]

## Invariants
- Registry validation rejects non-finite values, an unknown name in `strict` mode (compat mode warns and accepts), a type that differs from the definition, more than 8 label keys, a disallowed label key or value, and label values over 128 chars; production names are snake_case `<domain>_<noun>_total` counters and `<domain>_<noun>_duration_ms` histograms [metric-registry.ts:MetricRegistry]
- `MetricRow` persists as `{ name, type, value, timestamp, labels? }`; the sink defaults a missing type to `counter_delta` and preserves an explicit kind so gauges are never summed on rollup [metrics-sink.ts:createMetricsStoreSink]
- Sink append failures never fail the caller: errors are reported only through the optional `onError` observer [metrics-sink.ts:createMetricsStoreSink]
- `MetricsStore` performs no filesystem work in its constructor; the metrics directory is created lazily on first write [metrics-store.ts:MetricsStore]
- Metric reads default to newest-first (`desc`), cap the requested limit at an absolute maximum, and skip malformed JSONL lines rather than aborting [metrics-store.ts:MetricsStore]
- A stream-level `error` on the append stream is absorbed so telemetry can never surface as an uncaught exception; the per-row write callback still reports the error to the awaiting append [metrics-store.ts:MetricsStore]
- `inferCategory` maps by `.`-separated prefix and falls through to `"tool"` when no prefix matches [telemetry-envelope.ts:inferCategory]
- `TelemetryBuffer` enforces `maxSize`; on overflow it either drops the oldest envelope or throws, per the configured `overflow` mode [telemetry-envelope.ts:TelemetryBuffer]
- Diagnostic events carry `type: contract|runtime`, `domain`, `boundary`, `severity: error|warning`, and an optional `ExecutionContext` [diagnostic-event.ts:DiagnosticEvent]
- Alert identity is the fingerprint of rule id + severity + dimensions; a repeat trigger increments `occurrences` on the same alert instead of creating a new one, and a condition that throws skips its rule [alert-engine.ts:AlertEngine]
- A no-longer-triggered alert resolves only after the cooldown elapses; before then it counts as `recent` and stays firing [alert-engine.ts:AlertEngine]
- `evaluate` never mutates previously returned alert objects and never persists [alert-engine.ts:AlertEngine]
- Unknown pricing yields cost `-1`, never a fabricated number, and a provider or workflow total is `-1` if any contributing invocation was unpriced [cost-attribution.ts:CostAttribution]
- `CostCompleteness` of `partial` or `none` means `totalCost` is `-1`; `-1` never reads as zero cost [cost-attribution.ts:CostSummary]
- Health projection is side-effect-free: it reads persisted state and never writes [health-snapshot.ts:ObservabilitySnapshotService]
- `ObservabilitySnapshotService.getHealth` caches the snapshot for `snapshot.healthTtlMs` (default 2000 ms) and refreshes only after the TTL or an explicit `invalidateHealth()` [health-snapshot.ts:ObservabilitySnapshotService]
- `handleObservabilityRoute` is GET-only; a non-GET request returns 405, and `limit` is clamped to at most 1000 with invalid dates rejected as 400 [observability-routes.ts:handleObservabilityRoute]
- The alerts route evaluates a fresh `AlertEngine` per request without persisting, keeping GET read-only [observability-routes.ts:handleObservabilityRoute]
- Selection observation is the single DTO for that data; task-loop consumers narrow it rather than redeclaring it, and decision-layer imports stay type-only [tool-selection-observation.ts:SelectionObservation]
- Chosen MCP handles are masked to candidate ids, and unoffered handles in an invalid selection are masked by shape rather than leaked [tool-selection-observation.ts:SelectionObservation]
- `not_applicable` records no model choice and is excluded from selector statistics [tool-selection-observation.ts:SelectionObservation]
- Selection emitters apply the `ALIX_TOOL_SELECTION_TRACE === "1"` gate to the append only; they still return the built payload so completion signals are unaffected [tool-selection-observation.ts:emitSelectionObservation]
- `DEFAULT_OBSERVABILITY_CONFIG` supplies 5 s/30 s daemon health thresholds, 10-count/300 s approval backlog, 500/1000 MB memory thresholds, 7/30/365-day retention, and 2 s/30 s/60 s snapshot TTLs [observability-config.ts:DEFAULT_OBSERVABILITY_CONFIG]
- Trend windows bucket rows with `Math.floor(ts / windowSize) * windowSize`, defaulting to a 60 s window, and compute p50/p95/p99 over sorted values [trend-analyzer.ts:TrendAnalyzer]
- `detectAnomalies` needs at least 4 rows for a metric, uses all but the latest as baseline, skips zero standard deviation, and flags `|z| > sensitivity` (default 2.0) [trend-analyzer.ts:TrendAnalyzer]

## Side Effects
- Appends metric rows to `.alix/observability/metrics/YYYY-MM-DD.jsonl` through a reused append stream that closes after a 250 ms `APPEND_STREAM_IDLE_MS` idle timer, itself `unref`'d so it never holds the loop open [metrics-store.ts:APPEND_STREAM_IDLE_MS]
- `RollupStore` writes hourly rollups to `.alix/observability/rollups/hourly.jsonl` and `enforceRetention` deletes raw files older than the configured days (default 7) [metrics-store.ts:RollupStore]
- Creates the metrics directory with `mkdir({ recursive: true })` on first write only [metrics-store.ts:MetricsStore]
- `DiagnosticEventStore.append` creates the parent directory on first write and appends one JSON line per event [diagnostic-event-store.ts:DiagnosticEventStore]
- `emitSelectionObservation` / `emitSelectionNotApplicable` append `tool.selection.observed` / `tool.selection.not_applicable` to the session EventLog only when tracing is enabled [tool-selection-observation.ts:emitSelectionObservation]
- `handleObservabilityRoute` serves HTTP GET responses with `Cache-Control: no-store` and performs no writes [observability-routes.ts:handleObservabilityRoute]
- `AlertEngine.acknowledge` mutates in-memory alert state (acknowledged timestamp/actor) and `reset` clears firing and resolved sets; no persistence [alert-engine.ts:AlertEngine]
- Reads and writes are confined to the local filesystem under `.alix/observability` and `.alix/diagnostics`; no network access and no subprocess execution [metrics-store.ts:MetricsStore]
- Pure helpers (`inferCategory`, `mergeExecutionContext`, cost attribution, health projection, trend analysis, registry validation) perform no I/O [health-snapshot.ts:ObservabilitySnapshotService]

## Verification
- Run: `pnpm test`
- Relevant tests: `tests/observability/metrics-store.test.ts`, `tests/observability/metric-registry.test.ts`, `tests/observability/metric-parity.vitest.ts`, `tests/observability/metrics-sink.vitest.ts`, `tests/observability/telemetry-envelope.test.ts`, `tests/observability/alert-engine.test.ts`, `tests/observability/cost-attribution.test.ts`, `tests/observability/cost-integrity.vitest.ts`, `tests/observability/health-snapshot.test.ts`, `tests/observability/trend-analyzer.test.ts`, `tests/observability/observability-routes.test.ts`, `tests/observability/selection-trace-gate.vitest.ts`
