# ALiX Observability Runbook

Operational reference for the ALiX observability subsystem (P4.2).

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `alix observability health` | Check system health |
| `alix observability metrics` | View metric summaries |
| `alix observability trends` | Trend analysis and anomaly detection |
| `alix observability alerts` | Evaluate alert rules |
| `alix observability export` | Full observability report (markdown or JSON) |
| `alix observability export --json` | Machine-readable JSON export |
| `alix observability export --session <id>` | Cost report for a specific session |

---

## CLI Commands

### `alix observability health`

Displays a side-effect-free health snapshot of the ALiX runtime. Reads persisted state from disk; never writes, never triggers recovery scans.

**Output includes:**
- Daemon status (healthy/degraded/unhealthy/unknown) with PID and heartbeat age
- Provider statuses with latency and error rate
- Coordination: active runs, total workers, failed workers
- Approvals: pending count, total count, oldest pending age
- Ownership: active leases, conflicts, expired leases
- Recovery: critical findings, total findings, unresolved count
- Resources: RSS memory, heap memory

**Health Statuses:**

| Status | Meaning | Color |
|--------|---------|-------|
| `healthy` | All systems nominal | Green |
| `degraded` | Some metrics outside thresholds | Yellow |
| `unhealthy` | Critical systems impaired | Red |
| `unknown` | No data available (daemon never started, no providers registered) | Dim |

**Overall health** is computed from the daemon status and all provider statuses:
- One `unhealthy` = overall `unhealthy`
- All `unknown` = overall `unknown`
- One `degraded` (with no unhealthy) = overall `degraded`
- All `healthy` = overall `healthy`
- Mixed healthy + unknown = `degraded`

### `alix observability metrics`

Displays aggregated metric summaries from the append-only JSONL metric store. Metrics are persisted under `.alix/observability/metrics/YYYY-MM-DD.jsonl`.

**Options:**
- `--name <name>` — Filter to a specific metric name
- `--limit <n>` — Max rows to scan (default: 50)

**Metric Types:**
- `counter_delta` — Per-sample increment amount
- `counter_total` — Monotonic cumulative counter value
- `gauge` — Point-in-time snapshot value
- `histogram_sample` — Individual observation for percentile computation

### `alix observability trends`

Performs windowed trend analysis and anomaly detection on metrics.

**Anomaly Detection:**
- Analyzes all metric rows from the last hour
- Requires at least 3 samples per metric name
- Uses z-score with default sensitivity of 2.0 (configurable via `--sensitivity`)
- Reports anomalies sorted by absolute z-score (descending)
- Uses `Math.floor(ts / windowSize) * windowSize` for bucket assignment (per spec)

**Options:**
- `--sensitivity <n>` — z-score threshold (default: 2.0)
- `--window <ms>` — Window size in milliseconds (default: 60000)
- `--max <n>` — Max anomaly results (default: 10)

### `alix observability alerts`

Evaluates all alert rules against the latest health snapshot. Returns a report of firing and resolved alerts. This is a stateless GET-style read — it always evaluates fresh and does not persist state.

**Firing alerts** are displayed with:
- Severity (CRITICAL, WARNING, INFO)
- Rule name
- Message with current values
- First triggered timestamp and occurrence count
- Acknowledged status if applicable

**Options:**
- `--acknowledge <id>` — Acknowledge a firing alert by its fingerprint

### `alix observability export`

Generates a comprehensive observability report including health, metrics, alerts, anomalies, and cost attribution.

**Options:**
- `--json` — JSON output (default: markdown)
- `--session <id>` — Scope cost data to a specific session

---

## Alert Rules

| Rule ID | Severity | Condition | Response |
|---------|----------|-----------|----------|
| `daemon_not_running` | CRITICAL | Daemon status is `unhealthy` | Start the daemon: `alix daemon start`. Check `.alix/daemon.json` for corruption. |
| `daemon_heartbeat_old` | WARNING | Daemon status is `degraded` (heartbeat > 5s) | Daemon may be unresponsive. Check PID and process health. |
| `approvals_backlog` | WARNING | More than 10 pending approvals, or oldest pending > 5 minutes | Review pending approvals with `alix approval list`. Process or reject old entries. |
| `recovery_critical_findings` | CRITICAL | Unresolved critical recovery findings | Run `alix recovery scan` to inspect. Address critical items first. |
| `ownership_conflicts` | WARNING | One or more ownership conflicts detected | Run `alix ownership list` to see conflicts. Resolve via `alix ownership release` or coordination. |
| `memory_high` | WARNING | RSS memory > 500 MB | Monitor trend. May indicate a leak. Use `alix observability trends --name mem` to track. |
| `memory_critical` | CRITICAL | RSS memory > 1000 MB | Take action: inspect active processes, consider restart. Leak likely. |
| `providers_unhealthy` | WARNING | One or more providers report `unhealthy` | Check provider API keys, network connectivity, and rate limits. |

**Alert Lifecycle:**
1. Condition becomes true -> Alert fires (`status: firing`, `firstTriggeredAt` set)
2. Condition remains true -> Deduplicated (`occurrences` incremented)
3. Condition clears -> After `cooldownMs` (default 30s), status becomes `resolved`
4. Acknowledged via `--acknowledge` -> `status: acknowledged`, suppressed from active list

---

## SSE Event Stream

**Endpoint:** `GET /api/observability/stream`

A Server-Sent Events stream that pushes live observability data.

**Events:**

| Event Type | Data | Frequency |
|------------|------|-----------|
| `connected` | `{ clientId, timestamp }` | On connect |
| `heartbeat` | `{ timestamp }` | Every 30s |
| `health.snapshot` | Full `RuntimeHealthSnapshot` | Every 2s |
| `alert.firing` | `AlertEvent` (per firing alert) | On each poll cycle |
| `metric.sample` | Array of `MetricRow` up to 5 distinct names | Every 2s |
| `anomaly.detected` | `AnomalyResult` | Every 2s |

**Headers set:**
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`

**Cleanup:** All watchers and timers are released on connection close.

---

## TUI Panels

### Health Panel

Available as the `"health"` TUI panel. Displays:
- Daemon status with color-coded indicator and heartbeat age
- Provider statuses with latency and error rate
- Coordination health (active runs, workers, failures)
- Approval backlog (pending count, oldest pending age)
- Ownership health (leases, conflicts, expirations)
- Recovery finding count (critical highlighted in red)
- Memory usage with color-coded threshold indicators

### Cost Panel

Available as the `"cost"` TUI panel. Displays:
- Total tokens and total cost
- Unknown-pricing model warnings
- Per-provider breakdown (tokens, cost, calls, average latency)
- Top 5 workflows by token usage

---

## Inspector API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/observability/health` | GET | Runtime health snapshot (Cache-Control: no-store) |
| `/api/observability/metrics` | GET | Metric summaries with optional `?name=` and `?after=` filters |
| `/api/observability/alerts` | GET | Currently firing alerts (stateless evaluation, no persistence) |
| `/api/observability/stream` | GET | SSE event stream for live observability data |

All API routes are GET-only, never mutate state, and set `Cache-Control: no-store`.

---

## Release Comparison Workflow

To compare two export snapshots (e.g. before/after a release):

```bash
# Before release
alix observability export --json > before-release.json

# After release
alix observability export --json > after-release.json

# Compare
diff <(jq --sort-keys . before-release.json) <(jq --sort-keys . after-release.json)
```

Key metrics to compare:
- `overallHealth` — Did health status change?
- `.alerts.firing` — Are there new firing alerts?
- `.health.resources.memoryRssMb` — Memory regression?
- `.cost.totalCost` — Cost change?
- `.anomalies` — New anomalies introduced?

---

## Retention Policy

| Data | Storage | Retention |
|------|---------|-----------|
| Raw metrics | `.alix/observability/metrics/YYYY-MM-DD.jsonl` | 7 days |
| Hourly rollups | `.alix/observability/rollups/hourly.jsonl` | 30 days |
| Daily rollups | `.alix/observability/rollups/daily.jsonl` | 365 days |

- Metrics are append-only JSONL files written via `createWriteStream({ flags: "a" })`
- All reads use `createReadStream` + `readline` for streaming
- Rollup and retention are enforced by `RollupStore.enforceRetention()`
- Metric labels are limited to 16 keys per row (cardinality control)
- Telemetry buffers are bounded at 10k entries with `drop_oldest` strategy

---

## Data Integrity

- **Health reads are side-effect-free**: `HealthProjectionCollector` reads persisted state and never writes. It never runs recovery scans.
- **Unknown provider state**: Providers without evidence return `"unknown"` status. Never reported as `healthy`.
- **Unknown pricing**: Models without a pricing entry return cost of `-1` (sentinel). No fabricated cost values.
- **Cost attribution uses streaming**: `CostAttribution.summary()` uses `createReadStream` + `readline` to process events without loading entire files into memory.
- **SSE cleanup**: All intervals and watchers are released on the `close` event.

---

## Troubleshooting

**"No metrics found"**
- Run some tasks to generate `model.usage` events
- Check `.alix/observability/metrics/` exists
- Verify `MetricsStore` base directory is writable

**Daemon shows "unknown"**
- No `.alix/daemon.json` found
- Daemon may never have been started: `alix daemon start`

**SSE stream disconnects**
- Check proxy/buffering settings (`X-Accel-Buffering: no` may be needed behind nginx)
- Default heartbeat at 30s keeps most NAT timeouts alive
- The stream reconnects with standard EventSource retry

**"Unknown pricing" in cost reports**
- The model is not in `PricingCatalog.defaultPricingCatalog()`
- Add pricing entry in `src/observability/cost-attribution.ts`
- Or accept the `-1` cost sentinel (no fabricated values)
