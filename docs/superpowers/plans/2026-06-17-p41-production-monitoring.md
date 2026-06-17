# P4.1 — Production Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add SQLite-backed time-series metrics storage, system resource collection, process/daemon health checks, provider latency percentiles, alert evaluation, and support-bundle export.

**Architecture:** Extends the existing in-memory `MinimalMetrics` with a persistent SQLite store (`MetricsDb`) that appends counter/timer events with timestamps. A `SystemMonitor` collects CPU/RAM/disk/network at configurable intervals. A `HealthChecker` evaluates daemon, provider, and agent health against thresholds. A `SupportBundleExporter` collects logs, metrics, config, and diagnostics into a single archive. All components are independent of each other and build on existing infrastructure.

**Tech Stack:** TypeScript, Node `node:test`, `better-sqlite3` (already a dependency), `node:os`, `node:child_process`, existing daemon/provider/audit infrastructure

## Global Constraints

- All new tests use `node:test` + `node:assert/strict`
- Stateful tests use `mkdtempSync` + `rmSync`
- `better-sqlite3` is the existing SQLite library — use it for metrics storage
- All imports use `.js` extensions (NodeNext)
- Metrics db path: `.alix/metrics/metrics.db`

---

### Task 1: MetricsDb — SQLite time-series persistence

**Files:**
- Create: `src/monitoring/metrics-db.ts`
- Test: `tests/monitoring/metrics-db.test.ts`

**Interfaces:**
- Consumes: `MinimalMetrics`, `MetricEvent` from `src/kernel/minimal-metrics.ts`
- Produces: `MetricsDb` with `appendEvents()`, `queryMetrics()`, `prune()`

Schema:
```sql
CREATE TABLE IF NOT EXISTS metric_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,       -- "counter" | "timer"
  value REAL NOT NULL,
  labels TEXT,              -- JSON string of labels
  timestamp TEXT NOT NULL    -- ISO 8601
);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_type TEXT NOT NULL,  -- "system" | "provider" | "heartbeat"
  payload TEXT NOT NULL,        -- JSON
  collected_at TEXT NOT NULL    -- ISO 8601
);

CREATE INDEX idx_metric_events_name ON metric_events(name);
CREATE INDEX idx_metric_events_timestamp ON metric_events(timestamp);
CREATE INDEX idx_metric_snapshots_type ON metric_snapshots(snapshot_type);
```

- `MetricsDb(dbPath)` — opens/creates SQLite db at path
- `appendEvents(events: MetricEvent[])` — bulk insert with prepared statement
- `queryMetrics(name, since, until, groupBy?)` — returns aggregated results
- `queryPercentiles(name, since, until, percentiles)` — P50/P95/P99 for timer metrics
- `prune(retentionDays: number)` — delete events/snapshots older than retention
- `close()` — clean shutdown

**Tests:**
- Creates tables on init
- Append and retrieve metric events
- Query by name, time range, labels
- Percentile query returns correct P50/P95/P99
- Prune removes old data, keeps recent data
- Multiple batches append correctly

---

### Task 2: SystemMonitor — resource collection

**Files:**
- Create: `src/monitoring/system-monitor.ts`
- Test: `tests/monitoring/system-monitor.test.ts`

**Interfaces:**
- Consumes: `MetricsDb`
- Produces: `SystemMonitor` with `collect()`, `start(intervalMs)`, `stop()`

```typescript
class SystemMonitor {
  constructor(private db: MetricsDb, private options?: SystemMonitorOptions) {}

  /** Collect a single snapshot of system resources. */
  async collect(): Promise<SystemSnapshot>;

  /** Start periodic collection at the configured interval (default 60s). */
  start(): void;

  /** Stop periodic collection. */
  stop(): void;
}

interface SystemSnapshot {
  cpu: { loadAvg: number[]; usagePercent: number };
  memory: { totalBytes: number; freeBytes: number; usedPercent: number };
  disk: { totalBytes: number; freeBytes: number; usedPercent: number };
  uptime: number;
  timestamp: string;
}
```

System resource collection uses:
- `os.loadavg()`, `os.cpus()` for CPU
- `os.totalmem()`, `os.freemem()` for memory
- `os.uptime()` for uptime
- `execSync('df -k .')` or `fs.statfs` for disk (cross-platform: try both, fallback to 0)

**Tests:**
- collect() returns structured snapshot with all fields
- start() calls collect() on interval
- stop() clears interval
- Snapshots are stored in metric_snapshots table

---

### Task 3: HealthChecker — daemon/provider/agent health

**Files:**
- Create: `src/monitoring/health-checker.ts`
- Test: `tests/monitoring/health-checker.test.ts`

**Interfaces:**
- Consumes: `MetricsDb`, `DaemonManager`, provider instances
- Produces: `HealthChecker` with `checkAll()`, `checkDaemon()`, `checkProviders()`, `checkAlerts()`

```typescript
interface HealthStatus {
  healthy: boolean;
  checks: HealthCheck[];
  timestamp: string;
}

interface HealthCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  metric?: number;
  threshold?: number;
  message: string;
}

interface AlertRule {
  name: string;
  metricName: string;
  condition: "gt" | "lt" | "eq";
  threshold: number;
  windowMinutes: number;
  severity: "info" | "warning" | "critical";
}
```

- `checkDaemon()` — verifies daemon process is running (via `DaemonManager.status()`)
- `checkProviders()` — for each configured provider, check last successful call within threshold
- `checkMetrics(rule: AlertRule)` — query recent metric data and evaluate condition
- `evaluateAlerts(rules: AlertRule[])` — run all alert rules, return triggered alerts
- `checkAll()` — run all checks and return composite status

**Tests:**
- checkDaemon returns pass/fail based on mock DaemonManager
- checkProviders returns pass/fail for healthy/unhealthy providers
- evaluateAlerts triggers when metric exceeds threshold
- evaluateAlerts passes when metric is within bounds
- Composite status is healthy when all checks pass

---

### Task 4: SupportBundle — diagnostics export

**Files:**
- Create: `src/monitoring/support-bundle.ts`
- Test: `tests/monitoring/support-bundle.test.ts`

**Interfaces:**
- Consumes: `MetricsDb`, `AuditStore`, daemon state, config
- Produces: `SupportBundle` with `export(outputPath: string)`

```typescript
class SupportBundle {
  async export(outputPath: string): Promise<{ path: string; size: number; entries: string[] }>;
}
```

Collects into a tar/zip directory:
- `.alix/metrics/metrics.db` — metrics database
- `.alix/audit/audit.jsonl` — audit log
- `.alix/approvals/approvals.json` — approval records
- Config files (`alix.json` / `config.yaml`)
- Daemon tasks state (`daemon-tasks.json`)
- System snapshot (collected now)
- Log files (`*.log`)
- Provider diagnostics
- Error summary

Uses simple directory copy + tar (via `tar` CLI or `node:zlib` + `node:fs`). If no `tar` is available, creates a directory with all files.

**Tests:**
- Export creates output at specified path
- Exported bundle contains expected files
- Handles missing files gracefully (warn, continue)
- Export is deterministic (same input → same contents)

---

### Task 5: Monitoring CLI commands

**Files:**
- Create: `src/cli/commands/monitoring.ts`
- Test: `tests/cli/monitoring.test.ts`

Adds to `alix monitoring` subcommand tree:

```
alix monitoring status         — show current system/resources/metrics status
alix monitoring metrics        — query recent metrics with filters
alix monitoring health         — run health checks
alix monitoring alerts         — evaluate alert rules
alix monitoring support-bundle — export diagnostic bundle
alix monitoring start          — start continuous collection (daemon mode)
alix monitoring stop           — stop continuous collection
```

Wire into the CLI arg parser (pattern follows existing commands in `src/cli/commands/`).

**Tests:**
- Command dispatches to correct handler
- status command returns formatted output
- metrics command accepts name/since/until filters
- support-bundle creates output file

---

### Task 6: Wire daemon integration and boot

**Files:**
- Modify: `src/daemon/daemon-manager.ts` (if needed for health check hooks)
- Modify: `src/cli/run-args.ts` (register monitoring subcommand)

Integrate `SystemMonitor` startup when daemon starts. Wire into `startServer()` or daemon initialization. Register the monitoring command in the CLI router.

**Tests:**
- Daemon start triggers system monitor
- Monitoring CLI command is registered
- All existing tests still pass

---

## Verification

1. `npm run build` — clean build
2. `node --test dist/tests/monitoring/*.test.js` — all monitoring tests pass
3. `npm run test:node:ci` — full suite passes
4. `alix monitoring status` — shows system resources
5. `alix monitoring support-bundle /tmp/alix-support.tar.gz` — creates valid bundle
