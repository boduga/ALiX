# Metrics Registry

ALiX uses a **closed metrics registry** for all operational and security observability.
Every metric name, type, unit, description, and allowed label vocabulary is defined in
[`src/observability/metric-registry.ts`](../../src/observability/metric-registry.ts).

> **Python metrics catalog (legacy):** Previous Python-based deployments maintained a
> separate metrics catalog in `pylib/metrics/catalog.py`. That catalog is superseded by
> this TypeScript registry and is no longer authoritative.

## Registered Production Metrics

All `M09MetricName` values from `src/kernel/minimal-metrics.ts` are registered.

| Name | Type | Unit | Description | Labels |
|------|------|------|-------------|--------|
| `workflow_runs_total` | counter_delta | count | Total workflow runs executed | none |
| `model_calls_total` | counter_delta | count | Total model/LLM API calls | none |
| `tool_calls_total` | counter_delta | count | Total tool invocations | none |
| `tool_failures_total` | counter_delta | count | Total tool invocation failures | none |
| `policy_decisions_total` | counter_delta | count | Total policy decisions evaluated | none |
| `policy_denials_total` | counter_delta | count | Total policy denials | none |
| `workflow_duration_ms` | histogram_sample | ms | Workflow execution duration | none |
| `collaboration_conflict_candidates_total` | counter_delta | count | Conflict candidates found | none |
| `collaboration_conflicts_detected_total` | counter_delta | count | Conflicts detected | none |
| `collaboration_conflicts_updated_total` | counter_delta | count | Conflicts updated | none |
| `collaboration_conflicts_resolved_total` | counter_delta | count | Conflicts resolved | none |
| `collaboration_conflicts_dismissed_total` | counter_delta | count | Conflicts dismissed | none |
| `collaboration_conflict_detection_duration_ms` | histogram_sample | ms | Conflict detection duration | none |
| `collaboration_conflict_pairs_omitted_total` | counter_delta | count | Conflict pairs omitted | none |
| `collaboration_conflict_model_compare_total` | counter_delta | count | Model comparisons | none |
| `collaboration_conflict_model_compare_failed_total` | counter_delta | count | Model comparisons failed | none |
| `collaboration_conflict_context_included_total` | counter_delta | count | Context included | none |
| `collaboration_conflict_context_omitted_total` | counter_delta | count | Context omitted | none |

## Security Metrics

| Name | Type | Unit | Description | Labels | Allowed Values |
|------|------|------|-------------|--------|----------------|
| `security_auth_attempt` | counter_delta | count | Authentication attempts | `result`, `method` | result: `success`, `failure`; method: `bearer`, `cookie`, `none` |
| `security_auth_denied` | counter_delta | count | Authorization denied | `permission`, `routeClass` | (open) |
| `security_rate_limited` | counter_delta | count | Rate-limited requests rejected | `routeClass`, `scope` | scope: `pre_auth`, `post_auth` |
| `security_redaction` | counter_delta | count | Redaction events | `classification`, `sink` | sink: `response`, `sse`, `audit`, `log` |
| `security_sse_active` | gauge | count | Active SSE stream connections | `stream` | stream: `observability`, `session`, `audit` |
| `security_audit_append` | counter_delta | count | Audit log append operations | `result` | result: `success`, `failure` |
| `security_config_verified` | counter_delta | count | Config verification outcomes | `state` | state: `valid`, `invalid`, `expired`, `unsigned` |
| `security_gate_result` | counter_delta | count | Security gate evaluation results | `result` | result: `pass`, `fail`, `warn` |
| `security_gate_duration` | histogram_sample | ms | Security gate evaluation duration | `result` | result: `pass`, `fail`, `warn` |

### Security metric routes

- `security_auth_attempt`, `security_auth_denied` — emitted by the auth middleware
- `security_rate_limited` — emitted by the rate-limiter middleware
- `security_redaction` — emitted by the redaction adapter before/after each redaction
- `security_sse_active` — emitted by the SSE connection tracker on connect/disconnect
- `security_audit_append` — emitted by the audit store on each append
- `security_config_verified` — emitted by the config verifier on startup and refresh
- `security_gate_result`, `security_gate_duration` — emitted by the security gate middleware

### Label policy

- **No path, ID, client address, token, or raw route in any label.**
- All label values are bounded to at most 128 characters.
- Label keys are limited to 8 per metric (far more than any current metric requires).
- When `allowedLabelValues` is defined, values outside the closed set are rejected.

## How to Add a New Metric

1. Add a `MetricDefinition` to either `PRODUCTION_METRIC_DEFINITIONS` or `SECURITY_METRIC_DEFINITIONS` in
   `src/observability/metric-registry.ts`.
2. If the metric name starts with `security_`, add it to `SECURITY_METRIC_DEFINITIONS`.
3. If the metric uses `counter_delta` or `gauge`, define its `allowedLabelKeys` and
   optional `allowedLabelValues`.
4. If the metric is a histogram, use `type: "histogram_sample"`.
5. Rebuild and re-run all tests.

### WASM metrics

WASM-compiled metrics remain **deferred** unless WASM is an active runtime target.
No WASM metric definitions are registered at this time.

## Query Semantics

The `MetricsStore.readAll()` method accepts:

```typescript
interface MetricsQuery {
  after?: string;      // ISO 8601 lower bound (inclusive)
  before?: string;     // ISO 8601 upper bound (inclusive)
  limit?: number;      // Max results (default 10000, max 100000)
  nameFilter?: string | string[];  // Metric name(s) to include
  order?: "asc" | "desc";   // File iteration order (default: "desc")
}
```

- **Filter ordering**: (1) metric name filter, (2) time-range filters, (3) limit.
- **Limit** is enforced AFTER all filters are applied.
- **Default `limit`** is 10000; the absolute maximum is 100000.
- **Order `"desc"`** (default) reads daily files newest-first. Within a file, rows are in append order.
- **Order `"asc"`** reads daily files oldest-first. Within a file, rows are in append order.
- All reads use `fs.createReadStream` with line-by-line parsing — no file is loaded entirely into memory.

### REST and CLI consumers

- REST endpoints return rows newest-first by default.
- CLI commands display rows in desc order (most recent observation first) unless `--asc` is passed.
- Pagination parameters (`limit`, `offset`) are applied server-side after all filters.

## Registry Modes

The `MetricRegistry` supports two modes:

- **`"strict"`** (default): Rejects any metric name not registered. Use in production.
- **`"compat"`**: Warns but accepts unregistered metric names. Use during migration of legacy metrics.

```typescript
const registry = new MetricRegistry({ mode: "strict" });
const compatRegistry = new MetricRegistry({ mode: "compat" });
```
