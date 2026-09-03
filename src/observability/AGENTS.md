# src/observability — Observability Platform (M8)

Purpose: the M8 observability surface — persisted metrics, telemetry envelope, diagnostics, alerts, cost attribution, health projection, trend/anomaly analysis, and the read-only CLI / HTTP routes that expose them.

## Ownership

| File | Responsibility |
|------|----------------|
| `metric-registry.ts` | Closed-set metric registry; registers every metric name/type/unit/labels; strict/compat validation — includes `STATE_METRIC_DEFINITIONS` (§28-29, #631) |
| `metrics-store.ts` | `MetricsStore` (append-only JSONL), `RollupStore` (hourly rollups), retention enforcement |
| `telemetry-envelope.ts` | Unified `TelemetryEnvelope` + factory/validation; adapters for AlixEvent / TraceEvent / MetricRow; `TelemetryBuffer` / `TelemetrySink` — state_ → observability category |
| `diagnostic-event.ts` | Normalized `DiagnosticEvent` type + mappers from runtime/contract diagnostics |
| `diagnostic-event-store.ts` | `DiagnosticEventStore` (JSONL), `createDiagnosticStoreSink` / `createDefaultDiagnosticSink` |
| `execution-context.ts` | `ExecutionContext` correlation accumulator threaded across runtime boundaries |
| `alert-engine.ts` | Stateful alert lifecycle (firing→resolved, cooldown, dedup by fingerprint); 8 built-in `HEALTH_RULES` |
| `cost-attribution.ts` | Versioned `PricingCatalog` + `CostAttribution` over `model.usage` session events |
| `health-snapshot.ts` | Side-effect-free `RuntimeHealthSnapshot` projection from persisted state; `ObservabilitySnapshotService` (TTL-cached) |
| `observability-config.ts` | `ObservabilityConfig` thresholds/TTLs/retention + `DEFAULT_OBSERVABILITY_CONFIG` |
| `observability-routes.ts` | Read-only HTTP handlers for /api/observability/* (GET-only, no-store) — includes `GET /api/observability/state` |
| `security-telemetry.ts` | `SecurityTelemetry` typed wrapper over MetricsStore for security metrics |
| `state-telemetry.ts` | `StateTelemetry` / `FakeStateTelemetry` typed wrapper for state substrate metrics; MetricsStore + optional TelemetrySink fan-out |
| `state-metrics.ts` | Per-execution state-vs-history aggregation (`collectStateMetrics`) for dashboard/CLI |
| `trend-analyzer.ts` | Windowed summaries + z-score anomaly detection |

CLI: `src/cli/commands/observability*.ts` (`health`, `metrics`, `state`, `trends`, `alerts`, `export`, `diagnostics`), dispatched from `src/cli.ts` (`alix observability`). `alix observability state` shows per-execution state vs history token comparison.

## Local Contracts

- **Metric naming:** snake_case. Production: `<domain>_<noun>_total` counters and `<domain>_<noun>_duration_ms` histograms (registered in `PRODUCTION_METRIC_DEFINITIONS`). Security: `security_<noun>_<verb>` with constrained label vocabularies (`SECURITY_METRIC_DEFINITIONS`).
- **`MetricRow` persisted shape:** `{ name, type, value, timestamp, labels? }`. `MetricsStore` writes `.alix/observability/metrics/YYYY-MM-DD.jsonl`; rollups to `.alix/observability/rollups/hourly.jsonl`. Newest-first reads, corrupt lines skipped.
- **Diagnostics:** `DiagnosticEvent` has `type: contract|runtime`, `domain`, `boundary`, `severity: error|warning`, optional `ExecutionContext`. Stored as JSONL.
- **Read-only discipline:** `observability-routes.ts` and the CLI serve GET semantics only (`Cache-Control: no-store`); the alert engine's `evaluate()` never persists. Health projection reads persisted state from other subsystems (daemon, coordination, approvals, ownership, recovery, process memory) and never writes.
- **Unknown cost → -1** (never fabricated).
- **Execution context** is the most-consumed export: thread it (type-only) across provider/tool/runtime/contract boundaries for correlation.

## Work Guidance

- The runtime/contract bridge lives in `src/runtime/contracts/observability-contract.ts` (M1.7: `RuntimeEvidence`, governance-oriented). This file must stay a pure type contract — no runtime code, no imports from `src/observability/`.
- Follow the established write path: domain → validated row/event → append-only store; never write from pure projection/analysis modules.
- **Known caveats (verify before relying on):**
  - `DiagnosticEventStore` default filename is `diagnostics.jsonl` but the CLI reads `.alix/diagnostics/events.jsonl` and the default sink doc says `events.jsonl`. Pick one canonical path if touching this (CLI is the likely contract).
  - Registered production metric names use `_` separators (`workflow_runs_total`) while telemetry category inference checks `.`-separated prefixes (`workflow.`) — normalized production metrics classify as `tool`. Reconcile if you touch `normalizeMetricEvent`.
  - The write side of metrics (`SecurityTelemetry` instance, a `TelemetrySink` implementation, `RollupStore.rollUp()` / `enforceRetention()` scheduling) has **no external producer/consumer yet** — the metrics pipeline is read-until-write-unwired. Do not assume live metric rows exist.
  - Built-in alert thresholds are hardcoded in `HEALTH_RULES` (memory 500/1000 MB, approvals 10/300s), not read from `ObservabilityConfig.alerts`.

## Verification

- `tests/observability/` covers metrics-store, telemetry-envelope, alert-engine, cost-attribution, diagnostic-event, health-snapshot, execution-context (+lineage), trend-analyzer, security-telemetry, metric-registry, observability CLI, routes, and integration (TUI health/cost, SSE stream).
- Full suite: `pnpm test:node` and `pnpm test:vitest`.

## Child DOX Index

None — `src/observability/` is a leaf subsystem with no child AGENTS.md.
