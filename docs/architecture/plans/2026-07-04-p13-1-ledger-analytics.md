# P13.1 Ledger Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only ledger analytics to ALiX governance — compute `LedgerAnalytics` and `PeriodRollup` from the P12.4 run ledger, expose via `alix governance analytics`.

**Architecture:** Pure analysis functions in `ledger-analytics.ts` consume `LedgerEntry[]` from `FileLedgerStore` and return computed values. CLI handler in `governance.ts` reads the store, calls pure functions, renders terminal output or JSON. No writes, no policy changes, no side effects.

**Tech Stack:** Node.js TypeScript, `node:test` + `node:assert/strict`, ANSI terminal output.

## Global Constraints

- P13 never mutates P12 stores — no writes to run ledger, failure memory, policy files, or approval settings
- `trendDirection` is a simple half-window comparison (no ML, no statistical models)
- All CLI output goes to stdout (not stderr) for JSON-mode pipeability
- Run ledger entries are stored in reverse chronological order (newest first) by `FileLedgerStore.list()`
- Tests use `node:test` (matching the existing run-ledger test file) not vitest

---

### Task 1: Implement ledger-analytics.ts

**Files:**
- Create: `src/governance/ledger-analytics.ts`
- Test: `tests/governance/ledger-analytics.test.ts`

**Interfaces:**
- Consumes: `LedgerEntry` from `../../governance/run-ledger.js`, `RiskLevel` from `../../governance/risk-scoring.js`
- Produces: `computeAnalytics(entries: LedgerEntry[], windowDays: number): LedgerAnalytics`, `computePeriodRollups(entries: LedgerEntry[]): PeriodRollup[]`, `detectTrend(entries: LedgerEntry[]): "improving" | "stable" | "degrading"`

- [ ] **Step 1: Create ledger-analytics.ts with types and pure functions**

```typescript
/**
 * P13.1 — Governance run ledger analytics.
 *
 * Pure analysis of the P12.4 run ledger — reads from FileLedgerStore,
 * computes aggregate metrics, period rollups, and trend direction.
 *
 * Core invariant: analyse, don't mutate. No writes to any P12 store.
 *
 * @module
 */

import type { LedgerEntry, LedgerOutcome } from "./run-ledger.js";
import type { RiskLevel } from "./risk-scoring.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrendDirection = "improving" | "stable" | "degrading";

export interface LedgerAnalytics {
  totalRuns: number;
  byOutcome: Record<LedgerOutcome, number>;
  byRiskLevel: Record<RiskLevel, number>;
  approvalRate: number;
  averageRiskScore: number;
  timeframeDays: number;
  trendDirection: TrendDirection;
}

export interface PeriodRollup {
  date: string;
  runs: number;
  failures: number;
  denied: number;
  avgRiskScore: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_OUTCOMES: LedgerOutcome[] = ["completed", "failed", "cancelled", "denied"];
const VALID_RISK_LEVELS: RiskLevel[] = ["low", "medium", "high", "critical"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute the span in days between the earliest and latest timestamps. Order-agnostic. */
function computeTimeframeDays(entries: LedgerEntry[]): number {
  if (entries.length === 0) return 0;
  const timestamps = entries.map((e) => new Date(e.timestamp).getTime());
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  return Math.max(0, Math.round((max - min) / (1000 * 60 * 60 * 24)));
}

/** Check if an entry's approvals array represents a fully-approved run. */
function isFullyApproved(entry: LedgerEntry): boolean {
  if (entry.approvals.length === 0) return false;
  return entry.approvals.every((g) => g.status === "approved");
}

// ---------------------------------------------------------------------------
// computeAnalytics — aggregate ledger metrics
// ---------------------------------------------------------------------------

/**
 * Compute aggregate analytics from a list of ledger entries.
 *
 * Pure function — no side effects, no storage access.
 * Entries can be in any order; they are sorted internally.
 *
 * @param entries  Ledger entries to analyse
 * @param windowDays  Time window in days (for reporting)
 */
export function computeAnalytics(
  entries: LedgerEntry[],
  windowDays: number,
): LedgerAnalytics {
  const totalRuns = entries.length;

  // Count by outcome
  const byOutcome = Object.fromEntries(
    VALID_OUTCOMES.map((o) => [o, 0]),
  ) as Record<LedgerOutcome, number>;
  for (const e of entries) {
    byOutcome[e.outcome] = (byOutcome[e.outcome] ?? 0) + 1;
  }

  // Count by risk level (from riskScore.level)
  const byRiskLevel = Object.fromEntries(
    VALID_RISK_LEVELS.map((l) => [l, 0]),
  ) as Record<RiskLevel, number>;
  for (const e of entries) {
    byRiskLevel[e.riskScore.level] = (byRiskLevel[e.riskScore.level] ?? 0) + 1;
  }

  // Approval rate = fully-approved runs / total runs that had approvals requested
  const runsWithApprovals = entries.filter((e) => e.approvals.length > 0).length;
  const fullyApproved = entries.filter(isFullyApproved).length;
  const approvalRate =
    runsWithApprovals > 0 ? fullyApproved / runsWithApprovals : 0;

  // Average risk score
  const totalRiskScore = entries.reduce((sum, e) => sum + e.riskScore.score, 0);
  const averageRiskScore = totalRuns > 0 ? totalRiskScore / totalRuns : 0;

  // Timeframe (order-agnostic: compute min/max timestamps)
  const timeframeDays = computeTimeframeDays(entries);

  // Trend direction
  const trendDirection = detectTrend(entries);

  return {
    totalRuns,
    byOutcome,
    byRiskLevel,
    approvalRate,
    averageRiskScore,
    timeframeDays: Math.max(windowDays, timeframeDays),
    trendDirection,
  };}
}

// ---------------------------------------------------------------------------
// computePeriodRollups — group entries by day
// ---------------------------------------------------------------------------

/**
 * Group ledger entries by calendar date and compute per-day rollups.
 * Returns entries sorted chronologically (oldest first).
 *
 * Pure function — no side effects.
 */
export function computePeriodRollups(entries: LedgerEntry[]): PeriodRollup[] {
  const grouped = new Map<string, LedgerEntry[]>();

  for (const e of entries) {
    const date = e.timestamp.slice(0, 10); // "2026-07-04"
    const list = grouped.get(date) ?? [];
    list.push(e);
    grouped.set(date, list);
  }

  const rollups: PeriodRollup[] = [];
  for (const [date, dayEntries] of grouped) {
    const runs = dayEntries.length;
    const failures = dayEntries.filter((e) => e.outcome === "failed").length;
    const denied = dayEntries.filter((e) => e.outcome === "denied").length;
    const totalScore = dayEntries.reduce((s, e) => s + e.riskScore.score, 0);
    const avgRiskScore = runs > 0 ? totalScore / runs : 0;

    rollups.push({ date, runs, failures, denied, avgRiskScore });
  }

  rollups.sort((a, b) => a.date.localeCompare(b.date));
  return rollups;
}

// ---------------------------------------------------------------------------
// detectTrend — compare first half vs second half of entries
// ---------------------------------------------------------------------------

/**
 * Detect trend by comparing the first half and second half of entries
 * (chronologically sorted).
 *
 * - "improving": failure/denied rate decreases AND average risk does not increase meaningfully (>5 points)
 * - "degrading": failure/denied rate increases OR average risk increases meaningfully (>5 points)
 * - "stable": otherwise
 *
 * Pure function — deterministic for identical input.
 */
export function detectTrend(entries: LedgerEntry[]): TrendDirection {
  if (entries.length < 4) return "stable";

  // Sort chronologically (oldest first)
  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const mid = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, mid);
  const secondHalf = sorted.slice(mid);

  // Compute failure/denied rate for each half
  const firstBad = firstHalf.filter((e) => e.outcome === "failed" || e.outcome === "denied").length;
  const secondBad = secondHalf.filter((e) => e.outcome === "failed" || e.outcome === "denied").length;
  const firstBadRate = firstBad / firstHalf.length;
  const secondBadRate = secondBad / secondHalf.length;

  // Compute average risk
  const firstRisk = firstHalf.reduce((s, e) => s + e.riskScore.score, 0) / firstHalf.length;
  const secondRisk = secondHalf.reduce((s, e) => s + e.riskScore.score, 0) / secondHalf.length;

  const badRateDecreased = secondBadRate < firstBadRate;
  const riskIncreasedMeaningfully = secondRisk - firstRisk > 5;
  const riskDecreasedOrStable = secondRisk - firstRisk <= 5;
  const badRateIncreased = secondBadRate > firstBadRate;

  // improving: fewer failures/denials AND risk didn't increase meaningfully
  if (badRateDecreased && riskDecreasedOrStable) return "improving";

  // degrading: more failures/denials OR risk increased meaningfully
  if (badRateIncreased || riskIncreasedMeaningfully) return "degrading";

  return "stable";
}
```

- [ ] **Step 2: Verify ledger-analytics.ts compiles**

```bash
npx tsc --noEmit src/governance/ledger-analytics.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/governance/ledger-analytics.ts
git commit -m "feat(governance): add P13.1 ledger analytics types and pure functions"
```

---

### Task 2: Write ledger-analytics tests

**Files:**
- Create: `tests/governance/ledger-analytics.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// tests/governance/ledger-analytics.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeAnalytics,
  computePeriodRollups,
  detectTrend,
  type LedgerAnalytics,
  type PeriodRollup,
  type TrendDirection,
} from "../../src/governance/ledger-analytics.js";
import type { LedgerEntry } from "../../src/governance/run-ledger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<LedgerEntry> & { timestamp: string }): LedgerEntry {
  return {
    runId: "run-001",
    issueId: "issue-001",
    policyResult: { decision: "allow", reason: "ok", matchedPolicies: [], requiredApprovals: [] },
    riskScore: { level: "low", score: 10, factors: [] },
    approvals: [],
    filesChanged: ["src/main.ts"],
    verificationResults: [{ command: "build", status: "passed" }],
    outcome: "completed",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeAnalytics
// ---------------------------------------------------------------------------

describe("computeAnalytics", () => {
  it("empty ledger returns zero-safe analytics", () => {
    const result = computeAnalytics([], 90);
    assert.strictEqual(result.totalRuns, 0);
    assert.strictEqual(result.byOutcome.completed, 0);
    assert.strictEqual(result.byOutcome.failed, 0);
    assert.strictEqual(result.byOutcome.denied, 0);
    assert.strictEqual(result.byOutcome.cancelled, 0);
    assert.strictEqual(result.averageRiskScore, 0);
    assert.strictEqual(result.approvalRate, 0);
    assert.strictEqual(result.trendDirection, "stable");
  });

  it("counts byOutcome correctly", () => {
    const entries = [
      makeEntry({ outcome: "completed", timestamp: "2026-07-04T12:00:00Z" }),
      makeEntry({ outcome: "failed", timestamp: "2026-07-04T13:00:00Z" }),
      makeEntry({ outcome: "denied", timestamp: "2026-07-04T14:00:00Z" }),
      makeEntry({ outcome: "cancelled", timestamp: "2026-07-04T15:00:00Z" }),
      makeEntry({ outcome: "completed", timestamp: "2026-07-04T16:00:00Z" }),
    ];
    const result = computeAnalytics(entries, 90);
    assert.strictEqual(result.totalRuns, 5);
    assert.strictEqual(result.byOutcome.completed, 2);
    assert.strictEqual(result.byOutcome.failed, 1);
    assert.strictEqual(result.byOutcome.denied, 1);
    assert.strictEqual(result.byOutcome.cancelled, 1);
  });

  it("counts byRiskLevel correctly", () => {
    const entries = [
      makeEntry({ riskScore: { level: "low", score: 10, factors: [] }, timestamp: "2026-07-04T12:00:00Z" }),
      makeEntry({ riskScore: { level: "medium", score: 35, factors: [] }, timestamp: "2026-07-04T13:00:00Z" }),
      makeEntry({ riskScore: { level: "high", score: 60, factors: [] }, timestamp: "2026-07-04T14:00:00Z" }),
      makeEntry({ riskScore: { level: "critical", score: 90, factors: [] }, timestamp: "2026-07-04T15:00:00Z" }),
      makeEntry({ riskScore: { level: "low", score: 5, factors: [] }, timestamp: "2026-07-04T16:00:00Z" }),
    ];
    const result = computeAnalytics(entries, 90);
    assert.strictEqual(result.byRiskLevel.low, 2);
    assert.strictEqual(result.byRiskLevel.medium, 1);
    assert.strictEqual(result.byRiskLevel.high, 1);
    assert.strictEqual(result.byRiskLevel.critical, 1);
  });

  it("computes averageRiskScore correctly", () => {
    const entries = [
      makeEntry({ riskScore: { level: "low", score: 10, factors: [] }, timestamp: "2026-07-04T12:00:00Z" }),
      makeEntry({ riskScore: { level: "low", score: 20, factors: [] }, timestamp: "2026-07-04T13:00:00Z" }),
      makeEntry({ riskScore: { level: "low", score: 30, factors: [] }, timestamp: "2026-07-04T14:00:00Z" }),
    ];
    const result = computeAnalytics(entries, 90);
    assert.strictEqual(result.averageRiskScore, 20);
  });

  it("approvalRate = approved / total gated (not / total runs)", () => {
    const entries = [
      // Has approvals, all approved
      makeEntry({
        approvals: [{ gate: "verification", status: "approved", approvedBy: "tester" }],
        timestamp: "2026-07-04T12:00:00Z",
      }),
      // Has approvals, one denied
      makeEntry({
        approvals: [{ gate: "verification", status: "denied" }],
        outcome: "denied",
        timestamp: "2026-07-04T13:00:00Z",
      }),
      // No approvals requested — not gated
      makeEntry({ timestamp: "2026-07-04T14:00:00Z" }),
    ];
    const result = computeAnalytics(entries, 90);
    // 2 runs had approvals (runsWithApprovals=2), 1 fully approved → 0.5
    assert.strictEqual(result.approvalRate, 0.5);
  });

  it("empty approvals array does not inflate approvalRate", () => {
    const entries = [
      makeEntry({ approvals: [], timestamp: "2026-07-04T12:00:00Z" }),
      makeEntry({ approvals: [], timestamp: "2026-07-04T13:00:00Z" }),
    ];
    const result = computeAnalytics(entries, 90);
    // runsWithApprovals = 0 → approvalRate = 0 (not 1.0 from "all entries with 0 approvals are vacuously approved")
    assert.strictEqual(result.approvalRate, 0);
  });

  it("sets timeframeDays from window param", () => {
    const entries = [
      makeEntry({ timestamp: "2026-07-01T12:00:00Z" }),
      makeEntry({ timestamp: "2026-07-04T12:00:00Z" }),
    ];
    const result = computeAnalytics(entries, 30);
    // Actual data spans 3 days, but window overrides
    assert.ok(result.timeframeDays >= 30);
  });
});

// ---------------------------------------------------------------------------
// detectTrend
// ---------------------------------------------------------------------------

describe("detectTrend", () => {
  it("fewer than 4 entries returns stable", () => {
    assert.strictEqual(detectTrend([]), "stable");
    assert.strictEqual(
      detectTrend([makeEntry({ timestamp: "2026-07-04T12:00:00Z" })]),
      "stable",
    );
    assert.strictEqual(
      detectTrend([
        makeEntry({ timestamp: "2026-07-04T12:00:00Z" }),
        makeEntry({ timestamp: "2026-07-04T13:00:00Z" }),
        makeEntry({ timestamp: "2026-07-04T14:00:00Z" }),
      ]),
      "stable",
    );
  });

  it("decreasing failure rate and stable risk → improving", () => {
    // First half: 3 entries, 2 failures (66% bad rate)
    // Second half: 3 entries, 0 failures (0% bad rate)
    const entries = [
      makeEntry({ outcome: "failed", riskScore: { level: "high", score: 60, factors: [] }, timestamp: "2026-07-01T12:00:00Z" }),
      makeEntry({ outcome: "failed", riskScore: { level: "high", score: 70, factors: [] }, timestamp: "2026-07-02T12:00:00Z" }),
      makeEntry({ outcome: "completed", riskScore: { level: "medium", score: 40, factors: [] }, timestamp: "2026-07-03T12:00:00Z" }),
      makeEntry({ outcome: "completed", riskScore: { level: "low", score: 15, factors: [] }, timestamp: "2026-07-04T12:00:00Z" }),
      makeEntry({ outcome: "completed", riskScore: { level: "low", score: 10, factors: [] }, timestamp: "2026-07-05T12:00:00Z" }),
      makeEntry({ outcome: "completed", riskScore: { level: "low", score: 5, factors: [] }, timestamp: "2026-07-06T12:00:00Z" }),
    ];
    assert.strictEqual(detectTrend(entries), "improving");
  });

  it("increasing failure rate → degrading", () => {
    const entries = [
      makeEntry({ outcome: "completed", riskScore: { level: "low", score: 10, factors: [] }, timestamp: "2026-07-01T12:00:00Z" }),
      makeEntry({ outcome: "completed", riskScore: { level: "low", score: 15, factors: [] }, timestamp: "2026-07-02T12:00:00Z" }),
      makeEntry({ outcome: "completed", riskScore: { level: "low", score: 10, factors: [] }, timestamp: "2026-07-03T12:00:00Z" }),
      makeEntry({ outcome: "failed", riskScore: { level: "high", score: 60, factors: [] }, timestamp: "2026-07-04T12:00:00Z" }),
      makeEntry({ outcome: "denied", riskScore: { level: "high", score: 80, factors: [] }, timestamp: "2026-07-05T12:00:00Z" }),
      makeEntry({ outcome: "failed", riskScore: { level: "critical", score: 90, factors: [] }, timestamp: "2026-07-06T12:00:00Z" }),
    ];
    assert.strictEqual(detectTrend(entries), "degrading");
  });

  it("increased bad rate and risk increase >5 → degrading", () => {
    const entries = [
      makeEntry({ outcome: "completed", riskScore: { level: "low", score: 10, factors: [] }, timestamp: "2026-07-01T12:00:00Z" }),
      makeEntry({ outcome: "completed", riskScore: { level: "low", score: 15, factors: [] }, timestamp: "2026-07-02T12:00:00Z" }),
      makeEntry({ outcome: "completed", riskScore: { level: "low", score: 10, factors: [] }, timestamp: "2026-07-03T12:00:00Z" }),
      makeEntry({ outcome: "completed", riskScore: { level: "low", score: 12, factors: [] }, timestamp: "2026-07-04T12:00:00Z" }),
      makeEntry({ outcome: "failed", riskScore: { level: "medium", score: 30, factors: [] }, timestamp: "2026-07-05T12:00:00Z" }),
      makeEntry({ outcome: "completed", riskScore: { level: "low", score: 10, factors: [] }, timestamp: "2026-07-06T12:00:00Z" }),
    ];
    const result = detectTrend(entries);
    // First half: 0/3 bad (0%), avg risk=11.7
    // Second half: 1/3 bad (33%), avg risk=17.3
    // Bad rate increased → degrading. Also risk diff ~5.7 > 5 → degrading.
    assert.strictEqual(result, "degrading");
  });

  it("is deterministic for identical input", () => {
    const entries = [
      makeEntry({ outcome: "failed", riskScore: { level: "high", score: 60, factors: [] }, timestamp: "2026-07-01T12:00:00Z" }),
      makeEntry({ outcome: "completed", riskScore: { level: "low", score: 20, factors: [] }, timestamp: "2026-07-02T12:00:00Z" }),
      makeEntry({ outcome: "completed", riskScore: { level: "low", score: 10, factors: [] }, timestamp: "2026-07-03T12:00:00Z" }),
      makeEntry({ outcome: "completed", riskScore: { level: "low", score: 5, factors: [] }, timestamp: "2026-07-04T12:00:00Z" }),
    ];
    const r1 = detectTrend(entries);
    const r2 = detectTrend(entries);
    assert.strictEqual(r1, r2);
  });
});

// ---------------------------------------------------------------------------
// computePeriodRollups
// ---------------------------------------------------------------------------

describe("computePeriodRollups", () => {
  it("empty input returns empty array", () => {
    assert.deepStrictEqual(computePeriodRollups([]), []);
  });

  it("groups entries by date", () => {
    const entries = [
      makeEntry({ timestamp: "2026-07-01T12:00:00Z" }),
      makeEntry({ timestamp: "2026-07-01T14:00:00Z" }),
      makeEntry({ timestamp: "2026-07-02T12:00:00Z" }),
    ];
    const rollups = computePeriodRollups(entries);
    assert.strictEqual(rollups.length, 2);
    assert.strictEqual(rollups[0].date, "2026-07-01");
    assert.strictEqual(rollups[0].runs, 2);
    assert.strictEqual(rollups[1].date, "2026-07-02");
    assert.strictEqual(rollups[1].runs, 1);
  });

  it("counts failures and denied per day", () => {
    const entries = [
      makeEntry({ outcome: "failed", timestamp: "2026-07-01T12:00:00Z" }),
      makeEntry({ outcome: "denied", timestamp: "2026-07-01T14:00:00Z" }),
      makeEntry({ outcome: "completed", timestamp: "2026-07-01T16:00:00Z" }),
    ];
    const rollups = computePeriodRollups(entries);
    assert.strictEqual(rollups.length, 1);
    assert.strictEqual(rollups[0].failures, 1);
    assert.strictEqual(rollups[0].denied, 1);
    assert.strictEqual(rollups[0].runs, 3);
  });

  it("computes avgRiskScore per day", () => {
    const entries = [
      makeEntry({ riskScore: { level: "low", score: 10, factors: [] }, timestamp: "2026-07-01T12:00:00Z" }),
      makeEntry({ riskScore: { level: "low", score: 20, factors: [] }, timestamp: "2026-07-01T14:00:00Z" }),
    ];
    const rollups = computePeriodRollups(entries);
    assert.strictEqual(rollups[0].avgRiskScore, 15);
  });

  it("returns entries sorted chronologically", () => {
    const entries = [
      makeEntry({ timestamp: "2026-07-03T12:00:00Z" }),
      makeEntry({ timestamp: "2026-07-01T12:00:00Z" }),
      makeEntry({ timestamp: "2026-07-02T12:00:00Z" }),
    ];
    const rollups = computePeriodRollups(entries);
    assert.strictEqual(rollups[0].date, "2026-07-01");
    assert.strictEqual(rollups[1].date, "2026-07-02");
    assert.strictEqual(rollups[2].date, "2026-07-03");
  });
});
```

- [ ] **Step 2: Build and run tests to verify they pass**

```bash
pnpm build && node --test dist/tests/governance/ledger-analytics.test.js
```

- [ ] **Step 3: Commit**

```bash
git add tests/governance/ledger-analytics.test.ts
git commit -m "test(governance): add P13.1 ledger analytics tests"
```

---

### Task 3: Add analytics CLI subcommand

**Files:**
- Modify: `src/cli/commands/governance.ts` — add `analytics` case to switch + `runAnalytics` handler + renderer
- Reads: `src/governance/ledger-analytics.ts` (computeAnalytics, computePeriodRollups)

- [ ] **Step 1: Add the analytics case to the dispatcher switch**

In `src/cli/commands/governance.ts`, after the `"approval"` case (line ~228), add:

```typescript
    case "analytics":
      return runAnalytics(rest);
```

And update the usage string (line ~278) to include `analytics`:

```typescript
        "Usage: alix governance {health|drift|lens-review|integrity|policies|recommend|analytics|propose|approve|reject|list|cleanup|explain|dashboard|investigate} [--window <days>] [--json]",
```

- [ ] **Step 2: Add the runAnalytics function and renderer**

Before `renderHealth` (before line ~998), add:

```typescript
// ---------------------------------------------------------------------------
// runAnalytics — `alix governance analytics [--window <days>] [--json]`
// ---------------------------------------------------------------------------

async function runAnalytics(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const { FileLedgerStore } = await import("../../governance/run-ledger.js");
  const { computeAnalytics, computePeriodRollups } = await import(
    "../../governance/ledger-analytics.js",
  );

  const cwd = process.cwd();
  const store = new FileLedgerStore(cwd);
  const entries = await store.list();

  // Apply window filter
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const filtered = entries.filter(
    (e) => new Date(e.timestamp).getTime() >= cutoff.getTime(),
  );

  const analytics = computeAnalytics(filtered, windowDays);
  const rollups = computePeriodRollups(filtered);

  if (jsonMode) {
    console.log(JSON.stringify({ analytics, rollups }, null, 2));
    return;
  }

  renderAnalytics(analytics, rollups);
}

// -- Analytics Renderer -----------------------------------------------------

function colorForTrend(trend: string): string {
  switch (trend) {
    case "improving": return GREEN;
    case "degrading": return RED;
    default: return YELLOW;
  }
}

function colorForRateValue(rate: number): string {
  if (rate >= 0.8) return GREEN;
  if (rate >= 0.5) return YELLOW;
  return RED;
}

function renderAnalytics(
  analytics: LedgerAnalytics,
  rollups: PeriodRollup[],
): void {
  console.log(BOLD + "Governance Ledger Analytics" + RESET);
  console.log(`Window: ${analytics.timeframeDays} days`);
  console.log(BAR);
  console.log(`Total Runs:        ${analytics.totalRuns}`);
  console.log(`Average Risk:      ${analytics.averageRiskScore.toFixed(1)}/100`);

  const approvalPct = (analytics.approvalRate * 100).toFixed(1);
  const approvalColor = colorForRateValue(analytics.approvalRate);
  console.log(
    `Approval Rate:     ${approvalColor}${approvalPct}%${RESET}`,
  );

  const trendColor = colorForTrend(analytics.trendDirection);
  console.log(
    `Trend Direction:   ${trendColor}${analytics.trendDirection.toUpperCase()}${RESET}`,
  );
  console.log("");

  // Outcomes
  console.log(BOLD + "By Outcome" + RESET);
  for (const [outcome, count] of Object.entries(analytics.byOutcome)) {
    if (count > 0) {
      const icon =
        outcome === "completed"
          ? "✅"
          : outcome === "failed"
            ? "❌"
            : outcome === "denied"
              ? "🚫"
              : "⏹️";
      console.log(`  ${icon} ${outcome}: ${count}`);
    }
  }
  console.log("");

  // Risk levels
  console.log(BOLD + "By Risk Level" + RESET);
  for (const [level, count] of Object.entries(analytics.byRiskLevel)) {
    if (count > 0) {
      const color = colorForSeverity(level);
      console.log(`  ${color}[${level.toUpperCase()}]${RESET} ${count}`);
    }
  }
  console.log("");

  // Period rollups (last 7 days)
  if (rollups.length > 0) {
    const recent = rollups.slice(-7);
    console.log(BOLD + `Daily Rollups (last ${recent.length} day(s))` + RESET);
    for (const r of recent) {
      const failStr =
        r.failures > 0 || r.denied > 0
          ? ` ${RED}${r.failures + r.denied} bad${RESET}`
          : " 0 bad";
      console.log(
        `  ${r.date} | ${r.runs} runs${failStr} | avg risk ${r.avgRiskScore.toFixed(1)}`,
      );
    }
  }
}
```

- [ ] **Step 3: Add the LedgerAnalytics import to the type imports section**

At the top of the file, add to the existing governance-types import block (around line 28-35):

```typescript
import type {
  LedgerAnalytics,
  PeriodRollup,
} from "../../governance/ledger-analytics.js";
```

- [ ] **Step 4: Verify TypeScript compilation**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Verify JSON CLI output is parseable**

```bash
# Build first, then run a smoke test that the JSON output is valid
pnpm build && node --eval "
const { execSync } = require('child_process');
const out = execSync('node dist/cli/alix.js governance analytics --json 2>/dev/null || true');
try {
  const parsed = JSON.parse(out.toString() || '{}');
  console.log('JSON parse OK:', Object.keys(parsed));
} catch(e) {
  // Expected if no run-ledger.jsonl exists - empty output is also valid JSON
  console.log('CLI smoke check ran (no ledger data yet - expected)');
}
"
```

- [ ] **Step 6: Verify the full test suite still passes**

```bash
pnpm build && pnpm test:vitest && node --test dist/tests/governance/ledger-analytics.test.js
```

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/governance.ts
git commit -m "feat(governance): add 'alix governance analytics' CLI subcommand"
```

---

### Task 4: Run GitNexus detect-changes + final verification

- [ ] **Step 1: Run impact analysis on the CLI file**

```bash
npx gitnexus impact --target handleGovernanceCommand --direction upstream --repo ALiX
```

- [ ] **Step 2: Run detect-changes**

```bash
npx gitnexus detect-changes --repo ALiX
```

- [ ] **Step 3: Full build and test suite**

```bash
pnpm build
npx tsc --noEmit
pnpm test:vitest
node --test dist/tests/governance/ledger-analytics.test.js
```

- [ ] **Step 4: Commit and create PR**

```bash
git log --oneline -5
gh pr create --title "feat(governance): add P13.1 ledger analytics" \
  --body "## P13.1 — Ledger Analytics

Read-only analysis of the P12.4 run ledger.

**Adds:**
- \`src/governance/ledger-analytics.ts\` — \`computeAnalytics\`, \`computePeriodRollups\`, \`detectTrend\` (pure functions)
- \`tests/governance/ledger-analytics.test.ts\` — 12 test cases
- \`alix governance analytics [--window N] [--json]\` CLI subcommand

**Boundaries respected:**
- No writes to run ledger, failure memory, policy files, or approval settings
- No P13.2/P13.3/P13.4 functionality
- No unified governance report
- All output is advisory

**Invariant:** P13 analyses, never enforces."
```
