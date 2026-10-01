# src/observability — Observability Platform (M8)

Purpose: the M8 observability surface — persisted metrics, telemetry envelope, diagnostics, alerts, cost attribution, health projection, trend/anomaly analysis, and the read-only CLI / HTTP routes that expose them.

## Ownership

| File | Responsibility |
|------|----------------|
| `metric-registry.ts` | Closed-set metric registry; registers every metric name/type/unit/labels; strict/compat validation — includes `STATE_METRIC_DEFINITIONS` (§28-29, #631) + `CONTEXT_ASSEMBLY_METRIC_DEFINITIONS` (§28, #641: context_tier_source/selected/evicted/tokens, context_assembly_state_version/history_revision/admitted/dropped). `PRODUCTION_METRIC_DEFINITIONS` also carries the live-response `agent_*` activity/liveness set (Phase 9: agent_activity_state/duration_ms, agent_last_progress_age_ms, agent_stall_warning_total, agent_invocation_cancelled/failed_total) — emitted on the session runtime path via `MinimalMetrics` (src/kernel/minimal-metrics.ts) |
| `metrics-store.ts` | `MetricsStore` (append-only JSONL), `RollupStore` (hourly rollups), retention enforcement |
| `telemetry-envelope.ts` | Unified `TelemetryEnvelope` + factory/validation; adapters for AlixEvent / TraceEvent / MetricRow; `TelemetryBuffer` / `TelemetrySink` — state_/context_tier_/context_assembly → observability category |
| `diagnostic-event.ts` | Normalized `DiagnosticEvent` type + mappers from runtime/contract diagnostics |
| `diagnostic-event-store.ts` | `DiagnosticEventStore` (JSONL), `createDiagnosticStoreSink` / `createDefaultDiagnosticSink` |
| `execution-context.ts` | `ExecutionContext` correlation accumulator threaded across runtime boundaries |
| `alert-engine.ts` | Stateful alert lifecycle (firing→resolved, cooldown, dedup by fingerprint); 8 built-in `HEALTH_RULES` |
| `cost-attribution.ts` | Versioned `PricingCatalog` + `CostAttribution` over `model.usage` session events |
| `health-snapshot.ts` | Side-effect-free `RuntimeHealthSnapshot` projection from persisted state; `ObservabilitySnapshotService` (TTL-cached) |
| `observability-config.ts` | `ObservabilityConfig` thresholds/TTLs/retention + `DEFAULT_OBSERVABILITY_CONFIG` |
| `observability-routes.ts` | Read-only HTTP handlers for /api/observability/* (GET-only, no-store) — includes `GET /api/observability/state` (extended #641: tier breakdown) |
| `security-telemetry.ts` | `SecurityTelemetry` typed wrapper over MetricsStore for security metrics |
| `state-telemetry.ts` | `StateTelemetry` / `FakeStateTelemetry` typed wrapper for state substrate metrics; MetricsStore + optional TelemetrySink fan-out — #641: recordContextAssembly/recordAssembledContext (source/selected/evicted/tokens per tier + stateVersion/historyRevision) |
| `state-metrics.ts` | Per-execution state-vs-history aggregation (`collectStateMetrics`) for dashboard/CLI — #641: tierTokens/tierSources/Selected/Evicted, stateVersion/historyRevision, admitted/dropped, totals per tier |
| `trend-analyzer.ts` | Windowed summaries + z-score anomaly detection |
| `tool-selection-observation.ts` | The decision-neutral selection-observation seam: the `SelectionObservation` DTO (the single definition — the task loop narrows it, never re-declares it), the pure `buildSelectionObservation`, and the emitters `emitSelectionObservation` / `emitSelectionNotApplicable`. `not_applicable` is coverage vocabulary, not a verdict: it records that a turn made no model choice (`no_tool_call` / `no_tools_offered`) and never accompanies an `observed` scope, so replay can exclude it from selector statistics. Owns payload SHAPE and assembly only — never which candidates the surface contains, and never a runtime decision. Its imports from `src/decision` are **type-only**, so the grounded route (`src/runtime`, `src/agent`, `src/daemon`) reaches it without taking a runtime dependency on the decision layer (F4 constraint). **Masking:** a chosen `mcp__` handle is masked to its candidate id, and an unoffered `mcp__` name recorded in `invalidSelection` is masked by its own shape (such a call is invalid by definition, so it can never be found in `candidates` to classify it) — no raw handle reaches a frozen scope or a Jev projection; the handle stays in the LOCAL-ONLY `candidateBindings`. `FrozenScopingProvenance` (id-keyed) is the frozen counterpart of the name-keyed `ScopingProvenance` in `src/config/tool-scoping.ts`. **`surfaceGaps`** records requirement-closing tools the surface could not offer, classed `scoper-excluded` (the relevance filter dropped it) vs `absent-upstream` (never a candidate — session mode removed it before the scoper ran). T3 could not see its own largest finding because `scoping.excluded` explains only the first case, so a surface that made the objective impossible read as a clean one. **Both emitters are gated OFF by default** on `ALIX_TOOL_SELECTION_TRACE=1`: this is per-turn telemetry for an experiment T3 concluded `experiment-only`, with no runtime reader (only `scripts/tool-selection-sample.mjs`, over sessions recorded during a cohort collection). Measured over 91 sessions: 338 events, 2% of the stream, 3.7 MB at ~11 kB average - the largest payload class in the log. The gate suppresses the APPEND only: `emitSelectionObservation` still returns the built observation, because the task loop derives completion signals from it, and the payload is byte-identical on both sides. `emitSelectionNotApplicable` shares the switch - `not_applicable` is corpus vocabulary and is unusable without its `observed` scopes. Any new cohort collection must set the flag for the whole batch; see `docs/jev/T3-d-corpus-collection-runbook.md` step 2 |

CLI: `src/cli/commands/observability*.ts` (`health`, `metrics`, `state`, `trends`, `alerts`, `export`, `diagnostics`), dispatched from `src/cli.ts` (`alix observability`). `alix observability state` shows per-execution state vs history token comparison + per-tier source/selected/evicted/tokens and stateVersion/historyRevision (#641).

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
