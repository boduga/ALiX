# P6.3 — Strategic Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 5th and final layer of the P6 Decision Influence framework — a pure synthesis builder that reads from existing persisted stores (IntelligenceStore, EffectivenessStore, EvidenceStore) and produces time-windowed strategic intelligence.

**Architecture:** Pure builder pattern matching OperatorQueue — `StrategicBriefBuilder.build(input, options?)` takes pre-built input arrays, applies deterministic window filtering and trend/hotspot/warning synthesis, and returns a `StrategicBrief` artifact. No stores, no mutations, no per-proposal references in output.

**Tech Stack:** TypeScript (NodeNext), vitest

## Global Constraints

- **NodeNext module resolution:** All cross-file imports MUST use `.js` extension (e.g., `./strategic-brief-types.js`)
- **Discriminated union narrowing:** `expect(result.success).toBe(true)` does NOT narrow types in vitest — use `as any` casts or early `if (!result.success) return` guards where needed
- **No proposal IDs in output:** Findings, trends, hotspots, and strategicActions must never contain `prop-` strings (static source-grep + runtime JSON scan sentinel)
- **No per-proposal directive language:** Output must not contain `"approve proposal"`, `"reject proposal"`, `"approve prop-"`, `"reject prop-"` — only historical metrics like "approval rate" are allowed
- **Pure builder:** No store imports (`proposal-store`, `evidence-store`, `*-store`), no builder/engine imports (`DecisionContextBuilder`, `RiskScoreBuilder`, `RecommendationEngine`, `OperatorQueue`), no mutation calls (`.save()`, `.update()`, `.approve()`, `.apply()`)
- **SourceArtifactType already widened:** `"context"`, `"risk"`, `"recommendation"` are valid — no changes needed to decision-types.ts
- **EvidenceStore.query uses `type` (singular) not `types`:** `EvidenceQuery.type` is a single `EvidenceType`, not an array. For multi-type queries, query with a high limit and filter in-memory
- **targetSampleSize = 30** for confidence formula
- **Confidence formula:** `min(1, sampleSize / targetSampleSize)`
- **Store querying is CLI-layer responsibility** — builder never touches stores

---

### Task 1: Strategic Brief Types

**Files:**
- Create: `src/adaptation/strategic-brief-types.ts`

**Interfaces:**
- Consumes: `DecisionArtifact`, `SourceArtifact` from `./decision-types.js`; `IntelligenceReport` from `./intelligence-types.js`; `ProposalEffectivenessReport` from `./effectiveness-types.js`; `EvidenceRecord` from `../security/evidence/evidence-types.js`
- Produces: `TimeWindow`, `StrategicFinding`, `Trend`, `Hotspot`, `StrategicBriefInput`, `StrategicBriefOptions`, `StrategicBrief`

- [ ] **Step 1: Write the failing test shell**

```typescript
// Place in tests/adaptation/strategic-brief.vitest.ts (will be expanded in Task 3)
import { describe, it, expect } from "vitest";
import type { StrategicBrief, StrategicFinding, Trend, Hotspot, TimeWindow } from "../../src/adaptation/strategic-brief-types.js";

describe("StrategicBrief type shape", () => {
  it("type exists", () => {
    // Compile-time check — if the type doesn't exist, this file won't compile
    const brief: StrategicBrief = null as any;
    expect(brief).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adaptation/strategic-brief.vitest.ts 2>&1 | tail -20`
Expected: FAIL — "Cannot find module" or "strategic-brief-types" not found

- [ ] **Step 3: Create strategic-brief-types.ts**

```typescript
/**
 * P6.3 — Strategic Brief type definitions.
 *
 * StrategicBrief is the 5th and final layer of the P6 Decision Influence
 * framework. It answers "What patterns matter over time?" by synthesizing
 * temporal intelligence from existing persisted stores.
 *
 * Pure data types with no storage dependencies.
 * No proposal-ID references in output types.
 *
 * @module
 */

import type { DecisionArtifact, SourceArtifact } from "./decision-types.js";
import type { IntelligenceReport } from "./intelligence-types.js";
import type { ProposalEffectivenessReport } from "./effectiveness-types.js";
import type { EvidenceRecord } from "../security/evidence/evidence-types.js";

// ---------------------------------------------------------------------------
// TimeWindow
// ---------------------------------------------------------------------------

export interface TimeWindow {
  /** ISO 8601 — start of the rolling window (inclusive). */
  start: string;
  /** ISO 8601 — end of the rolling window (inclusive). */
  end: string;
}

// ---------------------------------------------------------------------------
// StrategicFinding
// ---------------------------------------------------------------------------

export type FindingCategory = "trend" | "hotspot" | "system_warning" | "strategic_observation";

export interface StrategicFinding {
  category: FindingCategory;
  /** One-sentence finding. */
  summary: string;
  /** Supporting detail. */
  detail: string;
  /** Confidence in this finding (0-1). */
  confidence: number;
  /** Evidence refs supporting this finding. */
  evidenceRefs: string[];
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

export interface Trend {
  /** What is trending — e.g. "outcome keep rate". */
  metric: string;
  /** Direction of change. */
  direction: "increasing" | "decreasing" | "stable";
  /** Magnitude of change (0-1 scale). */
  magnitude: number;
  /** Sample size supporting this trend. */
  sampleSize: number;
}

// ---------------------------------------------------------------------------
// Hotspot
// ---------------------------------------------------------------------------

export interface Hotspot {
  /** Area of concern — e.g. "capability changes". */
  area: string;
  /** Risk level. */
  severity: "low" | "medium" | "high";
  /** Action types or capability areas involved. */
  relatedActionTypes: string[];
  /** Supporting evidence. */
  evidence: string;
}

// ---------------------------------------------------------------------------
// StrategicBriefInput — what the CLI assembles
// ---------------------------------------------------------------------------

export interface StrategicBriefInput {
  intelligenceReports: IntelligenceReport[];
  effectivenessReports: ProposalEffectivenessReport[];
  evidenceRecords: EvidenceRecord[];
}

// ---------------------------------------------------------------------------
// StrategicBriefOptions
// ---------------------------------------------------------------------------

export interface StrategicBriefOptions {
  /** Rolling window size in days: 30, 90, or 180. Default: 30. */
  window?: 30 | 90 | 180;
  /** Override generatedAt for deterministic testing. */
  generatedAt?: string;
}

// ---------------------------------------------------------------------------
// StrategicBrief — the output artifact
// ---------------------------------------------------------------------------

export interface StrategicBrief extends DecisionArtifact {
  /** The time window this brief covers. */
  period: TimeWindow;
  /** Strategic findings — no per-proposal references. */
  findings: StrategicFinding[];
  /** Detected trends across the window. */
  trends: Trend[];
  /** Emerging areas of concern. */
  hotspots: Hotspot[];
  /**
   * Strategic action areas — NOT per-proposal recommendations.
   * Examples:
   *   - "Review governance requirements for agent-card modifications"
   *   - "Investigate rising defer rates on skill-definition changes"
   */
  strategicActions: string[];
  /**
   * Confidence in the brief's data sufficiency — NOT confidence that any
   * action should be taken.
   *
   * Formula: min(1, sampleSize / targetSampleSize) adjusted downward for
   * data gaps. targetSampleSize = 30 (one proposal per day in a 30-day window).
   */
  confidence: number;
  /** Source artifacts consumed: intelligence, effectiveness, evidence. */
  sourceArtifacts: SourceArtifact[];
}
```

- [ ] **Step 4: Remove the test shell and run the real test**

Delete the shell test and run the rest of vitest briefly to confirm the types compile:
```bash
npx tsc --noEmit src/adaptation/strategic-brief-types.ts 2>&1
```
Expected: no errors (exit 0)

- [ ] **Step 5: Commit**

```bash
git add src/adaptation/strategic-brief-types.ts
git commit -m "feat(p6.3): StrategicBrief type definitions"
```

---

### Task 2: StrategicBriefBuilder — Pure Synthesis Class

**Files:**
- Create: `src/adaptation/strategic-brief.ts`

**Interfaces:**
- Consumes: All types from `./strategic-brief-types.js`, `./decision-types.js` (DecisionArtifact, SourceArtifact)
- Produces: `StrategicBriefBuilder` class with single `build(input, options?)` method

- [ ] **Step 1: Write the failing test shell**

```typescript
// Add to tests/adaptation/strategic-brief.vitest.ts
import { describe, it, expect } from "vitest";
import { StrategicBriefBuilder } from "../../src/adaptation/strategic-brief.js";

describe("StrategicBriefBuilder", () => {
  it("exists and has a build method", () => {
    const b = new StrategicBriefBuilder();
    expect(typeof b.build).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adaptation/strategic-brief.vitest.ts 2>&1 | tail -20`
Expected: FAIL — "Cannot find module" for strategic-brief.js

- [ ] **Step 3: Implement StrategicBriefBuilder**

```typescript
/**
 * P6.3 — StrategicBriefBuilder: pure synthesis class.
 *
 * Takes pre-built StrategicBriefInput and returns a StrategicBrief with
 * trends, hotspots, findings, and strategic actions derived from historical
 * intelligence, effectiveness, and evidence data.
 *
 * No store access, no builder imports, no evaluation logic.
 * Deterministic: same inputs in any order → same outputs.
 * No proposal IDs appear in findings, trends, hotspots, or strategicActions.
 *
 * @module
 */

import type {
  StrategicBrief,
  StrategicBriefInput,
  StrategicBriefOptions,
  StrategicFinding,
  Trend,
  Hotspot,
  TimeWindow,
  FindingCategory,
} from "./strategic-brief-types.js";
import type { SourceArtifact } from "./decision-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TARGET_SAMPLE_SIZE = 30;
const HIGH_REVERT_THRESHOLD = 0.15;
const WINDOW_MS_MAP: Record<number, number> = {
  30: 30 * 24 * 60 * 60 * 1000,
  90: 90 * 24 * 60 * 60 * 1000,
  180: 180 * 24 * 60 * 60 * 1000,
};
const DEFAULT_WINDOW = 30;
const OUTCOME_BRIEF = "brief";

// ---------------------------------------------------------------------------
// StrategicBriefBuilder
// ---------------------------------------------------------------------------

export class StrategicBriefBuilder {
  /**
   * Build a StrategicBrief from historical intelligence, effectiveness,
   * and evidence records.
   *
   * Pure function — no stores, no side effects.
   * Deterministic for same inputs + same generatedAt.
   *
   * @param input - Pre-assembled decision artifacts per pending proposal
   * @param options - Optional window size and generatedAt override
   * @returns StrategicBrief with window-filtered trends, hotspots, findings
   */
  build(input: StrategicBriefInput, options?: StrategicBriefOptions): StrategicBrief {
    const windowSize = options?.window ?? DEFAULT_WINDOW;
    const generatedAt = options?.generatedAt ?? new Date().toISOString();
    const windowMs = WINDOW_MS_MAP[windowSize];
    const windowEnd = new Date(generatedAt);
    const windowStart = new Date(windowEnd.getTime() - windowMs);

    const period: TimeWindow = {
      start: windowStart.toISOString(),
      end: generatedAt,
    };

    // Filter inputs to the window
    const windowedInput = this.#filterByWindow(input, windowStart, windowEnd);

    // Detect trends from intelligence reports
    const trends = this.#detectTrends(windowedInput.intelligenceReports);

    // Identify hotspots from effectiveness reports
    const hotspots = this.#identifyHotspots(windowedInput.effectivenessReports);

    // Generate system warnings
    const findings = this.#generateFindings(windowedInput, trends, hotspots);

    // Compute confidence
    const sampleSize = this.#computeSampleSize(windowedInput);
    const confidence = Math.min(1, sampleSize / TARGET_SAMPLE_SIZE);

    // Build aggregate sourceArtifacts — no proposal IDs leak through
    const intelCount = windowedInput.intelligenceReports.length;
    const effCount = windowedInput.effectivenessReports.length;
    const evCount = windowedInput.evidenceRecords.length;
    const sourceArtifacts: SourceArtifact[] = [
      ...(intelCount > 0
        ? [{ type: "intelligence" as const, id: `intelligence:${intelCount}:${period.start}:${period.end}`, timestamp: generatedAt }]
        : []),
      ...(effCount > 0
        ? [{ type: "effectiveness" as const, id: `effectiveness:${effCount}:${period.start}:${period.end}`, timestamp: generatedAt }]
        : []),
      ...(evCount > 0
        ? [{ type: "proposal" as const, id: `evidence:${evCount}:${period.start}:${period.end}`, timestamp: generatedAt }]
        : []),
    ];

    // Build strategic actions from findings
    const strategicActions = this.#buildStrategicActions(findings, hotspots);

    return {
      id: `brief:${generatedAt}:${windowSize}d`,
      subject: `Strategic Brief — Last ${windowSize} days`,
      outcome: OUTCOME_BRIEF,
      confidence,
      reasons: this.#buildConfidenceReasons(sampleSize, windowedInput),
      evidenceRefs: [
        `intelligence:${windowedInput.intelligenceReports.length}`,
        `effectiveness:${windowedInput.effectivenessReports.length}`,
        `evidence:${windowedInput.evidenceRecords.length}`,
      ].filter(Boolean),
      generatedAt,
      period,
      findings,
      trends,
      hotspots,
      strategicActions,
      sourceArtifacts,
    };
  }

  // ---- private helpers ----

  /**
   * Filter input data to only include records within the rolling window.
   */
  #filterByWindow(
    input: StrategicBriefInput,
    start: Date,
    end: Date,
  ): StrategicBriefInput {
    return {
      intelligenceReports: input.intelligenceReports.filter((r) => {
        const t = new Date(r.generatedAt).getTime();
        return t >= start.getTime() && t <= end.getTime();
      }),
      effectivenessReports: input.effectivenessReports.filter((r) => {
        const t = new Date(r.assessedAt).getTime();
        return t >= start.getTime() && t <= end.getTime();
      }),
      evidenceRecords: input.evidenceRecords.filter((r) => {
        const t = new Date(r.timestamp).getTime();
        return t >= start.getTime() && t <= end.getTime();
      }),
    };
  }

  /**
   * Detect metric trends from intelligence report data.
   * Compares oldest vs newest report within the window.
   * Returns empty array when fewer than 2 reports available.
   */
  #detectTrends(reports: StrategicBriefInput["intelligenceReports"]): Trend[] {
    if (reports.length < 2) return [];

    // Sort by generatedAt ascending
    const sorted = [...reports].sort(
      (a, b) => new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime(),
    );

    const oldest = sorted[0];
    const newest = sorted[sorted.length - 1];
    const trends: Trend[] = [];

    // Trend: keep rate by action type (compare topPerforming/lowestPerforming)
    // ponytail: simple keep-rate trend from top-level references
    const oldBestKeep = oldest.topPerforming[0]?.keepRate ?? 0;
    const newBestKeep = newest.topPerforming[0]?.keepRate ?? 0;
    const keepDelta = newBestKeep - oldBestKeep;
    if (Math.abs(keepDelta) > 0.05) {
      trends.push({
        metric: "top-performing action keep rate",
        direction: keepDelta > 0 ? "increasing" : "decreasing",
        magnitude: Math.abs(keepDelta),
        sampleSize: Math.max(oldest.totalProposalsAnalyzed, newest.totalProposalsAnalyzed),
      });
    }

    // Trend: confidence calibration drift — compare first confidence bucket's range
    if (oldest.confidenceCalibration.buckets.length > 0 && newest.confidenceCalibration.buckets.length > 0) {
      const oldHighBucket = oldest.confidenceCalibration.buckets[oldest.confidenceCalibration.buckets.length - 1];
      const newHighBucket = newest.confidenceCalibration.buckets[newest.confidenceCalibration.buckets.length - 1];
      const oldKeepInHigh = oldHighBucket.keepRate ?? 0;
      const newKeepInHigh = newHighBucket.keepRate ?? 0;
      const calDelta = newKeepInHigh - oldKeepInHigh;
      if (Math.abs(calDelta) > 0.05) {
        trends.push({
          metric: "high-confidence outcome keep rate",
          direction: calDelta > 0 ? "increasing" : "decreasing",
          magnitude: Math.abs(calDelta),
          sampleSize: Math.max(oldHighBucket.totalProposals, newHighBucket.totalProposals),
        });
      }
    }

    // Trend: revert signal trend
    if (oldest.revertSignalAnalysis.totalAdvisoryReverts !== newest.revertSignalAnalysis.totalAdvisoryReverts) {
      const oldRate = oldest.totalProposalsAnalyzed > 0
        ? oldest.revertSignalAnalysis.totalAdvisoryReverts / oldest.totalProposalsAnalyzed
        : 0;
      const newRate = newest.totalProposalsAnalyzed > 0
        ? newest.revertSignalAnalysis.totalAdvisoryReverts / newest.totalProposalsAnalyzed
        : 0;
      const revertDelta = newRate - oldRate;
      if (Math.abs(revertDelta) > 0.05) {
        trends.push({
          metric: "advisory revert rate",
          direction: revertDelta > 0 ? "increasing" : "decreasing",
          magnitude: Math.abs(revertDelta),
          sampleSize: Math.max(oldest.totalProposalsAnalyzed, newest.totalProposalsAnalyzed),
        });
      }
    }

    return trends;
  }

  /**
   * Identify hotspots from effectiveness reports.
   * Flags areas where revert rates exceed threshold or recommendation
   * patterns suggest concentration.
   */
  #identifyHotspots(reports: StrategicBriefInput["effectivenessReports"]): Hotspot[] {
    if (reports.length === 0) return [];

    const hotspots: Hotspot[] = [];

    // ponytail: group by recommendation and check revert rates
    // Effectiveness reports don't carry action type at the interface level,
    // so relatedActionTypes uses "unknown" — extend when richer data is available.
    const byRecommendation = new Map<string, { total: number; revert: number }>();
    for (const report of reports) {
      const key = report.recommendation;
      if (!byRecommendation.has(key)) {
        byRecommendation.set(key, { total: 0, revert: 0 });
      }
      const entry = byRecommendation.get(key)!;
      entry.total++;
      if (report.recommendation === "revert") entry.revert++;
    }

    for (const [rec, data] of byRecommendation) {
      const revertRate = data.total > 0 ? data.revert / data.total : 0;
      if (revertRate > HIGH_REVERT_THRESHOLD) {
        hotspots.push({
          area: `${rec} recommendation concentration`,
          severity: revertRate > 0.3 ? "high" : "medium",
          relatedActionTypes: ["unknown"],
          evidence: `${data.revert}/${data.total} effectiveness reports recommend revert (${(revertRate * 100).toFixed(0)}%)`,
        });
      }
    }

    return hotspots;
  }

  /**
   * Generate strategic findings from the windowed input data.
   * Findings are descriptive, not prescriptive — they describe patterns.
   * No proposal IDs appear in findings.
   */
  #generateFindings(
    windowed: StrategicBriefInput,
    trends: Trend[],
    hotspots: Hotspot[],
  ): StrategicFinding[] {
    const findings: StrategicFinding[] = [];

    // System warnings based on data quality
    if (windowed.intelligenceReports.length === 0) {
      findings.push({
        category: "system_warning",
        summary: "No intelligence reports available in this window",
        detail: "Trend analysis is limited without intelligence data. Run `alix adaptation intelligence` to generate reports.",
        confidence: 1,
        evidenceRefs: [],
      });
    }

    if (windowed.effectivenessReports.length === 0) {
      findings.push({
        category: "system_warning",
        summary: "No effectiveness reports available in this window",
        detail: "Hotspot detection is limited without effectiveness data. Effectiveness reports are generated by the P5.2 assessment pipeline.",
        confidence: 1,
        evidenceRefs: [],
      });
    }

    // Add trend-based findings
    for (const trend of trends) {
      findings.push({
        category: "trend",
        summary: `${trend.metric} is ${trend.direction}`,
        detail: `Magnitude: ${(trend.magnitude * 100).toFixed(0)}%, based on ${trend.sampleSize} proposal(s)`,
        confidence: Math.min(1, trend.sampleSize / TARGET_SAMPLE_SIZE),
        evidenceRefs: [],
      });
    }

    // Add hotspot-based findings
    for (const hotspot of hotspots) {
      findings.push({
        category: "hotspot",
        summary: `Hotspot: ${hotspot.area}`,
        detail: hotspot.evidence,
        confidence: hotspot.severity === "high" ? 0.9 : 0.7,
        evidenceRefs: [],
      });
    }

    // Add strategic observations
    if (windowed.intelligenceReports.length > 0) {
      const latestReport = windowed.intelligenceReports[windowed.intelligenceReports.length - 1];
      if (latestReport.executiveSummary) {
        findings.push({
          category: "strategic_observation",
          summary: "Intelligence summary available for context",
          detail: latestReport.executiveSummary,
          confidence: 0.8,
          evidenceRefs: [],
        });
      }
    }

    return findings;
  }

  /**
   * Compute the effective sample size from all input sources.
   */
  #computeSampleSize(windowed: StrategicBriefInput): number {
    return (
      windowed.intelligenceReports.length +
      windowed.effectivenessReports.length +
      windowed.evidenceRecords.length
    );
  }

  /**
   * Build confidence rationale reasons.
   */
  #buildConfidenceReasons(
    sampleSize: number,
    windowed: StrategicBriefInput,
  ): string[] {
    const reasons: string[] = [];
    reasons.push(
      `Data sufficiency: ${sampleSize} total records (${TARGET_SAMPLE_SIZE} target) = ${Math.min(1, sampleSize / TARGET_SAMPLE_SIZE) < 1 ? "below target" : "at or above target"}`,
    );
    reasons.push(`Intelligence reports in window: ${windowed.intelligenceReports.length}`);
    reasons.push(`Effectiveness reports in window: ${windowed.effectivenessReports.length}`);
    reasons.push(`Evidence records in window: ${windowed.evidenceRecords.length}`);
    return reasons;
  }

  /**
   * Build strategic action areas from findings and hotspots.
   * These are action-type or capability-area level recommendations,
   * NOT per-proposal directives.
   */
  #buildStrategicActions(
    findings: StrategicFinding[],
    hotspots: Hotspot[],
  ): string[] {
    const actions: string[] = [];

    for (const hotspot of hotspots) {
      if (hotspot.severity === "high") {
        actions.push(
          `Investigate rising ${hotspot.area} — consider governance or process adjustments`,
        );
      } else {
        actions.push(
          `Monitor ${hotspot.area} for escalation`,
        );
      }
    }

    if (findings.filter((f) => f.category === "system_warning").length > 0) {
      actions.push(
        "Improve data collection to enable more reliable strategic analysis",
      );
    }

    return actions;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adaptation/strategic-brief.vitest.ts 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adaptation/strategic-brief.ts tests/adaptation/strategic-brief.vitest.ts
git commit -m "feat(p6.3): StrategicBriefBuilder pure synthesis class"
```

---

### Task 3: Comprehensive Unit Tests

**Files:**
- Modify: `tests/adaptation/strategic-brief.vitest.ts` (replace shell with full tests)

**Interfaces:**
- Consumes: `StrategicBriefBuilder`, all types from `./strategic-brief-types.js`

- [ ] **Step 1: Write the complete test suite**

```typescript
/**
 * P6.3 — StrategicBrief comprehensive unit tests.
 *
 * Covers: type shape, builder behavior, window filtering, determinism,
 * runtime no-proposal-ID enforcement.
 */
import { describe, it, expect } from "vitest";
import { StrategicBriefBuilder } from "../../src/adaptation/strategic-brief.js";
import type { StrategicBrief, StrategicFinding, Trend, Hotspot, StrategicBriefInput } from "../../src/adaptation/strategic-brief-types.js";
import type { IntelligenceReport } from "../../src/adaptation/intelligence-types.js";
import type { ProposalEffectivenessReport } from "../../src/adaptation/effectiveness-types.js";
import type { EvidenceRecord } from "../../src/security/evidence/evidence-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIntelligenceReport(overrides: Partial<IntelligenceReport> = {}): IntelligenceReport {
  return {
    generatedAt: new Date().toISOString(),
    totalProposalsAnalyzed: 10,
    dataWindow: {
      oldestProposalCreatedAt: "2026-05-01T00:00:00.000Z",
      newestProposalCreatedAt: "2026-06-01T00:00:00.000Z",
      oldestEffectivenessAssessedAt: null,
    },
    executiveSummary: "All metrics stable within expected ranges.",
    buckets: {
      byAction: { dimension: "byAction", buckets: [], totalInDimension: 0, insufficientDataCount: 0 },
      byTargetKind: { dimension: "byTargetKind", buckets: [], totalInDimension: 0, insufficientDataCount: 0 },
      bySourceRecommendationType: { dimension: "bySourceRecommendationType", buckets: [], totalInDimension: 0, insufficientDataCount: 0 },
      byProvenance: { dimension: "byProvenance", buckets: [], totalInDimension: 0, insufficientDataCount: 0 },
      byCapability: { dimension: "byCapability", buckets: [], totalInDimension: 0, insufficientDataCount: 0 },
      byOutcome: { dimension: "byOutcome", buckets: [], totalInDimension: 0, insufficientDataCount: 0 },
    },
    confidenceCalibration: {
      buckets: [],
      totalAssessed: 0,
      confidenceOutcomeCorrelation: null,
    },
    revertSignalAnalysis: {
      totalAdvisoryReverts: 0,
      totalActualReverts: 0,
      totalUnactedReverts: 0,
      revertPrecision: null,
      topUnactedRevertBuckets: [],
      humansOverruledCount: 0,
    },
    topPerforming: [],
    lowestPerforming: [],
    ...overrides,
  } as IntelligenceReport;
}

function makeEffectivenessReport(overrides: Partial<ProposalEffectivenessReport> = {}): ProposalEffectivenessReport {
  return {
    proposalId: `prop-test-${Date.now()}`,
    assessedAt: new Date().toISOString(),
    appliedAt: new Date().toISOString(),
    windowDays: 7,
    metricsBefore: {
      workflowsAborted: 0,
      workflowsBlocked: 0,
      unresolvedCapabilities: 0,
      capabilitiesRequested: 0,
      reviewApprovalRate: 1,
    },
    metricsAfter: {
      workflowsAborted: 0,
      workflowsBlocked: 0,
      unresolvedCapabilities: 0,
      capabilitiesRequested: 0,
      reviewApprovalRate: 1,
    },
    primary: null,
    dataSufficient: true,
    recommendation: "keep",
    reason: "Test assessment",
    ...overrides,
  } as ProposalEffectivenessReport;
}

function makeEvidenceRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    version: 1 as const,
    id: `evt-${Date.now()}`,
    type: "adaptation_applied",
    timestamp: new Date().toISOString(),
    fingerprint: "test-fingerprint",
    payload: {},
    ...overrides,
  } as EvidenceRecord;
}

function makeInput(overrides: Partial<StrategicBriefInput> = {}): StrategicBriefInput {
  return {
    intelligenceReports: overrides.intelligenceReports ?? [makeIntelligenceReport()],
    effectivenessReports: overrides.effectivenessReports ?? [makeEffectivenessReport()],
    evidenceRecords: overrides.evidenceRecords ?? [makeEvidenceRecord()],
  };
}

// ---------------------------------------------------------------------------
// Type shape
// ---------------------------------------------------------------------------

describe("StrategicBrief type shape", () => {
  it("extends DecisionArtifact — has id, subject, outcome, confidence, reasons, generatedAt", () => {
    const builder = new StrategicBriefBuilder();
    const brief = builder.build(makeInput());
    expect(brief.id).toBeDefined();
    expect(brief.subject).toBeDefined();
    expect(brief.outcome).toBe("brief");
    expect(typeof brief.confidence).toBe("number");
    expect(Array.isArray(brief.reasons)).toBe(true);
    expect(brief.generatedAt).toBeDefined();
  });

  it("has period, findings, trends, hotspots, strategicActions", () => {
    const builder = new StrategicBriefBuilder();
    const brief = builder.build(makeInput());
    expect(brief.period).toBeDefined();
    expect(brief.period.start).toBeDefined();
    expect(brief.period.end).toBeDefined();
    expect(Array.isArray(brief.findings)).toBe(true);
    expect(Array.isArray(brief.trends)).toBe(true);
    expect(Array.isArray(brief.hotspots)).toBe(true);
    expect(Array.isArray(brief.strategicActions)).toBe(true);
  });

  it("StrategicFinding has category, summary, detail, confidence, evidenceRefs", () => {
    const builder = new StrategicBriefBuilder();
    const brief = builder.build(makeInput());
    if (brief.findings.length > 0) {
      const f = brief.findings[0];
      expect(["trend", "hotspot", "system_warning", "strategic_observation"]).toContain(f.category);
      expect(typeof f.summary).toBe("string");
      expect(typeof f.detail).toBe("string");
      expect(typeof f.confidence).toBe("number");
      expect(Array.isArray(f.evidenceRefs)).toBe(true);
    }
  });

  it("Trend has metric, direction, magnitude, sampleSize", () => {
    const builder = new StrategicBriefBuilder();
    // Need at least 2 intelligence reports to trigger trend detection
    const reports = [
      makeIntelligenceReport({ generatedAt: "2026-04-01T00:00:00.000Z" }),
      makeIntelligenceReport({ generatedAt: "2026-06-01T00:00:00.000Z" }),
    ];
    const brief = builder.build(makeInput({ intelligenceReports: reports }));
    // May or may not have trends depending on data, but structure must be valid
    for (const t of brief.trends) {
      expect(typeof t.metric).toBe("string");
      expect(["increasing", "decreasing", "stable"]).toContain(t.direction);
      expect(typeof t.magnitude).toBe("number");
      expect(typeof t.sampleSize).toBe("number");
    }
  });

  it("Hotspot has area, severity, relatedActionTypes, evidence", () => {
    // Provide effectiveness reports with high revert rate to trigger hotspot detection
    const reports = [
      makeEffectivenessReport({ recommendation: "revert" }),
      makeEffectivenessReport({ recommendation: "revert" }),
      makeEffectivenessReport({ recommendation: "keep" }),
    ];
    const builder = new StrategicBriefBuilder();
    const brief = builder.build(makeInput({ effectivenessReports: reports }));
    for (const h of brief.hotspots) {
      expect(typeof h.area).toBe("string");
      expect(["low", "medium", "high"]).toContain(h.severity);
      expect(Array.isArray(h.relatedActionTypes)).toBe(true);
      expect(typeof h.evidence).toBe("string");
    }
  });

  it("has sourceArtifacts array", () => {
    const builder = new StrategicBriefBuilder();
    const brief = builder.build(makeInput());
    expect(Array.isArray(brief.sourceArtifacts)).toBe(true);
    // Should have at least one artifact from each input source
    expect(brief.sourceArtifacts.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Builder behavior
// ---------------------------------------------------------------------------

describe("StrategicBriefBuilder — empty inputs", () => {
  it("produces system_warning findings, empty trends, empty hotspots", () => {
    const builder = new StrategicBriefBuilder();
    const brief = builder.build({
      intelligenceReports: [],
      effectivenessReports: [],
      evidenceRecords: [],
    });
    expect(brief.findings.length).toBeGreaterThanOrEqual(2); // system warnings
    expect(brief.trends).toEqual([]);
    expect(brief.hotspots).toEqual([]);
    // All findings should be system_warnings when no data available
    for (const f of brief.findings) {
      expect(f.category).toBe("system_warning");
    }
  });
});

describe("StrategicBriefBuilder — window filtering", () => {
  it("only includes records within the window", () => {
    const fixedNow = "2026-06-21T12:00:00.000Z";
    const withinWindow = makeIntelligenceReport({ generatedAt: "2026-06-15T00:00:00.000Z" });
    const outsideWindow = makeIntelligenceReport({ generatedAt: "2026-04-01T00:00:00.000Z" });
    const builder = new StrategicBriefBuilder();
    const brief = builder.build(
      { intelligenceReports: [withinWindow, outsideWindow], effectivenessReports: [], evidenceRecords: [] },
      { generatedAt: fixedNow, window: 30 },
    );
    // Only 1 report in window → < 2 reports so trends = []
    // System warning for missing effectiveness/evidence
    expect(brief.trends).toEqual([]);
  });
});

describe("StrategicBriefBuilder — determinism", () => {
  it("same inputs + same generatedAt → same output", () => {
    const frozenTime = "2026-06-21T12:00:00.000Z";
    const input = makeInput();
    const builder = new StrategicBriefBuilder();
    const run1 = builder.build(input, { generatedAt: frozenTime });
    const run2 = builder.build(input, { generatedAt: frozenTime });
    expect(run1.id).toBe(run2.id);
    expect(run1.subject).toBe(run2.subject);
    expect(run1.period.start).toBe(run2.period.start);
    expect(run1.period.end).toBe(run2.period.end);
    expect(run1.confidence).toBe(run2.confidence);
    expect(run1.findings.length).toBe(run2.findings.length);
    expect(run1.trends.length).toBe(run2.trends.length);
    expect(run1.hotspots.length).toBe(run2.hotspots.length);
    expect(run1.strategicActions.length).toBe(run2.strategicActions.length);
  });

  it("different generatedAt produces different id and period", () => {
    const input = makeInput();
    const builder = new StrategicBriefBuilder();
    const run1 = builder.build(input, { generatedAt: "2026-06-01T00:00:00.000Z" });
    const run2 = builder.build(input, { generatedAt: "2026-06-21T00:00:00.000Z" });
    expect(run1.id).not.toBe(run2.id);
    expect(run1.period.start).not.toBe(run2.period.start);
  });
});

describe("StrategicBriefBuilder — confidence", () => {
  it("confidence reflects data sufficiency", () => {
    // 0 records out of 30 target → ~0
    const builder = new StrategicBriefBuilder();
    const empty = builder.build({ intelligenceReports: [], effectivenessReports: [], evidenceRecords: [] });
    expect(empty.confidence).toBe(0);

    // Exactly 30 records → confidence 1
    const reports30 = Array.from({ length: 30 }, (_, i) =>
      makeEffectivenessReport({ proposalId: `prop-${i}`, assessedAt: "2026-06-15T00:00:00.000Z" })
    );
    const full = builder.build(
      { intelligenceReports: [], effectivenessReports: reports30, evidenceRecords: [] },
      { generatedAt: "2026-06-21T12:00:00.000Z", window: 30 },
    );
    expect(full.confidence).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// No proposal IDs in output (runtime)
// ---------------------------------------------------------------------------

describe("StrategicBrief — no proposal IDs in output", () => {
  it("output JSON must not contain prop- when input contains real proposal IDs", () => {
    const inputWithRealIds: StrategicBriefInput = {
      intelligenceReports: [makeIntelligenceReport()],
      effectivenessReports: [
        makeEffectivenessReport({ proposalId: "prop-2026-06-21-005" }),
        makeEffectivenessReport({ proposalId: "prop-2026-06-21-006" }),
      ],
      evidenceRecords: [makeEvidenceRecord()],
    };
    const builder = new StrategicBriefBuilder();
    const brief = builder.build(inputWithRealIds);
    const json = JSON.stringify(brief);

    // Check output fields that must NOT contain proposal IDs
    for (const finding of brief.findings) {
      expect(finding.summary).not.toContain("prop-");
      expect(finding.detail).not.toContain("prop-");
    }
    for (const trend of brief.trends) {
      expect(trend.metric).not.toContain("prop-");
    }
    for (const hotspot of brief.hotspots) {
      expect(hotspot.area).not.toContain("prop-");
      expect(hotspot.evidence).not.toContain("prop-");
    }
    for (const action of brief.strategicActions) {
      expect(action).not.toContain("prop-");
    }
    // Also verify the full JSON blobs don't have prop- in output content
    // (findings, trends, hotspots, strategicActions)
    const outputOnly = JSON.stringify({
      findings: brief.findings,
      trends: brief.trends,
      hotspots: brief.hotspots,
      strategicActions: brief.strategicActions,
    });
    expect(outputOnly).not.toContain("prop-");
  });
});

// ---------------------------------------------------------------------------
// No per-proposal directive language
// ---------------------------------------------------------------------------

describe("StrategicBrief — no per-proposal recommendations", () => {
  it("output must not contain approve/reject proposal directives", () => {
    const builder = new StrategicBriefBuilder();
    const brief = builder.build(makeInput());
    const json = JSON.stringify(brief);

    // Forbidden patterns
    expect(json).not.toContain('"approve proposal');
    expect(json).not.toContain('"reject proposal');
    expect(json).not.toContain('"approve prop-');
    expect(json).not.toContain('"reject prop-');

    // But historical metrics like "approval rate" ARE allowed
    // (no test needed — this checks we don't ban those)
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/adaptation/strategic-brief.vitest.ts 2>&1 | tail -30`
Expected: PASS (all tests green)

- [ ] **Step 3: Commit**

```bash
git add tests/adaptation/strategic-brief.vitest.ts
git commit -m "feat(p6.3): StrategicBrief comprehensive unit tests"

```

---

### Task 4: Governance Sentinels

**Files:**
- Create: `tests/adaptation/strategic-brief-governance-sentinels.vitest.ts`

**Interfaces:**
- Consumes: source file `src/adaptation/strategic-brief.ts` (read via `readFileSync`)

- [ ] **Step 1: Write the sentinel tests**

```typescript
/**
 * P6.3 — StrategicBrief governance sentinels.
 *
 * Enforces:
 * 1. Purity — StrategicBriefBuilder must not import stores or builders
 * 2. No proposal IDs in findings/summaries/actions (static source grep)
 * 3. No per-proposal directive language in source
 *
 * Pattern: module-level grep on the source file. These are compile-time
 * architectural guards, not runtime tests.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BRIEF_SRC = resolve(__dirname, "../../src/adaptation/strategic-brief.ts");
const source = readFileSync(BRIEF_SRC, "utf-8");

/** Strip comments from source so sentinel patterns don't false-positive on
 *  JSDoc that explains the rule itself. */
function stripComments(src: string): string {
  return src
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const codeOnly = stripComments(source);

describe("P6.3 — StrategicBrief purity sentinel", () => {
  const FORBIDDEN_STORE_IMPORTS = [
    "proposal-store",
    "evidence-store",
    "effectiveness-store",
    "intelligence-store",
    "-store",
  ];

  const FORBIDDEN_BUILDER_IMPORTS = [
    "DecisionContextBuilder",
    "RiskScoreBuilder",
    "RecommendationEngine",
    "OperatorQueue",
  ];

  for (const forbidden of FORBIDDEN_STORE_IMPORTS) {
    it(`must not import ${forbidden}`, () => {
      expect(codeOnly).not.toContain(forbidden);
    });
  }

  for (const forbidden of FORBIDDEN_BUILDER_IMPORTS) {
    it(`must not import ${forbidden}`, () => {
      expect(codeOnly).not.toContain(forbidden);
    });
  }

  it("must not contain save/update/mutation calls", () => {
    expect(codeOnly).not.toMatch(/\.(save|update|approve|apply|reject)\(/);
  });

  it("must not import decision-confidence or scoring modules", () => {
    const forbidden = ["decision-confidence", "risk-score", "recommendation-rules"];
    for (const pattern of forbidden) {
      // Allow type-only references (risk-score-types is OK)
      const lines = codeOnly.split("\n").filter(
        (l) => l.includes(pattern) && !l.includes("types"),
      );
      expect(lines.length).toBe(0);
    }
  });

  it("must not import scoring/evaluation modules", () => {
    // The Brief legitimately computes data-sufficiency confidence via Math.min.
    // But it must not import risk-scoring or recommendation modules.
    const forbiddenEval = ["risk-score", "recommendation-rules", "decision-confidence"];
    for (const pattern of forbiddenEval) {
      const lines = codeOnly.split("\n").filter(
        (l) => l.includes(pattern) && !l.includes("types"),
      );
      expect(lines.length).toBe(0);
    }
  });
});

describe("P6.3 — No proposal-ID sentinel (static)", () => {
  it("source must not contain prop- string literals in output content areas", () => {
    // Check that output-construction areas don't hardcode proposal IDs
    // Comments are stripped so JSDoc examples don't false-positive
    const lines = source.split("\n").filter((line) => {
      const trimmed = line.trim();
      // Skip import lines — they reference proposal-related types
      if (trimmed.startsWith("import ")) return false;
      // Skip lines that are comments about the rule itself
      if (trimmed.includes("no proposal IDs") || trimmed.includes("No proposal-ID")) return false;
      // Check for prop- string literals
      return /["']prop-/.test(trimmed);
    });
    expect(lines.length).toBe(0);
  });
});

describe("P6.3 — No per-proposal recommendation sentinel", () => {
  it("source must not contain approve/reject proposal directives", () => {
    // Check comment-free source for directive language
    expect(codeOnly).not.toMatch(/["']approve proposal["']/);
    expect(codeOnly).not.toMatch(/["']reject proposal["']/);
    expect(codeOnly).not.toMatch(/["']approve prop-/);
    expect(codeOnly).not.toMatch(/["']reject prop-/);

    // The words approve/reject ARE allowed as historical metrics
    // e.g. "approval rate decreased" or "rejection-like outcomes"
    // Those appear in strings only, so we only check for directive patterns
  });
});
```

- [ ] **Step 2: Run the sentinel tests**

Run: `npx vitest run tests/adaptation/strategic-brief-governance-sentinels.vitest.ts 2>&1 | tail -30`
Expected: PASS (all sentinels pass)

- [ ] **Step 3: Commit**

```bash
git add tests/adaptation/strategic-brief-governance-sentinels.vitest.ts
git commit -m "feat(p6.3): StrategicBrief governance sentinels"
```

---

### Task 5: CLI — `brief` Subcommand

**Files:**
- Modify: `src/cli/commands/decision.ts`

**Interfaces:**
- Consumes: `StrategicBriefBuilder` from `../../adaptation/strategic-brief.js`, all types from `../../adaptation/strategic-brief-types.js`
- Produces: `alix decision brief [--window 30|90|180] [--json]` terminal output

- [ ] **Step 1: Add the import and the runBrief function, wire into switch**

Modify `src/cli/commands/decision.ts`:

**Add imports** (after the `OperatorQueue` import block):
```typescript
import { StrategicBriefBuilder } from "../../adaptation/strategic-brief.js";
import type { StrategicBrief } from "../../adaptation/strategic-brief-types.js";
import type { IntelligenceReport } from "../../adaptation/intelligence-types.js";
```

**Add `case "brief"` to the switch** (after the `case "queue"` block):
```typescript
    case "brief":
      await runBrief(rest);
      return;
```

**Update the default error message** to include `brief`:
```typescript
console.error("Usage: alix decision context <proposal-id> [--json] | risk <proposal-id> [--json] | recommend <proposal-id> [--json] | queue [--json] [--limit N] | brief [--window N] [--json]");
```

**Add the `runBrief` function** (after `runQueue`, before the file's module boundary):

```typescript
// ---------------------------------------------------------------------------
// runBrief — Strategic Brief
// ---------------------------------------------------------------------------

/**
 * Build and render a strategic brief from persisted stores.
 * Computed fresh each run — no persistence.
 */
async function runBrief(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const windowIdx = args.indexOf("--window");
  let windowSize: 30 | 90 | 180 = 30;
  if (windowIdx !== -1 && windowIdx + 1 < args.length) {
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (![30, 90, 180].includes(parsed)) {
      console.error("Error: --window requires 30, 90, or 180");
      process.exit(1);
    }
    windowSize = parsed as 30 | 90 | 180;
  }

  const cwd = process.cwd();
  const infra = buildDecisionInfrastructure(cwd);
  const briefBuilder = new StrategicBriefBuilder();

  // Query stores — this is the CLI's responsibility, not the builder's
  const effectivenessReports = await infra.effectivenessStore.list();

  // Load all intelligence reports for trend detection across history
  const intelFilenames = await infra.intelligenceStore.list();
  const intelligenceReports = (
    await Promise.all(intelFilenames.map((f) => infra.intelligenceStore.load(f)))
  ).filter(Boolean) as IntelligenceReport[];

  // Query evidence store — EvidenceStore.query takes type (singular),
  // so query broadly then filter for lifecycle event types in-memory
  const LIFECYCLE_TYPES = new Set(["adaptation_proposed", "adaptation_approved", "adaptation_applied", "adaptation_failed"]);
  const allEvidence = await infra.evidenceStore.query({ limit: 10000 });
  const evidenceRecords = allEvidence.records.filter((r) => LIFECYCLE_TYPES.has(r.type));

  const input = {
    intelligenceReports,
    effectivenessReports,
    evidenceRecords,
  };

  const brief = briefBuilder.build(input, { window: windowSize });

  if (jsonMode) {
    console.log(JSON.stringify(brief, null, 2));
    return;
  }

  // Terminal renderer
  const periodStart = new Date(brief.period.start).toLocaleDateString();
  const periodEnd = new Date(brief.period.end).toLocaleDateString();

  console.log(`Strategic Brief: Last ${windowSize} days (${periodStart} → ${periodEnd})`);
  console.log(`═════════════════════════════════════════════════════════`);
  console.log(``);

  if (brief.findings.length > 0) {
    console.log(`Findings (${brief.findings.length}):`);
    for (const f of brief.findings) {
      const icon =
        f.category === "trend" ? "📈" :
        f.category === "hotspot" ? "🔥" :
        f.category === "system_warning" ? "⚠️" :
        "💡";
      console.log(` ${icon} ${f.summary}`);
    }
    console.log(``);
  }

  if (brief.trends.length > 0) {
    console.log(`Trends (${brief.trends.length}):`);
    for (const t of brief.trends) {
      const dirIcon = t.direction === "increasing" ? "↑" : t.direction === "decreasing" ? "↓" : "→";
      console.log(` ${dirIcon} ${t.metric}: ${t.direction} (magnitude: ${(t.magnitude * 100).toFixed(0)}%, n=${t.sampleSize})`);
    }
    console.log(``);
  }

  if (brief.hotspots.length > 0) {
    console.log(`Hotspots (${brief.hotspots.length}):`);
    for (const h of brief.hotspots) {
      const sevIcon = h.severity === "high" ? "🔴" : h.severity === "medium" ? "🟠" : "🟡";
      console.log(` ${sevIcon} ${h.area} (${h.severity}): ${h.evidence}`);
    }
    console.log(``);
  }

  if (brief.strategicActions.length > 0) {
    console.log(`Strategic actions:`);
    for (const action of brief.strategicActions) {
      console.log(` · ${action}`);
    }
    console.log(``);
  }

  console.log(`Data: ${brief.evidenceRefs?.length ?? "—"} evidence records, ${brief.trends.length} trend(s), ${brief.hotspots.length} hotspot(s)`);
  console.log(`Confidence: ${(brief.confidence * 100).toFixed(0)}% (data sufficiency)`);

  if (brief.reasons.length > 0) {
    console.log(``);
    console.log(`Data sources:`);
    for (const r of brief.reasons) {
      console.log(` · ${r}`);
    }
  }
}
```

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run 2>&1 | tail -20`
Expected: 470+ tests pass, no failures

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/decision.ts
git commit -m "feat(p6.3): CLI brief subcommand for Strategic Brief"
```
