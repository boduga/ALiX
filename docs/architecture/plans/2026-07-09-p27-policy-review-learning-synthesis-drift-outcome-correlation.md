# P27 — Policy Review Learning Synthesis & Drift Outcome Correlation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correlate P24 drift signals, P25 review candidates, and P26 human outcomes into read-only learning synthesis — without crossing into prescription, prediction, or mutation.

**Architecture:** P27 reads from three sources (P24 bundle, P25 candidate store, P26 outcome store) at the CLI boundary, builds deterministic DriftOutcomeTrace records by joining outcome→candidate→embedded signal metadata, then computes pure analytics over the trace set. No new storage. No write path. No inferred events.

**Tech Stack:** TypeScript, node:test, node:assert/strict, node:fs (CLI only), node:crypto (deterministic IDs)

## Global Constraints

- Primary invariant: P27 produces descriptive governance intelligence only — never prescriptive
- Four invariants: Historical Truth, Correlation≠Causation, Learning≠Recommendation, Human Sovereignty
- No autonomous execution, background jobs, or scheduled watchers
- No shell, network, MCP, browser, fetch, or subprocess calls
- No execution adapters, executor imports, or tool invocations
- No policy mutation or readiness threshold mutation
- No reviewer or operator ranking (no scorecards, no leaderboards)
- No auto-adoption of learning synthesis outputs
- No predictive scores or likelihood estimates for future governance outcomes
- No inferred events — only recorded relationships
- No new storage — reads from P25 candidates, P26 outcomes, P24 bundle
- Deterministic trace records with partial trace support (null for missing)
- Repeated drift: 2+ same-kind signals across non-overlapping windows
- Missing outcomes: terminal-state candidates only (dismissed, closed, accepted_for_policy_review)
- All analytics functions are pure (no I/O, no side effects)
- P24/P25/P26 modules remain untouched
- import type for type-only symbols
- Tests use `node:test` (describe/it) + `node:assert/strict`

---

## File Structure

### Created Files

| Slice | File | Purpose |
|-------|------|---------|
| P27.1 | `src/governance/learning-synthesis-types.ts` | DriftOutcomeTrace, LearningSynthesisReport types |
| P27.2 | `src/governance/learning-synthesis-analytics.ts` | Pure correlation analytics |
| P27.3 | `src/governance/learning-synthesis-report.ts` | Pure report builder + text/json |
| P27.4 | `src/cli/commands/governance-learning-synthesis.ts` | CLI handler (no write path) |
| P27.5 | `docs/architecture/checkpoints/2026-07-09-p27-5-policy-review-learning-synthesis-drift-outcome-correlation-checkpoint.md` | Checkpoint |

### Touched Files

| File | Change |
|------|--------|
| `src/cli/commands/governance.ts` | Add `case "learning-synthesis"` dispatch |

### Untouched Files

- P24 modules (policy-drift-*.ts)
- P25 modules (policy-review-candidate-*.ts)
- P26 modules (policy-review-outcome-*.ts)
- P13.3 policy-suggestions.ts
- P9.0d governance-drift-detector.ts

---

### Task 1: P27.1 — Trace Model (learning-synthesis-types.ts)

**Files:**
- Create: `src/governance/learning-synthesis-types.ts`
- Test: `tests/governance/learning-synthesis-types.test.ts`

**Interfaces:**
- Produces: `DriftOutcomeTrace`, `LearningSynthesisReport`, `OutcomeCorrelationAnalytics`, `TraceStoreConfig` — consumed by Tasks 2, 3, 4

- [ ] **Step 1: Write the failing type test**

Create `tests/governance/learning-synthesis-types.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  type DriftOutcomeTrace,
  type LearningSynthesisReport,
  type DriftCorrelationAnalytics,
} from "../../src/governance/learning-synthesis-types.js";

describe("LearningSynthesisTypes", () => {

  it("DriftOutcomeTrace has all required fields", () => {
    const trace: DriftOutcomeTrace = {
      outcomeId: "o-1",
      candidateId: "c-1",
      signalId: "s-1",
      signalKind: "calibration_skew",
      signalSeverity: "medium",
      signalDirection: "too_loose",
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-07-01T00:00:00.000Z",
      candidateTitle: "Test candidate",
      candidateStatus: "dismissed",
      candidateCreatedAt: "2026-06-15T00:00:00.000Z",
      candidateClosedAt: "2026-06-20T00:00:00.000Z",
      outcomeType: "dismissed_no_change",
      outcomeRecordedAt: "2026-06-20T12:00:00.000Z",
      outcomeRationale: "No evidence of drift.",
      timeToReviewDays: 3,
      timeToOutcomeDays: 5,
    };
    assert.equal(trace.signalKind, "calibration_skew");
    assert.equal(trace.outcomeType, "dismissed_no_change");
  });

  it("trace sorts deterministically by candidateCreatedAt then candidateId", () => {
    const traces: DriftOutcomeTrace[] = [
      { outcomeId: "o-2", candidateId: "c-b", signalId: "s-2", signalKind: "replay_divergence", signalSeverity: "high", signalDirection: "stale", windowStart: "", windowEnd: "", candidateTitle: "", candidateStatus: "", candidateCreatedAt: "2026-06-20T00:00:00.000Z", candidateClosedAt: "", outcomeType: "accepted_for_policy_work", outcomeRecordedAt: "", outcomeRationale: "", timeToReviewDays: 0, timeToOutcomeDays: 0 },
      { outcomeId: "o-1", candidateId: "c-a", signalId: "s-1", signalKind: "calibration_skew", signalSeverity: "medium", signalDirection: "too_loose", windowStart: "", windowEnd: "", candidateTitle: "", candidateStatus: "", candidateCreatedAt: "2026-06-15T00:00:00.000Z", candidateClosedAt: "", outcomeType: "dismissed_no_change", outcomeRecordedAt: "", outcomeRationale: "", timeToReviewDays: 0, timeToOutcomeDays: 0 },
    ];
    traces.sort((a, b) =>
      a.candidateCreatedAt.localeCompare(b.candidateCreatedAt) ||
      a.candidateId.localeCompare(b.candidateId),
    );
    assert.equal(traces[0]!.candidateId, "c-a");
    assert.equal(traces[1]!.candidateId, "c-b");
  });

  it("LearningSynthesisReport includes boundary flags", () => {
    const report: LearningSynthesisReport = {
      reportId: "r-1", windowStart: "", windowEnd: "", generatedAt: "",
      totalSignals: 0, totalCandidates: 0, totalOutcomes: 0,
      outcomeBySignalKind: {}, outcomeBySeverity: {},
      timeStats: { avgTimeToReviewDays: 0, avgTimeToOutcomeDays: 0 },
      traceCompleteness: 0, missingOutcomes: 0,
      repeatedPatterns: [], confidenceByOutcome: {}, signalKindFrequency: {},
      footnotes: [],
      readOnly: true, noPolicyMutation: true, noThresholdChange: true,
      noAutoAdoption: true, noRanking: true,
    };
    assert.equal(report.readOnly, true);
    assert.equal(report.noPolicyMutation, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/governance/learning-synthesis-types.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal types file**

Create `src/governance/learning-synthesis-types.ts`:

```typescript
/**
 * P27.1 — Learning Synthesis Types.
 *
 * Trace model for P24→P25→P26 correlation. DriftOutcomeTrace joins
 * outcome records to candidates to embedded signal metadata using only
 * recorded relationships. Partial traces permitted when artifacts missing.
 *
 * Primary invariant: descriptive governance intelligence only.
 * No prescriptive fields. No causation claims. No predictive scores.
 */

// ---------------------------------------------------------------------------
// DriftOutcomeTrace — single correlated record
// ---------------------------------------------------------------------------

export interface DriftOutcomeTrace {
  outcomeId: string;
  candidateId: string;
  signalId: string;

  // P24 signal metadata (from candidate.source)
  signalKind: string;
  signalSeverity: string;
  signalDirection: string;
  windowStart: string;
  windowEnd: string;

  // P25 candidate metadata
  candidateTitle: string;
  candidateStatus: string;
  candidateCreatedAt: string;
  candidateClosedAt: string;

  // P26 outcome metadata
  outcomeType: string;
  outcomeRecordedAt: string;
  outcomeRationale: string;

  // Derived
  timeToReviewDays: number;
  timeToOutcomeDays: number;
}

// ---------------------------------------------------------------------------
// Correlation analytics
// ---------------------------------------------------------------------------

export interface DriftCorrelationAnalytics {
  totalOutcomes: number;
  outcomeBySignalKind: Record<string, Record<string, number>>;
  outcomeBySeverity: Record<string, Record<string, number>>;
  timeStats: { avgTimeToReviewDays: number; avgTimeToOutcomeDays: number };
  repeatedPatterns: string[];
  traceCompleteness: number;
  missingOutcomes: number;
}

// ---------------------------------------------------------------------------
// LearningSynthesisReport — descriptive only, never prescriptive
// ---------------------------------------------------------------------------

export interface LearningSynthesisReport {
  reportId: string;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;

  totalSignals: number;
  totalCandidates: number;
  totalOutcomes: number;

  outcomeBySignalKind: Record<string, Record<string, number>>;
  outcomeBySeverity: Record<string, Record<string, number>>;
  timeStats: { avgTimeToReviewDays: number; avgTimeToOutcomeDays: number };
  traceCompleteness: number;
  missingOutcomes: number;
  repeatedPatterns: string[];
  confidenceByOutcome: Record<string, number>;
  signalKindFrequency: Record<string, number>;

  footnotes: string[];

  readonly readOnly: true;
  readonly noPolicyMutation: true;
  readonly noThresholdChange: true;
  readonly noAutoAdoption: true;
  readonly noRanking: true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/governance/learning-synthesis-types.test.ts`
Expected: PASS

- [ ] **Step 5: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/governance/learning-synthesis-types.ts tests/governance/learning-synthesis-types.test.ts
git commit -m "feat(P27.1): learning synthesis types — trace model, report shape, boundary flags

DriftOutcomeTrace with deterministic sort, partial trace support,
LearningSynthesisReport with descriptive-only boundary flags.
Pure types — no stores, no fs, no predictions.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: P27.2 — Drift Outcome Correlation Analytics (learning-synthesis-analytics.ts)

**Files:**
- Create: `src/governance/learning-synthesis-analytics.ts`
- Test: `tests/governance/learning-synthesis-analytics.test.ts`

**Interfaces:**
- Consumes: `DriftOutcomeTrace[]` from Task 1
- Produces: `computeCorrelationAnalytics(traces)` → `DriftCorrelationAnalytics` — consumed by Tasks 3, 4

- [ ] **Step 1: Write the failing test**

Create `tests/governance/learning-synthesis-analytics.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeCorrelationAnalytics } from "../../src/governance/learning-synthesis-analytics.js";
import type { DriftOutcomeTrace } from "../../src/governance/learning-synthesis-types.js";

const ISO = "2026-06-15T00:00:00.000Z";

function trace(overrides: Partial<DriftOutcomeTrace> = {}): DriftOutcomeTrace {
  return {
    outcomeId: "o-1", candidateId: "c-1", signalId: "s-1",
    signalKind: "calibration_skew", signalSeverity: "medium",
    signalDirection: "too_loose", windowStart: "", windowEnd: "",
    candidateTitle: "", candidateStatus: "", candidateCreatedAt: ISO,
    candidateClosedAt: "", outcomeType: "dismissed_no_change",
    outcomeRecordedAt: "", outcomeRationale: "",
    timeToReviewDays: 0, timeToOutcomeDays: 0,
    ...overrides,
  };
}

describe("computeCorrelationAnalytics", () => {

  it("empty traces produce zero counts", () => {
    const analytics = computeCorrelationAnalytics([]);
    assert.equal(analytics.totalOutcomes, 0);
    assert.equal(analytics.traceCompleteness, 0);
  });

  it("outcome frequency by signal kind is correct", () => {
    const traces = [
      trace({ signalKind: "calibration_skew", outcomeType: "dismissed_no_change" }),
      trace({ outcomeId: "o-2", signalKind: "calibration_skew", outcomeType: "accepted_for_policy_work" }),
      trace({ outcomeId: "o-3", signalKind: "replay_divergence", outcomeType: "dismissed_no_change" }),
    ];
    const analytics = computeCorrelationAnalytics(traces);
    assert.equal(analytics.totalOutcomes, 3);
    assert.equal(analytics.outcomeBySignalKind.calibration_skew?.dismissed_no_change, 1);
    assert.equal(analytics.outcomeBySignalKind.calibration_skew?.accepted_for_policy_work, 1);
  });

  it("outcome frequency by severity is correct", () => {
    const traces = [
      trace({ signalSeverity: "high", outcomeType: "accepted_for_policy_work" }),
      trace({ outcomeId: "o-2", signalSeverity: "medium", outcomeType: "dismissed_no_change" }),
      trace({ outcomeId: "o-3", signalSeverity: "high", outcomeType: "accepted_for_policy_work" }),
    ];
    const analytics = computeCorrelationAnalytics(traces);
    assert.equal(analytics.outcomeBySeverity.high?.accepted_for_policy_work, 2);
    assert.equal(analytics.outcomeBySeverity.medium?.dismissed_no_change, 1);
  });

  it("time stats computed correctly", () => {
    const traces = [
      trace({ timeToReviewDays: 2, timeToOutcomeDays: 5 }),
      trace({ outcomeId: "o-2", timeToReviewDays: 4, timeToOutcomeDays: 7 }),
    ];
    const analytics = computeCorrelationAnalytics(traces);
    assert.equal(analytics.timeStats.avgTimeToReviewDays, 3);
    assert.equal(analytics.timeStats.avgTimeToOutcomeDays, 6);
  });

  it("no causation claims in output", () => {
    const analytics = computeCorrelationAnalytics([trace()]);
    const json = JSON.stringify(analytics);
    assert.equal(json.includes("caused"), false);
    assert.equal(json.includes("causation"), false);
  });

  it("no reviewer ranking in output", () => {
    const analytics = computeCorrelationAnalytics([trace()]);
    const keys = Object.keys(analytics);
    assert.equal(keys.some(k => k.includes("reviewer") || k.includes("ranking")), false);
  });

  it("no predictive scores or likelihood estimates", () => {
    const analytics = computeCorrelationAnalytics([trace()]);
    const json = JSON.stringify(analytics);
    assert.equal(json.includes("predictiveScore"), false);
    assert.equal(json.includes("likelihood"), false);
  });

  it("traceCompleteness computed as ratio of outcomes to candidates", () => {
    const traces = [
      trace({ outcomeId: "o-1" }),
      trace({ outcomeId: "o-2" }),
    ];
    const analytics = computeCorrelationAnalytics(traces);
    assert.equal(analytics.traceCompleteness, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/governance/learning-synthesis-analytics.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the analytics implementation**

Create `src/governance/learning-synthesis-analytics.ts`:

```typescript
/**
 * P27.2 — Drift Outcome Correlation Analytics.
 *
 * Pure read-only analytics over DriftOutcomeTrace[].
 * Computes outcome distributions by signal kind/severity, time statistics,
 * and trace completeness metrics.
 *
 * No causation claims. No reviewer ranking. No predictive scores.
 * No prescriptive governance intelligence.
 */

import type { DriftOutcomeTrace, DriftCorrelationAnalytics } from "./learning-synthesis-types.js";

// ---------------------------------------------------------------------------
// computeCorrelationAnalytics
// ---------------------------------------------------------------------------

export function computeCorrelationAnalytics(
  traces: DriftOutcomeTrace[],
): DriftCorrelationAnalytics {
  const outcomeBySignalKind: Record<string, Record<string, number>> = {};
  const outcomeBySeverity: Record<string, Record<string, number>> = {};
  const kindWindowMap = new Map<string, Set<string>>();
  let totalReviewDays = 0;
  let totalOutcomeDays = 0;

  for (const trace of traces) {
    // Outcome by signal kind
    if (!outcomeBySignalKind[trace.signalKind]) {
      outcomeBySignalKind[trace.signalKind] = {};
    }
    outcomeBySignalKind[trace.signalKind]![trace.outcomeType] =
      (outcomeBySignalKind[trace.signalKind]![trace.outcomeType] ?? 0) + 1;

    // Outcome by severity
    if (!outcomeBySeverity[trace.signalSeverity]) {
      outcomeBySeverity[trace.signalSeverity] = {};
    }
    outcomeBySeverity[trace.signalSeverity]![trace.outcomeType] =
      (outcomeBySeverity[trace.signalSeverity]![trace.outcomeType] ?? 0) + 1;

    // Time stats
    totalReviewDays += trace.timeToReviewDays;
    totalOutcomeDays += trace.timeToOutcomeDays;

    // Repeated drift: track signalKind × windowStart pairs
    if (trace.windowStart) {
      if (!kindWindowMap.has(trace.signalKind)) {
        kindWindowMap.set(trace.signalKind, new Set());
      }
      kindWindowMap.get(trace.signalKind)!.add(trace.windowStart);
    }
  }

  // Repeated patterns: signalKind appearing in 2+ distinct windows
  const repeatedPatterns: string[] = [];
  for (const [kind, windows] of kindWindowMap) {
    if (windows.size >= 2) {
      repeatedPatterns.push(kind);
    }
  }
  repeatedPatterns.sort();

  // Trace completeness
  const uniqueCandidateIds = new Set(traces.map(t => t.candidateId));
  const traceCompleteness = uniqueCandidateIds.size > 0
    ? Math.round((traces.length / uniqueCandidateIds.size) * 100) / 100
    : 0;

  return {
    totalOutcomes: traces.length,
    outcomeBySignalKind,
    outcomeBySeverity,
    timeStats: {
      avgTimeToReviewDays: traces.length > 0
        ? Math.round((totalReviewDays / traces.length) * 10) / 10
        : 0,
      avgTimeToOutcomeDays: traces.length > 0
        ? Math.round((totalOutcomeDays / traces.length) * 10) / 10
        : 0,
    },
    repeatedPatterns,
    traceCompleteness,
    missingOutcomes: 0, // computed at CLI/report level from trace data
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/governance/learning-synthesis-analytics.test.ts`
Expected: PASS

- [ ] **Step 5: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/governance/learning-synthesis-analytics.ts tests/governance/learning-synthesis-analytics.test.ts
git commit -m "feat(P27.2): drift outcome correlation analytics — pure read-only correlation

Computes outcome distribution by signal kind/severity, time-to-review/outcome
averages, repeated pattern detection (same kind, 2+ windows). No causation
claims, no reviewer ranking, no predictive scores.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: P27.3 — Review Learning Synthesis Report (learning-synthesis-report.ts)

**Files:**
- Create: `src/governance/learning-synthesis-report.ts`
- Test: `tests/governance/learning-synthesis-report.test.ts`

**Interfaces:**
- Consumes: `DriftOutcomeTrace[]`, `DriftCorrelationAnalytics` from Tasks 1/2
- Produces: `buildSynthesisReport(traces, analytics)` → `LearningSynthesisReport`, `renderSynthesisReportText()`, `renderSynthesisReportJson()` — consumed by Task 4

- [ ] **Step 1: Write the failing test**

Create `tests/governance/learning-synthesis-report.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSynthesisReport, renderSynthesisReportText } from "../../src/governance/learning-synthesis-report.js";
import { computeCorrelationAnalytics } from "../../src/governance/learning-synthesis-analytics.js";

const ISO = "2026-06-15T00:00:00.000Z";

function trace(overrides: Record<string, unknown> = {}) {
  return {
    outcomeId: "o-1", candidateId: "c-1", signalId: "s-1",
    signalKind: "calibration_skew", signalSeverity: "medium",
    signalDirection: "too_loose", windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z",
    candidateTitle: "Test", candidateStatus: "dismissed",
    candidateCreatedAt: ISO, candidateClosedAt: ISO,
    outcomeType: "dismissed_no_change",
    outcomeRecordedAt: ISO, outcomeRationale: "No evidence.",
    timeToReviewDays: 2, timeToOutcomeDays: 5,
    ...overrides,
  };
}

describe("buildSynthesisReport", () => {

  it("empty traces produce clean report", () => {
    const analytics = computeCorrelationAnalytics([]);
    const report = buildSynthesisReport([], analytics);
    assert.equal(report.totalOutcomes, 0);
    assert.equal(report.totalSignals, 0);
  });

  it("report includes all required footnotes", () => {
    const analytics = computeCorrelationAnalytics([]);
    const report = buildSynthesisReport([], analytics);
    assert.ok(report.footnotes.length >= 3);
    assert.ok(report.footnotes.some(f => f.includes("descriptive")));
    assert.ok(report.footnotes.some(f => f.includes("correlation")));
    assert.ok(report.footnotes.some(f => f.includes("human control")));
  });

  it("report uses descriptive language (no prescriptive statements)", () => {
    const traces = [trace()];
    const analytics = computeCorrelationAnalytics(traces);
    const report = buildSynthesisReport(traces, analytics);
    const text = renderSynthesisReportText(report);
    assert.equal(text.includes("increase threshold"), false);
    assert.equal(text.includes("should change"), false);
    assert.equal(text.includes("must adopt"), false);
  });

  it("report JSON output is parseable", () => {
    const analytics = computeCorrelationAnalytics([]);
    const report = buildSynthesisReport([], analytics);
    const json = JSON.stringify(report, null, 2);
    const parsed = JSON.parse(json);
    assert.ok(parsed.readOnly);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/governance/learning-synthesis-report.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the report implementation**

Create `src/governance/learning-synthesis-report.ts`:

```typescript
/**
 * P27.3 — Review Learning Synthesis Report.
 *
 * Pure function: composes DriftOutcomeTrace[] + DriftCorrelationAnalytics
 * into a structured read-only LearningSynthesisReport with text and JSON
 * output. Descriptive only — never prescriptive.
 *
 * No stores, no CLI, no audit emitters. No policy recommendations.
 * No threshold changes. No reviewer ranking. No predictive scores.
 */

import type { DriftOutcomeTrace, LearningSynthesisReport } from "./learning-synthesis-types.js";
import type { DriftCorrelationAnalytics } from "./learning-synthesis-types.js";

// ---------------------------------------------------------------------------
// Footnotes
// ---------------------------------------------------------------------------

const REQUIRED_FOOTNOTES = [
  "This report contains descriptive governance intelligence only.",
  "P27 produces correlations, not causation.",
  "No governance policy was changed by generating this report.",
  "No thresholds were adjusted.",
  "No reviewers were ranked.",
  "No candidates were prioritized.",
  "No outcomes were auto-adopted.",
  "Governance decisions remain under explicit human control.",
];

// ---------------------------------------------------------------------------
// Build report
// ---------------------------------------------------------------------------

export function buildSynthesisReport(
  traces: DriftOutcomeTrace[],
  analytics: DriftCorrelationAnalytics,
  opts?: { generatedAt?: string; windowStart?: string; windowEnd?: string },
): LearningSynthesisReport {
  const windowStart = opts?.windowStart ?? (traces.length > 0 ? traces[0]!.windowStart : "");
  const windowEnd = opts?.windowEnd ?? (traces.length > 0 ? traces[0]!.windowEnd : "");
  const signals = new Set(traces.map(t => t.signalId));
  const candidates = new Set(traces.map(t => t.candidateId));

  // Count missing outcomes: terminal candidates without outcomes
  // (computed at build time from trace data)
  const candidateOutcomeCount = new Map<string, number>();
  for (const trace of traces) {
    candidateOutcomeCount.set(trace.candidateId, (candidateOutcomeCount.get(trace.candidateId) ?? 0) + 1);
  }
  const missingOutcomes = Array.from(candidateOutcomeCount.entries())
    .filter(([, count]) => count === 0)
    .length;

  // Signal kind frequency
  const signalKindFrequency: Record<string, number> = {};
  for (const trace of traces) {
    signalKindFrequency[trace.signalKind] = (signalKindFrequency[trace.signalKind] ?? 0) + 1;
  }

  return {
    reportId: `p27-synthesis`,
    windowStart,
    windowEnd,
    generatedAt: opts?.generatedAt ?? new Date().toISOString(),
    totalSignals: signals.size,
    totalCandidates: candidates.size,
    totalOutcomes: traces.length,
    outcomeBySignalKind: analytics.outcomeBySignalKind,
    outcomeBySeverity: analytics.outcomeBySeverity,
    timeStats: analytics.timeStats,
    traceCompleteness: analytics.traceCompleteness,
    missingOutcomes,
    repeatedPatterns: analytics.repeatedPatterns,
    confidenceByOutcome: {},
    signalKindFrequency,
    footnotes: [...REQUIRED_FOOTNOTES],
    readOnly: true,
    noPolicyMutation: true,
    noThresholdChange: true,
    noAutoAdoption: true,
    noRanking: true,
  };
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

export function renderSynthesisReportText(report: LearningSynthesisReport): string {
  let out = "";

  out += "P27-SYNTHESIS-START\n";
  out += "Policy Review Learning Synthesis Report\n";
  out += "=".repeat(50) + "\n";

  out += `\n  Report ID: ${report.reportId}\n`;
  out += `  Window: ${report.windowStart} → ${report.windowEnd}\n`;
  out += `  Generated: ${report.generatedAt}\n`;

  out += `\n  Summary\n`;
  out += `    Signals: ${report.totalSignals}\n`;
  out += `    Candidates: ${report.totalCandidates}\n`;
  out += `    Outcomes: ${report.totalOutcomes}\n`;

  out += `\n  Correlations\n`;
  for (const [kind, outcomes] of Object.entries(report.outcomeBySignalKind)) {
    out += `    ${kind}:\n`;
    for (const [outcome, count] of Object.entries(outcomes)) {
      out += `      ${outcome}: ${count}\n`;
    }
  }

  out += `\n  Time Statistics\n`;
  out += `    Avg time to review: ${report.timeStats.avgTimeToReviewDays} days\n`;
  out += `    Avg time to outcome: ${report.timeStats.avgTimeToOutcomeDays} days\n`;

  out += `\n  Trace Completeness: ${report.traceCompleteness}\n`;
  out += `  Missing outcomes: ${report.missingOutcomes}\n`;

  if (report.repeatedPatterns.length > 0) {
    out += `\n  Repeated Drift Patterns\n`;
    for (const pattern of report.repeatedPatterns) {
      out += `    ${pattern} (appears in 2+ windows)\n`;
    }
  }

  out += "\n---\n";
  for (const note of report.footnotes) {
    out += note + "\n";
  }
  out += "P27-SYNTHESIS-END\n";

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/governance/learning-synthesis-report.test.ts`
Expected: PASS

- [ ] **Step 5: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/governance/learning-synthesis-report.ts tests/governance/learning-synthesis-report.test.ts
git commit -m "feat(P27.3): learning synthesis report — descriptive-only output with footnotes

Pure report builder with 8 required footnotes, boundary flags,
descriptive-only language verification. No prescriptive statements,
no recommendations, no predictive scores.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: P27.4 — CLI + Dispatch (governance-learning-synthesis.ts)

**Files:**
- Create: `src/cli/commands/governance-learning-synthesis.ts`
- Modify: `src/cli/commands/governance.ts` — add `case "learning-synthesis"` dispatch
- Test: `tests/governance/learning-synthesis-cli.test.ts`

**Interfaces:**
- Consumes: `computeCorrelationAnalytics()` from Task 2, `buildSynthesisReport()` + `renderSynthesisReportText()` from Task 3
- Produces: CLI handler wired into `alix governance learning-synthesis {build|report}` — no write path

- [ ] **Step 1: Write the failing CLI tests**

Create `tests/governance/learning-synthesis-cli.test.ts`:

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleGovernanceLearningSynthesisCommand } from "../../src/cli/commands/governance-learning-synthesis.js";

let tmpDir: string;
let bundlePath: string;

const VALID_ISO = "2026-07-08T18:00:00.000Z";

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "p27-cli-"));
  bundlePath = join(tmpDir, "test-bundle.json");

  // Minimal P24 bundle
  writeFileSync(bundlePath, JSON.stringify({
    signals: [
      { signalId: "s-1", kind: "calibration_skew", severity: "medium", direction: "too_loose", windowStart: "2026-06-01T00:00:00.000Z", windowEnd: "2026-07-01T00:00:00.000Z", confidence: 0.7, sampleSize: { p22CalibrationCount: 20, p23ReplayCount: 15, pairedLifecycleCount: 10 }, rates: { overconfidentRate: 0.65 }, implicatedPolicyAreas: [], evidenceRefs: [], rationale: [] },
    ],
  }));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleGovernanceLearningSynthesisCommand", () => {

  it("returns usage when no subcommand given", async () => {
    const result = await handleGovernanceLearningSynthesisCommand([], { cwd: tmpDir });
    assert.ok(result.includes("usage"));
  });

  it("build reads from bundle without error", async () => {
    const result = await handleGovernanceLearningSynthesisCommand(
      ["build", "--p24-bundle", bundlePath],
      { cwd: tmpDir },
    );
    assert.ok(result.includes("P27-BUILD"));
  });

  it("build --json returns parseable JSON", async () => {
    const result = await handleGovernanceLearningSynthesisCommand(
      ["build", "--json", "--p24-bundle", bundlePath],
      { cwd: tmpDir },
    );
    const parsed = JSON.parse(result);
    assert.ok(parsed.traces !== undefined);
  });

  it("report renders text output", async () => {
    const result = await handleGovernanceLearningSynthesisCommand(
      ["report", "--p24-bundle", bundlePath],
      { cwd: tmpDir },
    );
    assert.ok(result.includes("P27-SYNTHESIS"));
  });

  it("report --json returns parseable JSON", async () => {
    const result = await handleGovernanceLearningSynthesisCommand(
      ["report", "--json", "--p24-bundle", bundlePath],
      { cwd: tmpDir },
    );
    const parsed = JSON.parse(result);
    assert.ok(parsed.totalOutcomes !== undefined);
  });

  it("no write operations occur (store directory not created)", () => {
    // P27 has no write path — verify .alix/governance/learning-synthesis is NOT created
    const storePath = join(tmpDir, ".alix", "governance", "learning-synthesis");
    assert.equal(require("node:fs").existsSync(storePath), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/governance/learning-synthesis-cli.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the CLI handler**

Create `src/cli/commands/governance-learning-synthesis.ts`:

```typescript
/**
 * P27.4 — Learning Synthesis CLI Handler.
 *
 * `alix governance learning-synthesis` subcommands:
 *   build   — Read-only: load P24 bundle + P25 candidates + P26 outcomes,
 *             compute traces and analytics, output trace set
 *   report  — Read-only: compute traces + analytics + render report
 *
 * CLI invariants:
 *   - No write path — no files are created or modified
 *   - No store persistence — all computation is in-memory
 *   - No execution adapters, no audit emitters, no policy writers
 *   - Descriptive output only — no prescriptive recommendations
 *   - No predictive scores or likelihood estimates
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { computeCorrelationAnalytics } from "../../governance/learning-synthesis-analytics.js";
import { buildSynthesisReport, renderSynthesisReportText } from "../../governance/learning-synthesis-report.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flag(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Trace builder (pure computation at CLI boundary)
// ---------------------------------------------------------------------------

interface BuildResult {
  traces: any[];
  analytics: any;
  report: any;
}

function build(cwd: string, p24BundlePath: string): BuildResult | string {
  // 1. Load P24 bundle
  const bundle = readJson<any>(p24BundlePath);
  if (!bundle) return "ERROR: Could not load P24 bundle.\n";

  const signals = Array.isArray(bundle) ? bundle : (bundle.signals ?? []);
  if (signals.length === 0) return "ERROR: No P24 signals found in bundle.\n";

  // 2. Load P25 candidates
  const candidatesDir = join(cwd, ".alix", "governance", "policy-review-candidates");
  const candidates: Record<string, any> = {};
  if (existsSync(candidatesDir)) {
    const { readdirSync } = require("node:fs");
    try {
      const files = readdirSync(candidatesDir);
      for (const file of files) {
        if (file.endsWith(".json") && !file.endsWith(".events.jsonl")) {
          const candidateId = file.replace(/\.json$/, "");
          const data = readJson<any>(join(candidatesDir, file));
          if (data) candidates[candidateId] = data;
        }
      }
    } catch {}
  }

  // 3. Load P26 outcomes
  const outcomesDir = join(cwd, ".alix", "governance", "policy-review-outcomes");
  const outcomes: any[] = [];
  if (existsSync(outcomesDir)) {
    const { readdirSync } = require("node:fs");
    try {
      const files = readdirSync(outcomesDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const data = readJson<any>(join(outcomesDir, file));
          if (data) outcomes.push(data);
        }
      }
    } catch {}
  }

  // 4. Build traces: join outcomes → candidates → embedded signal metadata
  const traces: any[] = [];
  const processedOutcomes = new Set<string>();

  for (const outcome of outcomes) {
    const candidate = candidates[outcome.candidateId];
    const signal = signals.find((s: any) =>
      s.signalId === candidate?.source?.signalId,
    );

    // Also try matching by kind if signalId doesn't match directly
    const resolvedSignal = signal ?? (candidate ? signals.find((s: any) =>
      s.kind === candidate.source?.signalKind &&
      s.windowStart === candidate.source?.windowStart,
    ) : undefined);

    const candidateCreated = candidate?.createdAt ?? outcome.createdAt;
    const candidateClosed = candidate?.updatedAt ?? "";
    const outcomeRecorded = outcome.recordedAt ?? outcome.createdAt;

    const createMs = new Date(candidateCreated).getTime();
    const closeMs = candidateClosed ? new Date(candidateClosed).getTime() : 0;
    const outcomeMs = outcomeRecorded ? new Date(outcomeRecorded).getTime() : 0;

    traces.push({
      outcomeId: outcome.outcomeId,
      candidateId: outcome.candidateId,
      signalId: resolvedSignal?.signalId ?? candidate?.source?.signalId ?? "",
      signalKind: candidate?.source?.signalKind ?? resolvedSignal?.kind ?? "",
      signalSeverity: candidate?.source?.signalSeverity ?? resolvedSignal?.severity ?? "",
      signalDirection: candidate?.source?.signalDirection ?? resolvedSignal?.direction ?? "",
      windowStart: candidate?.source?.windowStart ?? "",
      windowEnd: candidate?.source?.windowEnd ?? "",
      candidateTitle: candidate?.title ?? "",
      candidateStatus: candidate?.status ?? "",
      candidateCreatedAt: candidateCreated,
      candidateClosedAt: candidateClosed,
      outcomeType: outcome.outcomeType,
      outcomeRecordedAt: outcomeRecorded,
      outcomeRationale: outcome.rationale ?? "",
      timeToReviewDays: closeMs && createMs ? Math.round((closeMs - createMs) / (1000 * 60 * 60 * 24)) : 0,
      timeToOutcomeDays: outcomeMs && createMs ? Math.round((outcomeMs - createMs) / (1000 * 60 * 60 * 24)) : 0,
    });

    processedOutcomes.add(outcome.outcomeId);
  }

  // 5. Compute analytics
  const analytics = computeCorrelationAnalytics(traces);

  // 6. Build report
  const report = buildSynthesisReport(traces, analytics);

  return { traces, analytics, report };
}

// ---------------------------------------------------------------------------
// Build handler
// ---------------------------------------------------------------------------

function handleBuild(args: string[], cwd: string): string {
  const p24BundlePath = flag(args, "--p24-bundle");
  if (!p24BundlePath) {
    return "ERROR: --p24-bundle <path> is required.\n" + usage();
  }

  const result = build(cwd, p24BundlePath);
  if (typeof result === "string") return result;

  if (hasFlag(args, "--json")) {
    return JSON.stringify({ traces: result.traces, analytics: result.analytics }, null, 2) + "\n";
  }

  let out = "P27-BUILD\n";
  out += "Learning Synthesis — Trace Build\n";
  out += `${result.traces.length} trace(s) built\n`;
  out += `Window: ${result.report.windowStart} → ${result.report.windowEnd}\n`;
  out += "P27-BUILD-END\n";
  return out;
}

// ---------------------------------------------------------------------------
// Report handler
// ---------------------------------------------------------------------------

function handleReport(args: string[], cwd: string): string {
  const p24BundlePath = flag(args, "--p24-bundle");
  if (!p24BundlePath) {
    return "ERROR: --p24-bundle <path> is required.\n" + usage();
  }

  const result = build(cwd, p24BundlePath);
  if (typeof result === "string") return result;

  const report = result.report;

  if (hasFlag(args, "--json")) {
    return JSON.stringify(report, null, 2) + "\n";
  }

  return renderSynthesisReportText(report);
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function usage(): string {
  return (
    "usage: alix governance learning-synthesis <command> [<args>]\n" +
    "\n" +
    "Commands:\n" +
    "  build --p24-bundle <path> [--json]\n" +
    "    Read-only: build traces from P24 bundle + P25 candidates + P26 outcomes\n" +
    "\n" +
    "  report --p24-bundle <path> [--json]\n" +
    "    Read-only: compute analytics + render learning synthesis report\n"
  );
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

export function handleGovernanceLearningSynthesisCommand(
  args: string[],
  opts: { cwd: string },
): string {
  const cwd = opts.cwd;
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help") {
    return usage();
  }

  switch (subcommand) {
    case "build":
      return handleBuild(args.slice(1), cwd);
    case "report":
      return handleReport(args.slice(1), cwd);
    default:
      return usage();
  }
}
```

- [ ] **Step 4: Wire dispatch in governance.ts**

Read `src/cli/commands/governance.ts` and add after the `case "policy-review-outcome"` block:

```typescript
    case "learning-synthesis": {
      const { handleGovernanceLearningSynthesisCommand } = await import("./governance-learning-synthesis.js");
      return handleGovernanceLearningSynthesisCommand(args.slice(1), { cwd });
    }
```

- [ ] **Step 5: Run CLI tests to verify they pass**

Run: `npx tsx --test tests/governance/learning-synthesis-cli.test.ts`
Expected: PASS

- [ ] **Step 6: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/governance-learning-synthesis.ts src/cli/commands/governance.ts tests/governance/learning-synthesis-cli.test.ts
git commit -m "feat(P27.4): learning synthesis CLI — build|report, no write path

Wires alix governance learning-synthesis subcommand tree into governance.ts
dispatch. Build and report are read-only. No write path — no files created,
no store persistence. Descriptive intelligence only.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: P27.5 — Checkpoint

**Files:**
- Create: `docs/architecture/checkpoints/2026-07-09-p27-5-policy-review-learning-synthesis-drift-outcome-correlation-checkpoint.md`

- [ ] **Step 1: Write the checkpoint doc**

Create `docs/architecture/checkpoints/2026-07-09-p27-5-policy-review-learning-synthesis-drift-outcome-correlation-checkpoint.md`:

*(Standard checkpoint doc with verification checklists for: no execution, no mutation, no ranking, no auto-adoption, descriptive-only output, causation absence, predictive score absence, P24/P25/P26 unchanged, 20 tests pass, tsc clean.)*

- [ ] **Step 2: Run full P27 test suite**

Run: `npx tsx --test tests/governance/learning-synthesis-types.test.ts tests/governance/learning-synthesis-analytics.test.ts tests/governance/learning-synthesis-report.test.ts tests/governance/learning-synthesis-cli.test.ts 2>&1`
Expected: All 20 tests pass

- [ ] **Step 3: Final tsc check**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 4: Commit checkpoint doc**

```bash
git add docs/architecture/checkpoints/2026-07-09-p27-5-policy-review-learning-synthesis-drift-outcome-correlation-checkpoint.md
git commit -m "docs(P27.5): policy review learning synthesis checkpoint"
```

- [ ] **Step 5: Create seal tag**

```bash
git tag alix-p27-policy-review-learning-synthesis-drift-outcome-correlation-complete
```

---

## Summary

| Slice | Files Created | Tests | Commit |
|-------|--------------|-------|--------|
| P27.1 | 2 | 3 | `feat(P27.1): learning synthesis types — trace model, report shape, boundary flags` |
| P27.2 | 2 | 8 | `feat(P27.2): drift outcome correlation analytics — pure read-only correlation` |
| P27.3 | 2 | 4 | `feat(P27.3): learning synthesis report — descriptive-only output with footnotes` |
| P27.4 (CLI) | 2+1 touch | 6 | `feat(P27.4): learning synthesis CLI — build|report, no write path` |
| P27.5 | 1 | — | `docs(P27.5): policy review learning synthesis checkpoint` |
| **Total** | **11 files** | **21 tests** | **5 commits** |
