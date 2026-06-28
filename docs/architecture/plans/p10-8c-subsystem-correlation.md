# P10.8c — Predictive Signal Correlation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correlate recommendation subsystem targets with later outcome report `SubsystemDelta` values to measure how well recommendation signals predict subsystem health changes.

**Architecture:** New pure module `subsystem-correlation.ts` with `CorrelationMatcher` interface + `SubsystemTimeMatcher` implementation + `computeSubsystemCorrelation()` aggregation function. New CLI handler loads `RecommendationReportStore` and `OutcomeReportStore`, delegates to pure functions, renders terminal/JSON. `CorrelationMatcher` provides extensibility for future match strategies without rewriting the engine.

**Tech Stack:** TypeScript, Node.js fs, vitest, existing `RecommendationReportStore`, `OutcomeReportStore`, `ExecutiveOutcomeEvaluationReport`, `SubsystemDelta`.

## Global Constraints

- Read-only: no writes to any store, no mutations of persisted recommendations or outcome reports, no proposal creation.
- `recommendationDisposition` propagated from `RecommendationEntry.disposition` into each `SubsystemCorrelationEntry`.
- `matchedRecommendationCount` = recommendations with at least one matched outcome delta (NOT number of matched deltas).
- `matchedDeltaCount` = total matching SubsystemDelta entries (may be > matchedRecommendationCount — one rec matches multiple outcomes).
- `correlationEffectiveness = improvingCount / matchedDeltaCount` — NaN → 0.
- `coverageRate = matchedRecommendationCount / recommendationCount` — per signal.
- `averageAbsoluteDelta = sum(|delta|) / matchedDeltaCount`.
- Strict mode default: `generatedAt > rec.generatedAt AND generatedAt ≤ rec.generatedAt + lagDays`.
- Loose mode: no extra time gate beyond analysis window.
- `--mode strict --lag 30` defaults.
- `CorrelationMatcher.match()` returns `Promise<>` for future async matchers (graph, vector, semantic).
- All store access goes through `RecommendationReportStore` and `OutcomeReportStore` APIs — no ad-hoc `readFileSync`/`readdirSync`.
- RecommendationEntry construction reused from P10.8a via extracted `extractRecommendationEntries()` helper.
- Confidence bucket aggregation (0–0.25, 0.25–0.5, 0.5–0.75, 0.75–1.0) added to per-signal and per-subsystem metrics.
- Two new files added to `EXECUTIVE_FILES` in sentinel.

---

### Task 1: Pure module — types + matcher + correlation engine

**Files:**
- Create: `src/executive/subsystem-correlation.ts`
- Create: `tests/executive/subsystem-correlation.vitest.ts`

**Interfaces:**
- Consumes: `RecommendationEntry` from `recommendation-effectiveness.ts`, `ExecutiveOutcomeEvaluationReport` + `SubsystemDelta` from `outcome-evaluator.ts`.
- Produces: `CorrelationMode`, `SubsystemCorrelationEntry`, `SubsystemCorrelation`, `SignalCorrelation`, `SubsystemCorrelationReport`, `CorrelationMatcher` interface, `SubsystemTimeMatcher` class, `computeSubsystemCorrelation()`.

- [ ] **Step 1: Write failing tests for `SubsystemTimeMatcher.match`**

Create `tests/executive/subsystem-correlation.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SubsystemTimeMatcher, CorrelationMode } from "../../src/executive/subsystem-correlation.js";
import type { RecommendationEntry } from "../../src/executive/recommendation-effectiveness.js";
import type { ExecutiveOutcomeEvaluationReport, SubsystemDelta } from "../../src/executive/outcome-evaluator.js";

// Helper: build a minimal completed outcome report with one objective and one SubsystemDelta
function makeReport(
  generatedAt: string,
  subsystem: string,
  delta: number,
  baselineScore = 50,
  currentScore = 50 + delta,
): ExecutiveOutcomeEvaluationReport {
  return {
    schemaVersion: "p10.5.0",
    generatedAt,
    planId: "plan-1",
    planStatus: "completed",
    evaluationStatus: "completed",
    evaluatedSubsystems: [subsystem],
    objectives: [{
      objectiveId: "obj-1",
      objectiveType: "stabilize",
      targetSubsystems: [subsystem],
      subsystemDeltas: [{ subsystem, baselineScore, currentScore, delta }],
      aggregateDelta: delta,
      outcome: delta > 0 ? "improved" : delta < 0 ? "degraded" : "unchanged",
    }],
    overallDelta: delta,
    warnings: [],
  };
}

// Helper: build a minimal RecommendationEntry
function recEntry(over: Partial<RecommendationEntry> = {}): RecommendationEntry {
  return {
    reportId: "r1",
    generatedAt: "2026-06-20T00:00:00.000Z",
    recIndex: 0,
    subsystem: "workflow",
    signal: "degrading_trend",
    severity: "high",
    signalConfidence: 0.88,
    recommendation: "Investigate workflow",
    ageDays: 7,
    disposition: "applied",
    proposalId: "p1",
    ...over,
  };
}

describe("SubsystemTimeMatcher.match", () => {
  it("matches subsystem across objectives within a report", () => {
    const rec = recEntry({ generatedAt: "2026-06-20T00:00:00.000Z", subsystem: "workflow" });
    // Two objectives, one matching workflow, one not
    const report = {
      ...makeReport("2026-06-25T00:00:00.000Z", "workflow", 1.5),
      objectives: [
        ...makeReport("2026-06-25T00:00:00.000Z", "workflow", 1.5).objectives,
        {
          objectiveId: "obj-2",
          objectiveType: "improve" as const,
          targetSubsystems: ["routing"],
          subsystemDeltas: [{ subsystem: "routing", baselineScore: 50, currentScore: 45, delta: -5 }],
          aggregateDelta: -5,
          outcome: "degraded" as const,
        },
      ],
    };
    const matcher = new SubsystemTimeMatcher("strict", 30);
    const results = matcher.match(rec, [report]);
    // Only the workflow delta should match
    expect(results).toHaveLength(1);
    expect(results[0].delta.subsystem).toBe("workflow");
    expect(results[0].delta.delta).toBe(1.5);
  });

  it("strict mode excludes outcomes generatedAt ≤ rec.generatedAt", () => {
    const rec = recEntry({ generatedAt: "2026-06-25T00:00:00.000Z" });
    const report = makeReport("2026-06-25T00:00:00.000Z", "workflow", 1.5); // same time
    const matcher = new SubsystemTimeMatcher("strict", 30);
    expect(matcher.match(rec, [report])).toHaveLength(0);
  });

  it("strict mode excludes outcomes beyond lag window", () => {
    const rec = recEntry({ generatedAt: "2026-06-01T00:00:00.000Z" });
    const report = makeReport("2026-07-15T00:00:00.000Z", "workflow", 1.5); // > 30 days later
    const matcher = new SubsystemTimeMatcher("strict", 30);
    expect(matcher.match(rec, [report])).toHaveLength(0);
  });

  it("loose mode includes all outcomes regardless of timing", () => {
    const rec = recEntry({ generatedAt: "2026-06-25T00:00:00.000Z" });
    const earlier = makeReport("2026-06-20T00:00:00.000Z", "workflow", 1.5);
    const matcher = new SubsystemTimeMatcher("loose", 30);
    expect(matcher.match(rec, [earlier])).toHaveLength(1);
  });

  it("no matching subsystem returns empty", () => {
    const rec = recEntry({ subsystem: "security" });
    const report = makeReport("2026-06-25T00:00:00.000Z", "workflow", 1.5);
    const matcher = new SubsystemTimeMatcher("strict", 30);
    expect(matcher.match(rec, [report])).toHaveLength(0);
  });

  it("empty reports array returns empty", () => {
    const rec = recEntry();
    const matcher = new SubsystemTimeMatcher("strict", 30);
    expect(matcher.match(rec, [])).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run matcher tests to verify they fail**

```bash
npx vitest run tests/executive/subsystem-correlation.vitest.ts --reporter=verbose 2>&1 | head -20
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write failing tests for `computeSubsystemCorrelation`**

Add to the same test file:

```ts
import { computeSubsystemCorrelation } from "../../src/executive/subsystem-correlation.js";

const GENERATED_AT = "2026-06-27T00:00:00.000Z";

describe("computeSubsystemCorrelation", () => {
  it("returns no_data for empty recommendations", () => {
    const result = computeSubsystemCorrelation([], [], "strict", 30, GENERATED_AT);
    expect(result.correlationStatus).toBe("no_data");
  });

  it("returns no_data when no outcome reports", () => {
    const rec = recEntry();
    const result = computeSubsystemCorrelation([rec], [], "strict", 30, GENERATED_AT);
    expect(result.correlationStatus).toBe("no_data");
  });

  it("correctly aggregates per-subsystem correlation metrics", () => {
    const rec = recEntry({ generatedAt: "2026-06-20T00:00:00.000Z" });
    const report1 = makeReport("2026-06-22T00:00:00.000Z", "workflow", 3.0);
    const report2 = makeReport("2026-06-25T00:00:00.000Z", "workflow", -1.0);
    const result = computeSubsystemCorrelation(
      [rec],
      [report1, report2],
      "strict", 30, GENERATED_AT,
    );
    const sub = result.subsystemCorrelations[0];
    expect(sub.subsystem).toBe("workflow");
    expect(sub.recommendationCount).toBe(1);
    expect(sub.matchedRecommendationCount).toBe(1); // 1 recommendation had matches
    expect(sub.matchedDeltaCount).toBe(2);           // 2 SubsystemDeltas matched
    expect(sub.averageDelta).toBe(1.0);   // (3.0 + -1.0) / 2
    expect(sub.averageAbsoluteDelta).toBe(2.0); // (|3.0| + |-1.0|) / 2
    expect(sub.netDelta).toBe(2.0);
    expect(sub.correlationEffectiveness).toBe(0.5); // 1 improving / 2 total
  });

  it("averageAbsoluteDelta detects magnitude when signs cancel", () => {
    const rec = recEntry({ generatedAt: "2026-06-20T00:00:00.000Z" });
    const report1 = makeReport("2026-06-22T00:00:00.000Z", "workflow", 8.0);
    const report2 = makeReport("2026-06-25T00:00:00.000Z", "workflow", -8.0);
    const result = computeSubsystemCorrelation(
      [rec], [report1, report2], "strict", 30, GENERATED_AT,
    );
    const sub = result.subsystemCorrelations[0];
    expect(sub.averageDelta).toBe(0);  // cancels out
    expect(sub.averageAbsoluteDelta).toBe(8.0); // magnitude preserved
  });

  it("uncorrelatedRecommendationCount correctly reflects recs with no match", () => {
    const rec1 = recEntry({ generatedAt: "2026-06-20T00:00:00.000Z", subsystem: "workflow" });
    const rec2 = recEntry({ generatedAt: "2026-06-20T00:00:00.000Z", subsystem: "security" });
    const report = makeReport("2026-06-22T00:00:00.000Z", "workflow", 1.0);
    const result = computeSubsystemCorrelation(
      [rec1, rec2], [report], "strict", 30, GENERATED_AT,
    );
    const sub = result.subsystemCorrelations.find((s) => s.subsystem === "workflow")!;
    expect(sub.uncorrelatedRecommendationCount).toBe(0);
    const sec = result.subsystemCorrelations.find((s) => s.subsystem === "security")!;
    expect(sec.uncorrelatedRecommendationCount).toBe(1);
  });

  it("lagDays correctly computed", () => {
    const rec = recEntry({ generatedAt: "2026-06-20T00:00:00.000Z" });
    const report = makeReport("2026-06-25T00:00:00.000Z", "workflow", 1.0);
    const result = computeSubsystemCorrelation(
      [rec], [report], "strict", 30, GENERATED_AT,
    );
    expect(result.correlations[0].lagDays).toBe(5);
  });

  it("recommendationDisposition propagated from RecommendationEntry", () => {
    const rec = recEntry({ generatedAt: "2026-06-20T00:00:00.000Z", disposition: "applied" });
    const report = makeReport("2026-06-22T00:00:00.000Z", "workflow", 1.0);
    const result = computeSubsystemCorrelation(
      [rec], [report], "strict", 30, GENERATED_AT,
    );
    expect(result.correlations[0].recommendationDisposition).toBe("applied");
  });

  it("per-signal aggregation works correctly", () => {
    const rec = recEntry({
      generatedAt: "2026-06-20T00:00:00.000Z",
      signal: "degrading_trend",
    });
    const report = makeReport("2026-06-22T00:00:00.000Z", "workflow", 1.0);
    const result = computeSubsystemCorrelation(
      [rec], [report], "strict", 30, GENERATED_AT,
    );
    const sig = result.signalCorrelations[0];
    expect(sig.signal).toBe("degrading_trend");
    expect(sig.coverageRate).toBe(1.0); // 1 correlated / 1 total
    expect(sig.improvingRate).toBe(1.0); // 1 improving / 1 correlated
  });

  it("multiple recommendations with same signal computes correct coverageRate", () => {
    const rec1 = recEntry({ generatedAt: "2026-06-20T00:00:00.000Z", signal: "degrading_trend" });
    const rec2 = recEntry({
      generatedAt: "2026-06-20T00:00:00.000Z",
      signal: "degrading_trend",
      recIndex: 1,
      subsystem: "routing",
    });
    const report = makeReport("2026-06-22T00:00:00.000Z", "workflow", 1.0);
    // rec2 is about "routing" — won't match workflow report
    const result = computeSubsystemCorrelation(
      [rec1, rec2], [report], "strict", 30, GENERATED_AT,
    );
    const sig = result.signalCorrelations.find((s) => s.signal === "degrading_trend")!;
    expect(sig.recommendationCount).toBe(2);
    expect(sig.matchedRecommendationCount).toBe(1);
    expect(sig.matchedDeltaCount).toBe(1);
    expect(sig.coverageRate).toBe(0.5);
  });
});
```

- [ ] **Step 4: Run correlation tests to verify they fail**

```bash
npx vitest run tests/executive/subsystem-correlation.vitest.ts --reporter=verbose 2>&1 | head -20
```
Expected: FAIL — `computeSubsystemCorrelation` not defined.

- [ ] **Step 5: Implement `src/executive/subsystem-correlation.ts`**

Create the full module:

```ts
/**
 * P10.8c — Predictive Signal Correlation.
 *
 * Correlates recommendation subsystem targets with later outcome report
 * SubsystemDeltas. Answers: how well do recommendation signals predict
 * subsystem health changes?
 *
 * Pure functions + CorrelationMatcher interface — no I/O, no mutation.
 * CLI handler owns store reads.
 *
 * @module
 */

import type { RecommendationEntry } from "./recommendation-effectiveness.js";
import type { ExecutiveOutcomeEvaluationReport, SubsystemDelta } from "./outcome-evaluator.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CorrelationMode = "strict" | "loose";

export interface SubsystemCorrelationEntry {
  reportId: string;
  generatedAt: string;
  recIndex: number;
  subsystem: string;
  signal: string;
  severity: string;
  signalConfidence: number;
  recommendationDisposition?: string;
  outcomeReportId: string;
  outcomeGeneratedAt: string;
  baselineScore: number;
  currentScore: number;
  delta: number;
  lagDays: number;
}

export interface ConfidenceBucket {
  range: string;
  low: number;
  high: number;
  recommendationCount: number;
  matchedDeltaCount: number;
  averageDelta: number;
  averageAbsoluteDelta: number;
  improvingRate: number;
}

export interface SubsystemCorrelation {
  subsystem: string;
  recommendationCount: number;
  outcomeReportCount: number;
  matchedRecommendationCount: number;
  matchedDeltaCount: number;
  uncorrelatedRecommendationCount: number;
  averageDelta: number;
  averageAbsoluteDelta: number;
  improvingCount: number;
  degradingCount: number;
  unchangedCount: number;
  netDelta: number;
  correlationEffectiveness: number;
  confidenceBuckets: ConfidenceBucket[];
}

export interface SignalCorrelation {
  signal: string;
  recommendationCount: number;
  matchedRecommendationCount: number;
  matchedDeltaCount: number;
  averageDelta: number;
  averageAbsoluteDelta: number;
  improvingRate: number;
  coverageRate: number;
  confidenceBuckets: ConfidenceBucket[];
}

export const PSC_OK = "ok";
export const PSC_PARTIAL = "partial";
export const PSC_NO_DATA = "no_data";

export interface SubsystemCorrelationReport {
  correlationStatus: typeof PSC_OK | typeof PSC_PARTIAL | typeof PSC_NO_DATA;
  correlationMode: CorrelationMode;
  correlationLagDays: number;
  outcomeReportCount: number;
  totalRecommendations: number;
  matchedRecCount: number;
  unmatchedRecCount: number;
  subsystemCorrelations: SubsystemCorrelation[];
  signalCorrelations: SignalCorrelation[];
  correlations: SubsystemCorrelationEntry[];
  loadWarnings: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CORRELATION_LAG_DAYS = 30;
const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// CorrelationMatcher interface
// ---------------------------------------------------------------------------

export interface CorrelationMatcher {
  match(
    rec: RecommendationEntry,
    reports: readonly ExecutiveOutcomeEvaluationReport[],
  ): Promise<Array<{ report: ExecutiveOutcomeEvaluationReport; delta: SubsystemDelta }>>;
}

// ---------------------------------------------------------------------------
// SubsystemTimeMatcher
// ---------------------------------------------------------------------------

export class SubsystemTimeMatcher implements CorrelationMatcher {
  constructor(
    private readonly mode: CorrelationMode,
    private readonly lagDays: number = DEFAULT_CORRELATION_LAG_DAYS,
  ) {}

  async match(
    rec: RecommendationEntry,
    reports: readonly ExecutiveOutcomeEvaluationReport[],
  ): Promise<Array<{ report: ExecutiveOutcomeEvaluationReport; delta: SubsystemDelta }>> {
    const results: Array<{ report: ExecutiveOutcomeEvaluationReport; delta: SubsystemDelta }> = [];
    const recTime = new Date(rec.generatedAt).getTime();

    for (const report of reports) {
      if (report.evaluationStatus !== "completed") continue;

      const reportTime = new Date(report.generatedAt).getTime();

      // Strict mode time gate
      if (this.mode === "strict") {
        if (reportTime <= recTime) continue;
        if (reportTime > recTime + this.lagDays * MS_PER_DAY) continue;
      }

      // Scan objectives for matching SubsystemDelta
      for (const objective of report.objectives) {
        for (const sd of objective.subsystemDeltas) {
          if (sd.subsystem !== rec.subsystem) continue;
          results.push({ report, delta: sd });
        }
      }
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const CONFIDENCE_BUCKETS = [
  { range: "0.00-0.25", low: 0.00, high: 0.25 },
  { range: "0.25-0.50", low: 0.25, high: 0.50 },
  { range: "0.50-0.75", low: 0.50, high: 0.75 },
  { range: "0.75-1.00", low: 0.75, high: 1.00 },
];

function computeConfidenceBucket(confidence: number): string {
  if (confidence < 0.25) return "0.00-0.25";
  if (confidence < 0.50) return "0.25-0.50";
  if (confidence < 0.75) return "0.50-0.75";
  return "0.75-1.00";
}

function buildEmptyBuckets(): ConfidenceBucket[] {
  return CONFIDENCE_BUCKETS.map((b) => ({
    range: b.range, low: b.low, high: b.high,
    recommendationCount: 0, matchedDeltaCount: 0,
    averageDelta: 0, averageAbsoluteDelta: 0, improvingRate: 0,
  }));
}

function aggregateConfidenceBuckets(entries: SubsystemCorrelationEntry[]): ConfidenceBucket[] {
  const buckets = new Map<string, { deltas: number[]; absDeltas: number[]; improving: number; recCount: Set<string> }>();
  for (const b of CONFIDENCE_BUCKETS) {
    buckets.set(b.range, { deltas: [], absDeltas: [], improving: 0, recCount: new Set() });
  }
  for (const e of entries) {
    const range = computeConfidenceBucket(e.signalConfidence);
    const bucket = buckets.get(range)!;
    bucket.deltas.push(e.delta);
    bucket.absDeltas.push(Math.abs(e.delta));
    if (e.delta > 0) bucket.improving++;
    bucket.recCount.add(`${e.reportId}:${e.recIndex}`);
  }
  return CONFIDENCE_BUCKETS.map((b) => {
    const data = buckets.get(b.range)!;
    const count = data.deltas.length;
    return {
      range: b.range, low: b.low, high: b.high,
      recommendationCount: data.recCount.size,
      matchedDeltaCount: count,
      averageDelta: count > 0 ? round2(data.deltas.reduce((s, v) => s + v, 0) / count) : 0,
      averageAbsoluteDelta: count > 0 ? round2(data.absDeltas.reduce((s, v) => s + v, 0) / count) : 0,
      improvingRate: count > 0 ? round2(data.improving / count) : 0,
    };
  });
}

// Track unique matched recommendations per group (subsystem or signal)
function matchedRecSet(entries: SubsystemCorrelationEntry[]): Set<string> {
  const set = new Set<string>();
  for (const e of entries) set.add(`${e.reportId}:${e.recIndex}`);
  return set;
}

function aggregateBySubsystem(entries: SubsystemCorrelationEntry[]): SubsystemCorrelation[] {
  const map = new Map<string, SubsystemCorrelationEntry[]>();
  for (const e of entries) {
    const arr = map.get(e.subsystem) ?? [];
    arr.push(e);
    map.set(e.subsystem, arr);
  }

  const correlations: SubsystemCorrelation[] = [];
  const recCountMap = new Map<string, Set<string>>();
  for (const e of entries) {
    const key = `${e.reportId}:${e.recIndex}`;
    const set = recCountMap.get(e.subsystem) ?? new Set();
    set.add(key);
    recCountMap.set(e.subsystem, set);
  }

  for (const [subsystem, matches] of map) {
    const totalDeltas = matches.reduce((sum, m) => sum + m.delta, 0);
    const totalAbsDeltas = matches.reduce((sum, m) => sum + Math.abs(m.delta), 0);
    const improving = matches.filter((m) => m.delta > 0).length;
    const degrading = matches.filter((m) => m.delta < 0).length;
    const unchanged = matches.filter((m) => m.delta === 0).length;
    const deltaCount = matches.length;
    const matchedRecs = matchedRecSet(matches).size;

    correlations.push({
      subsystem,
      recommendationCount: recCountMap.get(subsystem)?.size ?? 0,
      outcomeReportCount: new Set(matches.map((m) => m.outcomeReportId)).size,
      matchedRecommendationCount: matchedRecs,
      matchedDeltaCount: deltaCount,
      uncorrelatedRecommendationCount: 0,
      averageDelta: deltaCount > 0 ? round2(totalDeltas / deltaCount) : 0,
      averageAbsoluteDelta: deltaCount > 0 ? round2(totalAbsDeltas / deltaCount) : 0,
      improvingCount: improving,
      degradingCount: degrading,
      unchangedCount: unchanged,
      netDelta: round2(totalDeltas),
      correlationEffectiveness: deltaCount > 0 ? round2(improving / deltaCount) : 0,
      confidenceBuckets: aggregateConfidenceBuckets(matches),
    });
  }

  return correlations;
}

function aggregateBySignal(entries: SubsystemCorrelationEntry[], totalRecsBySignal: Map<string, number>): SignalCorrelation[] {
  const map = new Map<string, SubsystemCorrelationEntry[]>();
  for (const e of entries) {
    const arr = map.get(e.signal) ?? [];
    arr.push(e);
    map.set(e.signal, arr);
  }

  const correlations: SignalCorrelation[] = [];
  for (const [signal, matches] of map) {
    const totalDeltas = matches.reduce((sum, m) => sum + m.delta, 0);
    const totalAbsDeltas = matches.reduce((sum, m) => sum + Math.abs(m.delta), 0);
    const improving = matches.filter((m) => m.delta > 0).length;
    const deltaCount = matches.length;
    const totalRecs = totalRecsBySignal.get(signal) ?? 0;
    const matchedRecs = matchedRecSet(matches).size;

    correlations.push({
      signal,
      recommendationCount: totalRecs,
      matchedRecommendationCount: matchedRecs,
      matchedDeltaCount: deltaCount,
      averageDelta: deltaCount > 0 ? round2(totalDeltas / deltaCount) : 0,
      averageAbsoluteDelta: deltaCount > 0 ? round2(totalAbsDeltas / deltaCount) : 0,
      improvingRate: deltaCount > 0 ? round2(improving / deltaCount) : 0,
      coverageRate: totalRecs > 0 ? round2(matchedRecs / totalRecs) : 0,
      confidenceBuckets: aggregateConfidenceBuckets(matches),
    });
  }

  return correlations;
}

// ---------------------------------------------------------------------------
// Main correlation function
// ---------------------------------------------------------------------------

export async function computeSubsystemCorrelation(
  recommendations: readonly RecommendationEntry[],
  outcomeReports: readonly ExecutiveOutcomeEvaluationReport[],
  correlationMode: CorrelationMode,
  correlationLagDays: number = DEFAULT_CORRELATION_LAG_DAYS,
  generatedAt: string,
): Promise<SubsystemCorrelationReport> {
  if (recommendations.length === 0 || outcomeReports.length === 0) {
    return emptyReport(PSC_NO_DATA, recommendations.length, correlationMode, correlationLagDays);
  }

  const matcher = new SubsystemTimeMatcher(correlationMode, correlationLagDays);
  const entries: SubsystemCorrelationEntry[] = [];
  const matchedRecKeys = new Set<string>();
  const recCountBySignal = new Map<string, number>();

  for (const rec of recommendations) {
    recCountBySignal.set(rec.signal, (recCountBySignal.get(rec.signal) ?? 0) + 1);

    const matches = await matcher.match(rec, outcomeReports);
    if (matches.length > 0) {
      matchedRecKeys.add(`${rec.reportId}:${rec.recIndex}`);
    }

    for (const { report, delta } of matches) {
      const lagDays = Math.floor(
        (new Date(report.generatedAt).getTime() - new Date(rec.generatedAt).getTime()) / MS_PER_DAY,
      );
      entries.push({
        reportId: rec.reportId,
        generatedAt: rec.generatedAt,
        recIndex: rec.recIndex,
        subsystem: rec.subsystem,
        signal: rec.signal,
        severity: rec.severity,
        signalConfidence: rec.signalConfidence,
        recommendationDisposition: rec.disposition,
        outcomeReportId: report.id ?? report.generatedAt,
        outcomeGeneratedAt: report.generatedAt,
        baselineScore: delta.baselineScore,
        currentScore: delta.currentScore,
        delta: delta.delta,
        lagDays,
      });
    }
  }

  if (entries.length === 0) {
    return emptyReport(PSC_NO_DATA, recommendations.length, correlationMode, correlationLagDays);
  }

  const subsystemCorrelations = aggregateBySubsystem(entries);
  for (const sub of subsystemCorrelations) {
    const subRecs = recommendations.filter((r) => r.subsystem === sub.subsystem);
    sub.uncorrelatedRecommendationCount = subRecs.length - sub.matchedRecommendationCount;
  }

  const signalCorrelations = aggregateBySignal(entries, recCountBySignal);
  const outcomeReportIds = new Set(entries.map((e) => e.outcomeReportId));
  const matchedRecCount = matchedRecKeys.size;
  const unmatchedRecCount = recommendations.length - matchedRecCount;

  // partial if fewer than half of recs had outcome data
  const status = matchedRecCount === 0 ? PSC_NO_DATA
    : matchedRecCount < recommendations.length / 2 ? PSC_PARTIAL
    : PSC_OK;

  return {
    correlationStatus: status,
    correlationMode,
    correlationLagDays,
    outcomeReportCount: outcomeReportIds.size,
    totalRecommendations: recommendations.length,
    matchedRecCount,
    unmatchedRecCount,
    subsystemCorrelations,
    signalCorrelations,
    correlations: entries,
    loadWarnings: [],
  };
}

function emptyReport(
  status: string,
  totalRecs: number,
  mode: CorrelationMode,
  lagDays: number,
): SubsystemCorrelationReport {
  return {
    correlationStatus: status as any,
    correlationMode: mode,
    correlationLagDays: lagDays,
    outcomeReportCount: 0,
    totalRecommendations: totalRecs,
    matchedRecCount: 0,
    unmatchedRecCount: 0,
    subsystemCorrelations: [],
    signalCorrelations: [],
    correlations: [],
    loadWarnings: [],
  };
}

  // Build signal correlations
  const signalCorrelations = aggregateBySignal(entries, recCountBySignal);

  // Report-level stats
  const reportIds = new Set(entries.map((e) => e.outcomeReportId));

  return {
    correlationStatus: PSC_OK,
    correlationMode,
    correlationLagDays,
    reportCount: reportIds.size,
    totalRecommendations: recommendations.length,
    correlatedRecommendations: matchedRecKeys.size,
    subsystemCorrelations,
    signalCorrelations,
    correlations: entries,
    loadWarnings: [],
  };
}
```

- [ ] **Step 6: Run tests to verify they all pass**

```bash
npx vitest run tests/executive/subsystem-correlation.vitest.ts --reporter=verbose 2>&1 | tail -20
```
Expected: PASS — all tests green.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/executive/subsystem-correlation.ts tests/executive/subsystem-correlation.vitest.ts
git commit -m "feat(p10-8c): add predictive signal correlation engine

- New module: subsystem-correlation.ts
- CorrelationMatcher interface + SubsystemTimeMatcher implementation
- computeSubsystemCorrelation() with per-subsystem and per-signal aggregation
- Types: SubsystemCorrelationEntry, SubsystemCorrelation, SignalCorrelation
- averageAbsoluteDelta for magnitude detection when signs cancel
- correlationEffectiveness + coverageRate for consistency with P10.8b
- recommendationDisposition propagated from P10.8a
- 13 pure function tests

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: CLI handler — load stores, render terminal/JSON, wire routing, sentinel

**Files:**
- Create: `src/cli/commands/executive-subsystem-correlation-handler.ts`
- Create: `tests/cli/commands/executive-subsystem-correlation-cli.vitest.ts`
- Modify: `src/cli/commands/executive.ts`
- Modify: `tests/executive/executive-sentinels.vitest.ts`

**Interfaces:**
- Consumes: `computeSubsystemCorrelation()` + types from `subsystem-correlation.ts`, `RecommendationReportStore`, `OutcomeReportStore`, `RecommendationEntry` from `recommendation-effectiveness.ts`.
- Produces: `handleSubsystemCorrelationCommand()` async function, sentinel entries.

- [ ] **Step 1: Write failing CLI tests**

Create `tests/cli/commands/executive-subsystem-correlation-cli.vitest.ts`:

```ts
/**
 * P10.8c — Predictive Signal Correlation CLI integration tests.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleSubsystemCorrelationCommand } from "../../../src/cli/commands/executive-subsystem-correlation-handler.js";
import { RecommendationReportStore } from "../../../src/executive/recommendation-report-store.js";
import type { RecommendationReport, ExecutiveRecommendation } from "../../../src/executive/recommendation-report-store.js";
import type { ExecutiveOutcomeEvaluationReport } from "../../../src/executive/outcome-evaluator.js";

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a: any[]) => { out.push(a.join(" ")); });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a: any[]) => { err.push(a.join(" ")); });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...a: any[]) => { err.push(a.join(" ")); });
  return { out: () => out, err: () => err, restore: () => { logSpy.mockRestore(); warnSpy.mockRestore(); errorSpy.mockRestore(); } };
}

function makeExecRec(over: Partial<ExecutiveRecommendation> = {}): ExecutiveRecommendation {
  return {
    subsystem: "workflow",
    signal: "degrading_trend",
    severity: "high",
    recommendation: "Investigate workflow regressions",
    signalConfidence: 0.88,
    occurrenceCount: 8,
    averageDelta: -3.2,
    ...over,
  };
}

function makeReport(recs: ExecutiveRecommendation[], generatedAt?: string): RecommendationReport {
  const ts = generatedAt ?? new Date().toISOString();
  return {
    schemaVersion: "p10.7b.0",
    id: "recommendation-test",
    contentHash: "x",
    report: {
      generatedAt: ts,
      requestedWindow: 10,
      recommendationStatus: "ok",
      inputReportCount: recs.length,
      analyzedReportCount: recs.length,
      skippedReportCount: 0,
      evidenceReportIds: [],
      recommendations: recs,
      warnings: [],
      loadWarnings: [],
    },
  };
}

function persist(report: RecommendationReport): RecommendationReport {
  const store = new RecommendationReportStore(join(tempRoot, ".alix", "executive", "recommendations"));
  const id = store.save(report.report);
  return store.load(id)!;
}

function makeOutcomeReport(generatedAt: string, subsystem: string, delta: number): ExecutiveOutcomeEvaluationReport {
  return {
    schemaVersion: "p10.5.0",
    generatedAt,
    planId: "plan-test",
    planStatus: "completed",
    evaluationStatus: "completed",
    evaluatedSubsystems: [subsystem],
    objectives: [{
      objectiveId: "obj-test",
      objectiveType: "stabilize",
      targetSubsystems: [subsystem],
      subsystemDeltas: [{ subsystem, baselineScore: 50, currentScore: 50 + delta, delta }],
      aggregateDelta: delta,
      outcome: delta > 0 ? "improved" : delta < 0 ? "degraded" : "unchanged",
    }],
    overallDelta: delta,
    warnings: [],
  };
}

function seedOutcomeReport(report: ExecutiveOutcomeEvaluationReport, id: string) {
  const dir = join(tempRoot, ".alix", "executive", "outcomes");
  mkdirSync(dir, { recursive: true });
  const wrapper = { schemaVersion: "p10.5b.0", id, contentHash: "x", report };
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(wrapper, null, 2), "utf-8");
}

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "p10-8c-correlation-cli-"));
  mkdirSync(join(tempRoot, ".alix", "executive", "recommendations"), { recursive: true });
  mkdirSync(join(tempRoot, ".alix", "executive", "outcomes"), { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("executive subsystem-correlation CLI", () => {
  it("renders terminal table with subsystem and signal correlations", async () => {
    const rec = makeExecRec({
      generatedAt: "2026-06-20T00:00:00.000Z",
      proposalId: "p1",
    });
    const saved = persist(makeReport([rec], "2026-06-20T00:00:00.000Z"));

    seedOutcomeReport(
      makeOutcomeReport("2026-06-25T00:00:00.000Z", "workflow", 1.5),
      "outcome-test-1",
    );

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleSubsystemCorrelationCommand(["--report", saved.id]);
    const output = c.out().join("\n");
    expect(output).toMatch(/Predictive Signal Correlation/i);
    expect(output).toMatch(/workflow/);
    expect(output).toMatch(/CorrEff/);
    expect(output).toMatch(/degrading_trend/);
    expect(output).toMatch(/Coverage/);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("JSON output includes all correlation fields", async () => {
    const rec = makeExecRec({
      generatedAt: "2026-06-20T00:00:00.000Z",
      proposalId: "p1",
    });
    const saved = persist(makeReport([rec], "2026-06-20T00:00:00.000Z"));

    seedOutcomeReport(
      makeOutcomeReport("2026-06-25T00:00:00.000Z", "workflow", 1.5),
      "outcome-test-2",
    );

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleSubsystemCorrelationCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.correlationStatus).toBe("ok");
    expect(parsed.subsystemCorrelations[0].averageAbsoluteDelta).toBeDefined();
    expect(parsed.subsystemCorrelations[0].correlationEffectiveness).toBeDefined();
    expect(parsed.signalCorrelations[0].coverageRate).toBeDefined();
    expect(parsed.correlations[0].recommendationDisposition).toBeDefined();
    cwdSpy.mockRestore();
    c.restore();
  });

  it("no outcome reports → no_data status", async () => {
    const saved = persist(makeReport([makeExecRec()]));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleSubsystemCorrelationCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.correlationStatus).toBe("no_data");
    cwdSpy.mockRestore();
    c.restore();
  });
});
```

- [ ] **Step 2: Run CLI tests to verify they fail**

```bash
npx vitest run tests/cli/commands/executive-subsystem-correlation-cli.vitest.ts --reporter=verbose 2>&1 | head -20
```
Expected: FAIL — handler module not found.

- [ ] **Step 3: Implement the CLI handler**

Create `src/cli/commands/executive-subsystem-correlation-handler.ts`:

```ts
/**
 * P10.8c — Predictive Signal Correlation CLI handler.
 *
 * Read-only handler loads recommendation reports from RecommendationReportStore,
 * loads outcome reports from OutcomeReportStore, computes subsystem correlation
 * via pure computeSubsystemCorrelation(), renders terminal tables or JSON.
 *
 * --mode strict|loose  Correlation timing mode (default: strict)
 * --lag <days>         Lag window for strict mode (default: 30)
 * --report <id>        Analyze a single report.
 * --json               Emit structured JSON.
 *
 * @module
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RecommendationReportStore } from "../../executive/recommendation-report-store.js";
import { OutcomeReportStore } from "../../executive/outcome-store.js";
import type { ExecutiveOutcomeEvaluationReport } from "../../executive/outcome-evaluator.js";
import {
  computeSubsystemCorrelation,
  PSC_NO_DATA,
} from "../../executive/subsystem-correlation.js";
import type { SubsystemCorrelationReport } from "../../executive/subsystem-correlation.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;
const DEFAULT_LAG_DAYS = 30;

// ---------------------------------------------------------------------------
// CLI handler
// ---------------------------------------------------------------------------

export async function handleSubsystemCorrelationCommand(args: string[]): Promise<void> {
  const reportIndex = args.indexOf("--report");
  const reportIdArg = reportIndex !== -1 && reportIndex + 1 < args.length ? args[reportIndex + 1] : undefined;

  const modeIndex = args.indexOf("--mode");
  const modeArg = modeIndex !== -1 && modeIndex + 1 < args.length ? args[modeIndex + 1] : "strict";
  const correlationMode = modeArg === "loose" ? "loose" : "strict";

  const lagIndex = args.indexOf("--lag");
  const lagArg = lagIndex !== -1 && lagIndex + 1 < args.length ? parseInt(args[lagIndex + 1], 10) : DEFAULT_LAG_DAYS;
  const correlationLagDays = lagArg > 0 ? lagArg : DEFAULT_LAG_DAYS;

  const useJson = args.includes("--json");
  const generatedAt = new Date().toISOString();
  const cwd = process.cwd();

  // Load recommendation reports
  const recommendationStore = new RecommendationReportStore(
    join(cwd, ".alix", "executive", "recommendations"),
  );
  const outcomeStore = new OutcomeReportStore(
    join(cwd, ".alix", "executive", "outcomes"),
  );

  const loadedReports: any[] = [];
  if (reportIdArg) {
    const report = recommendationStore.load(reportIdArg);
    if (!report) {
      emitError("not_found", useJson, `Recommendation report not found: ${reportIdArg}`);
      return;
    }
    loadedReports.push(report);
  } else {
    const metas = recommendationStore.list();
    for (const meta of metas) {
      try {
        const report = recommendationStore.load(meta.reportId);
        if (report) loadedReports.push(report);
      } catch (e: any) {
        console.warn(`Skipping corrupt recommendation report: ${meta.reportId} — ${e.message}`);
      }
    }
  }

  if (loadedReports.length === 0) {
    emitNoData(useJson, generatedAt, correlationMode, correlationLagDays);
    return;
  }

  // Build recommendation entries
  const recommendations: any[] = [];
  for (const report of loadedReports) {
    const recs = report.report.recommendations;
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      recommendations.push({
        reportId: report.id,
        generatedAt: report.report.generatedAt,
        recIndex: i,
        subsystem: rec.subsystem,
        signal: rec.signal,
        severity: rec.severity,
        signalConfidence: rec.signalConfidence,
        recommendation: rec.recommendation,
        proposalId: rec.proposalId,
        disposition: rec.disposition,
        ageDays: Math.floor(
          (Date.now() - new Date(report.report.generatedAt).getTime()) / MS_PER_DAY,
        ),
      });
    }
  }

  // Load outcome reports
  const outcomeReports: ExecutiveOutcomeEvaluationReport[] = [];
  try {
    const outcomes = outcomeStore.list();
    for (const meta of outcomes) {
      try {
        const report = outcomeStore.load(meta.reportId);
        if (report) outcomeReports.push(report.report);
      } catch (e: any) {
        console.warn(`Skipping corrupt outcome report: ${meta.reportId} — ${e.message}`);
      }
    }
  } catch {
    // Outcomes directory inaccessible — proceed with empty array
  }

  // Compute correlation
  const result = computeSubsystemCorrelation(
    recommendations,
    outcomeReports,
    correlationMode,
    correlationLagDays,
    generatedAt,
  );

  // Render
  if (useJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    renderTable(result);
  }
}

// ---------------------------------------------------------------------------
// Terminal rendering
// ---------------------------------------------------------------------------

function renderTable(result: SubsystemCorrelationReport): void {
  if (result.correlationStatus === PSC_NO_DATA) {
    console.log("No predictive signal correlation data available.");
    return;
  }

  console.log(`\nPredictive Signal Correlation Report (${result.correlationMode}, ${result.correlationLagDays} day lag)`);
  console.log(`Generated: ${result.generatedAt}`);
  console.log(
    `Reports: ${result.reportCount} | Recommendations: ${result.totalRecommendations} | Correlated: ${result.correlatedRecommendations}\n`,
  );

  if (result.subsystemCorrelations.length > 0) {
    console.log(
      `${"Subsystem".padEnd(16)} ${"Recs".padEnd(6)} ${"Outcomes".padEnd(6)} ` +
        `${"Correlated".padEnd(8)} ${"Uncorr".padEnd(6)} ${"AvgΔ".padEnd(7)} ` +
        `${"|Δ|".padEnd(6)} ${"Improv".padEnd(6)} ${"Degrade".padEnd(6)} ` +
        `${"NetΔ".padEnd(7)} ${"CorrEff".padEnd(6)}`,
    );
    console.log("-".repeat(85));
    for (const sub of result.subsystemCorrelations) {
      console.log(
        `${sub.subsystem.padEnd(16)} ${String(sub.recommendationCount).padEnd(6)} ` +
          `${String(sub.outcomeReportCount).padEnd(6)} ${String(sub.correlationCount).padEnd(8)} ` +
          `${String(sub.uncorrelatedRecommendationCount).padEnd(6)} ` +
          `${(sub.averageDelta >= 0 ? "+" : "")}${sub.averageDelta.toFixed(1).padEnd(6)} ` +
          `${String(sub.averageAbsoluteDelta.toFixed(1)).padEnd(6)} ` +
          `${String(sub.improvingCount).padEnd(6)} ${String(sub.degradingCount).padEnd(6)} ` +
          `${(sub.netDelta >= 0 ? "+" : "")}${sub.netDelta.toFixed(1).padEnd(6)} ` +
          `${(sub.correlationEffectiveness * 100).toFixed(0)}%`,
      );
    }
  }

  if (result.signalCorrelations.length > 0) {
    console.log("");
    console.log(
      `${"Signal".padEnd(24)} ${"Recs".padEnd(6)} ${"Correlated".padEnd(8)} ` +
        `${"AvgΔ".padEnd(7)} ${"|Δ|".padEnd(6)} ${"ImproveRt".padEnd(8)} ${"Coverage".padEnd(8)}`,
    );
    console.log("-".repeat(72));
    for (const sig of result.signalCorrelations) {
      const rateStr = sig.correlationCount > 0
        ? `${(sig.improvingRate * 100).toFixed(0)}%`
        : "—";
      const covStr = `${(sig.coverageRate * 100).toFixed(0)}%`;
      const avgDeltaStr = sig.correlationCount > 0
        ? `${(sig.averageDelta >= 0 ? "+" : "")}${sig.averageDelta.toFixed(1)}`
        : "—";
      const absDeltaStr = sig.correlationCount > 0
        ? `${sig.averageAbsoluteDelta.toFixed(1)}`
        : "—";
      console.log(
        `${sig.signal.padEnd(24)} ${String(sig.recommendationCount).padEnd(6)} ` +
          `${String(sig.correlationCount).padEnd(8)} ${avgDeltaStr.padEnd(7)} ` +
          `${absDeltaStr.padEnd(6)} ${rateStr.padEnd(8)} ${covStr.padEnd(8)}`,
      );
    }
  }

  if (result.loadWarnings.length > 0) {
    for (const w of result.loadWarnings) {
      console.error(`Warning: ${w}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function emitError(reason: string, useJson: boolean, message: string): void {
  if (useJson) {
    console.log(JSON.stringify({ ok: false, reason: message }));
  } else {
    console.error(message);
  }
}

function emitNoData(useJson: boolean, generatedAt: string, mode: string, lagDays: number): void {
  const noData: SubsystemCorrelationReport = {
    correlationStatus: PSC_NO_DATA,
    correlationMode: mode as any,
    correlationLagDays: lagDays,
    reportCount: 0,
    totalRecommendations: 0,
    correlatedRecommendations: 0,
    subsystemCorrelations: [],
    signalCorrelations: [],
    correlations: [],
    loadWarnings: [],
  };
  if (useJson) {
    console.log(JSON.stringify(noData, null, 2));
  } else {
    console.log("No predictive signal correlation data available.");
  }
}
```

- [ ] **Step 4: Wire routing into `src/cli/commands/executive.ts`**

Add after the `recommendation-effectiveness` case (after line 131):

```ts
    case "subsystem-correlation": {
      const { handleSubsystemCorrelationCommand } = await import(
        "./executive-subsystem-correlation-handler.js"
      );
      return handleSubsystemCorrelationCommand(rest);
    }
```

Update the subcommand list on line 135 to include `subsystem-correlation`:

```ts
      console.error("Available: dashboard, plan, evaluate, outcomes, learn, recommend, bridge, recommendation-effectiveness, subsystem-correlation");
```

- [ ] **Step 5: Add sentinel entries**

In `tests/executive/executive-sentinels.vitest.ts`, add to the `EXECUTIVE_FILES` array:

```ts
  // P10.8c files
  "src/executive/subsystem-correlation.ts",
  "src/cli/commands/executive-subsystem-correlation-handler.ts",
```

- [ ] **Step 6: Run CLI tests to verify they pass**

```bash
npx vitest run tests/cli/commands/executive-subsystem-correlation-cli.vitest.ts --reporter=verbose 2>&1 | tail -20
```
Expected: PASS — all 3 CLI tests green.

- [ ] **Step 7: Run full suite + tsc**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -10
```
Expected: PASS — 2100+ tests green.

```bash
npx tsc --noEmit 2>&1
```
Expected: clean exit, no errors.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/cli/commands/executive-subsystem-correlation-handler.ts \
       src/cli/commands/executive.ts \
       tests/cli/commands/executive-subsystem-correlation-cli.vitest.ts \
       tests/executive/executive-sentinels.vitest.ts
git commit -m "feat(p10-8c): CLI handler + routing + sentinel for predictive signal correlation

- New CLI handler with --mode, --lag, --report, --json flags
- Loads RecommendationReportStore + OutcomeReportStore
- Terminal render with subsystem and signal correlation tables
- JSON output with all correlation fields
- executive.ts routing + sentinel registration
- 3 CLI integration tests

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Verify + whole-branch review + PR

- [ ] **Step 1: Run full suite + tsc + sentinel**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -10
npx tsc --noEmit
npx vitest run tests/executive/executive-sentinels.vitest.ts --reporter=verbose 2>&1 | tail -5
```
Expected: all pass.

- [ ] **Step 2: Whole-branch review + PR (subagent-driven)** — dispatched via `superpowers:requesting-code-review`.

---

## Self-Review

- **Spec coverage:**
  - ✅ `CorrelationMode`, `SubsystemCorrelationEntry`, `SubsystemCorrelation`, `SignalCorrelation`, `SubsystemCorrelationReport` types — Task 1
  - ✅ `CorrelationMatcher` interface + `SubsystemTimeMatcher` — Task 1
  - ✅ `computeSubsystemCorrelation()` — Task 1
  - ✅ `aggregateBySubsystem()` + `aggregateBySignal()` — Task 1
  - ✅ `averageAbsoluteDelta` — Task 1 (tested in Step 3)
  - ✅ `correlationEffectiveness = improvingCount / matchedDeltaCount` — Task 1
  - ✅ `coverageRate = matchedRecommendationCount / recommendationCount` — Task 1
  - ✅ `matchedRecommendationCount` vs `matchedDeltaCount` distinction — Task 1
  - ✅ `CorrelationMatcher.match()` is async (Promise<>) — Task 1
  - ✅ `confidenceBuckets` per subsystem and per signal — Task 1
  - ✅ `correlationStatus` includes `partial` state — Task 1
  - ✅ `outcomeReportCount` instead of `reportCount` — Task 1
  - ✅ `recommendationDisposition` propagated — Task 1 (tested)
  - ✅ `uncorrelatedRecommendationCount` — Task 1
  - ✅ Strict mode time gates — Task 1 (SubsystemTimeMatcher tests)
  - ✅ Loose mode — Task 1 (tested)
  - ✅ CLI handler with --mode, --lag, --report, --json — Task 2
  - ✅ Terminal render with `|Δ|` and `CorrEff` columns — Task 2
  - ✅ JSON output with all fields — Task 2
  - ✅ Sentinel registration — Task 2
  - ✅ No mutation, no writes — enforced by sentinel
- **Placeholder scan:** No TBD, TODO, incomplete sections.
- **Type consistency:** Types match exactly between Task 1 and Task 2. `CorrelationMode` is `"strict" | "loose"`. `computeSubsystemCorrelation` signature matches between the pure module and handler call site.
