# P4.3 — Trend and Capacity Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add deterministic analytics over time-series metrics: latency percentiles (p50/p95/p99), error-rate trends, memory growth, provider degradation detection, coordination throughput, replan frequency, approval wait time, and ownership conflict rate.

**Architecture:** Query layer over the P4.1 `MetricsDb`. No predictive or ML analysis — pure deterministic aggregation. Results exposed via `alix monitoring analytics` CLI and `/api/monitoring/analytics` HTTP endpoint.

**Tech Stack:** TypeScript, Node `node:test`, `better-sqlite3`, existing `MetricsDb`

## Global Constraints

- All new tests use `node:test` + `node:assert/strict`
- All imports use `.js` extensions (NodeNext)
- Deterministic analytics only (no ML, no prediction)
- Analytics queries must complete within 5s for 30-day windows

---

### Task 1: Analytics query engine

**Files:**
- Create: `src/monitoring/analytics.ts`
- Test: `tests/monitoring/analytics.test.ts`

```typescript
class MetricsAnalytics {
  constructor(private db: MetricsDb) {}

  // Latency: p50/p95/p99 for timer metrics over a time window
  async latencyPercentiles(metricName: string, since: string, until: string): Promise<PercentilesResult>;

  // Error rate: count of error/failure metrics over total
  async errorRate(since: string, until: string): Promise<ErrorRateResult>;

  // Trend: slope direction over time (up/down/stable)
  async trend(metricName: string, since: string, until: string, bucketMinutes: number): Promise<TrendResult>;

  // Provider degradation: latency increase over baseline
  async providerHealth(providerNames: string[], since: string, until: string): Promise<ProviderHealthResult>;

  // Coordination: throughput, replan frequency, approval wait time
  async coordinationThroughput(since: string, until: string): Promise<CoordinationResult>;
  async replanFrequency(since: string, until: string): Promise<ReplanFrequencyResult>;
  async approvalWaitTime(since: string, until: string): Promise<ApprovalWaitResult>;
  async ownershipConflictRate(since: string, until: string): Promise<ConflictRateResult>;

  // Combined dashboard
  async dashboard(): Promise<DashboardResult>;
}
```

**Tests:**
- latencyPercentiles returns correct values for known data
- errorRate computes from counter metrics
- trend detects upward/downward slope
- providerHealth compares provider metrics
- Empty data returns empty/null results (doesn't crash)
- All queries complete within timeout

---

### Task 2: Analytics CLI command

**Files:**
- Modify: `src/cli/commands/monitoring.ts` (add analytics subcommands)

```
alix monitoring analytics latency <metric>  -- p50/p95/p99 for a timer metric
alix monitoring analytics errors           -- error rate summary
alix monitoring analytics providers        -- provider health comparison
alix monitoring analytics coordination     -- throughput/replan/approval stats
alix monitoring analytics dashboard        -- all analytics at a glance
```

---

### Task 3: Analytics API route

**Files:**
- Modify: `src/server/server.ts` (add `/api/monitoring/analytics` route)

`GET /api/monitoring/analytics` — returns full dashboard JSON
`GET /api/monitoring/analytics/latency?metric=X&since=Y&until=Z` — latency percentiles
`GET /api/monitoring/analytics/errors?since=Y&until=Z` — error rate

---

## Verification

1. Analytics queries match hand-computed values for known datasets
2. CLI commands produce formatted output
3. API routes return valid JSON
4. 30-day window queries complete within 5s
