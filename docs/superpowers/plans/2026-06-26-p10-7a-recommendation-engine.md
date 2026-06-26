# P10.7a — Recommendation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `alix executive recommend [--window N] [--json]` — a read-only CLI that turns P10.6 learning trends into actionable per-subsystem recommendations (signal + severity + confidence + advice).

**Architecture:** A pure function `computeRecommendations(trends, reports?, generatedAt?)` reads an already-computed `TrendResult` (from P10.6's `computeLearningTrends`), classifies each subsystem trend into at most one recommendation signal, rounds confidence to two decimals, sorts deterministically, and returns a `RecommendationResult`. A thin CLI handler owns store I/O, composes the existing P10.6 pipeline, and renders terminal/JSON. No mutation, no proposals, no engine hooks.

**Tech Stack:** TypeScript, Node.js `fs` (CLI handler only), vitest, existing `OutcomeReportStore` and `computeLearningTrends`.

**Spec:** `docs/superpowers/specs/2026-06-26-p10-7a-recommendation-engine-design.md`

## Global Constraints

| Constraint | Value |
|---|---|
| No mutation of any store | Read-only — `OutcomeReportStore.list()` and `.load()` only |
| No proposal creation | Recommendations are advisory drafts only |
| No evidence types | None added |
| No engine hooks | ExecutionEngine untouched |
| No protected type files (ADR-0004) | All new files |
| Function purity | `computeRecommendations` is pure — no disk, no side effects, deterministic given inputs |
| Confidence | Rounded to two decimals (`round2`) before placement on the draft; bounded 0–1 |
| Precedence | `low_confidence` → `degrading_trend` → `persistent_instability` → `improving_trend` → no draft. A subsystem matches at most one signal. |
| Sort | `confidence desc` → `|averageDelta| desc` → `subsystem asc` |
| Deterministic time | `generatedAt` is injectable (third param, defaults to `new Date().toISOString()`) |
| Status passthrough | When `trends.trendStatus === "insufficient_data"`, returns `recommendationStatus: "insufficient_data"` with empty recommendations |
| CLI path | `alix executive recommend [--window N] [--json]` |
| Window default | 10 |
| `--include-stable` | NOT implemented in P10.7a (no flag, no tests) — stable subsystems produce no draft |
| `reports?` param | Reserved for P10.7b evidence enrichment; declared in signature, NOT referenced in body (no `noUnusedParameters`, so this compiles) |

---

---

### Task 0: Branch + docs

- [ ] Create the feature branch from `main`

```bash
git checkout main
git pull
git checkout -b feature/p10-7a-recommendation-engine
```

- [ ] Cherry-pick / carry forward the spec and this plan onto the branch

The spec (`docs/superpowers/specs/2026-06-26-p10-7a-recommendation-engine-design.md`) and this plan must exist on the branch. If they were committed on a different branch, copy them onto this branch and commit:

```bash
git add docs/superpowers/specs/2026-06-26-p10-7a-recommendation-engine-design.md
git add docs/superpowers/plans/2026-06-26-p10-7a-recommendation-engine.md
git commit -m "docs(p10-7a): add spec + implementation plan"
```

---

### Task 1: `recommendation-engine.ts` — pure function + types + unit tests

**Files:**
- Create: `src/executive/recommendation-engine.ts`
- Create: `tests/executive/recommendation-engine.vitest.ts`

**Interfaces:**
- Consumes: `TrendResult`, `SubsystemTrend` from `./learning-engine.js` (no changes); `ExecutiveOutcomeEvaluationReport` from `./outcome-evaluator.js` (no changes)
- Produces: `RecommendationSignal`, `RecommendationSeverity`, `RecommendationDraft`, `RecommendationResult`, `RECOMMENDATION_OK`, `RECOMMENDATION_INSUFFICIENT_DATA`, `computeRecommendations()` — all in `recommendation-engine.ts`

**Confidence formulas (verbatim from spec):**

| Signal | Confidence |
|---|---|
| `degrading_trend` | `round2(min(0.95, abs(avgDelta) * 0.15 + degradationRate * 0.4 + min(occurrenceCount/10, 0.2)))` |
| `improving_trend` | `round2(min(0.95, avgDelta * 0.1 + successRate * 0.4 + min(occurrenceCount/10, 0.2)))` |
| `persistent_instability` | `round2(min(0.9, mixedRate * 0.5 + min(occurrenceCount/10, 0.3)))` |
| `low_confidence` | `round2(min(0.3, occurrenceCount * 0.1))` |

**Severity rule:** `degrading_trend` is `high` when `avgDelta < -3`, else `medium`.

**Precedence:** `low_confidence` (occurrenceCount ≤ 2) → `degrading_trend` → `persistent_instability` → `improving_trend` → no draft.

- [ ] **Step 1: Write the failing test file**

`tests/executive/recommendation-engine.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  computeRecommendations,
  RECOMMENDATION_OK,
  RECOMMENDATION_INSUFFICIENT_DATA,
} from "../../src/executive/recommendation-engine.js";
import type { TrendResult } from "../../src/executive/learning-engine.js";

const GENERATED_AT = "2026-01-01T00:00:00.000Z";

/** Build a TrendResult with arbitrary subsystem trends (defaults to a clean ok result). */
function makeTrends(over: Partial<TrendResult> = {}): TrendResult {
  return {
    trendStatus: "ok",
    generatedAt: GENERATED_AT,
    requestedWindow: 10,
    inputReportCount: 8,
    analyzedReportCount: 8,
    skippedReportCount: 0,
    totalImproved: 0,
    totalMixed: 0,
    totalDegraded: 8,
    totalUnchanged: 0,
    subsystemTrends: [],
    objectiveTrends: [],
    warnings: [],
    loadWarnings: [],
    ...over,
  };
}

describe("computeRecommendations — signal detection", () => {
  it("classifies a degrading subsystem as degrading_trend high severity", () => {
    const trends = makeTrends({
      subsystemTrends: [{
        subsystem: "workflow",
        occurrenceCount: 8,
        successRate: 0,
        mixedRate: 0,
        degradationRate: 0.5,
        unchangedRate: 0,
        averageDelta: -3.2,
      }],
    });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    expect(result.recommendationStatus).toBe(RECOMMENDATION_OK);
    expect(result.subsystemRecommendations).toHaveLength(1);
    expect(result.subsystemRecommendations[0]).toEqual({
      subsystem: "workflow",
      signal: "degrading_trend",
      severity: "high",
      recommendation: "Investigate workflow regressions",
      // min(0.95, 3.2*0.15 + 0.5*0.4 + min(0.8,0.2)) = min(0.95, 0.48+0.2+0.2) = 0.88
      confidence: 0.88,
      occurrenceCount: 8,
      averageDelta: -3.2,
    });
  });

  it("classifies degrading_trend as medium severity when avgDelta >= -3", () => {
    const trends = makeTrends({
      subsystemTrends: [{
        subsystem: "routing",
        occurrenceCount: 5,
        successRate: 0,
        mixedRate: 0,
        degradationRate: 0.4,
        unchangedRate: 0,
        averageDelta: -2.0,
      }],
    });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    const rec = result.subsystemRecommendations[0];
    expect(rec.signal).toBe("degrading_trend");
    expect(rec.severity).toBe("medium");
    expect(rec.recommendation).toBe("Monitor routing for continued degradation");
    // min(0.95, 2.0*0.15 + 0.4*0.4 + min(0.5,0.2)) = min(0.95, 0.3+0.16+0.2) = 0.66
    expect(rec.confidence).toBe(0.66);
  });

  it("classifies an improving subsystem as improving_trend info severity", () => {
    const trends = makeTrends({
      subsystemTrends: [{
        subsystem: "memory_cache",
        occurrenceCount: 4,
        successRate: 0.6,
        mixedRate: 0,
        degradationRate: 0,
        unchangedRate: 0.4,
        averageDelta: 2.5,
      }],
    });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    const rec = result.subsystemRecommendations[0];
    expect(rec.signal).toBe("improving_trend");
    expect(rec.severity).toBe("info");
    expect(rec.recommendation).toBe("Continue current memory_cache optimizations");
    // min(0.95, 2.5*0.1 + 0.6*0.4 + min(0.4,0.2)) = min(0.95, 0.25+0.24+0.2) = 0.69
    expect(rec.confidence).toBe(0.69);
  });

  it("classifies a mixed-dominant subsystem as persistent_instability", () => {
    const trends = makeTrends({
      subsystemTrends: [{
        subsystem: "routing",
        occurrenceCount: 5,
        successRate: 0.2,
        mixedRate: 0.5,
        degradationRate: 0.1,
        unchangedRate: 0.2,
        averageDelta: -0.8,
      }],
    });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    const rec = result.subsystemRecommendations[0];
    expect(rec.signal).toBe("persistent_instability");
    expect(rec.severity).toBe("medium");
    expect(rec.recommendation).toBe("Review routing for stability improvements");
    // min(0.9, 0.5*0.5 + min(0.5,0.3)) = min(0.9, 0.25+0.3) = 0.55
    expect(rec.confidence).toBe(0.55);
  });

  it("classifies a low-occurrence subsystem as low_confidence", () => {
    const trends = makeTrends({
      subsystemTrends: [{
        subsystem: "anomaly_detector",
        occurrenceCount: 1,
        successRate: 0,
        mixedRate: 0,
        degradationRate: 1,
        unchangedRate: 0,
        averageDelta: -1.0,
      }],
    });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    const rec = result.subsystemRecommendations[0];
    expect(rec.signal).toBe("low_confidence");
    expect(rec.severity).toBe("low");
    expect(rec.recommendation).toBe("Collect more data on anomaly_detector before acting");
    // min(0.3, 1*0.1) = 0.1
    expect(rec.confidence).toBe(0.1);
  });
});

describe("computeRecommendations — precedence", () => {
  it("low_confidence wins over degrading_trend when occurrenceCount <= 2", () => {
    // occurrenceCount 2, but avgDelta -5 and degradationRate 0.9 would otherwise be degrading high.
    const trends = makeTrends({
      subsystemTrends: [{
        subsystem: "workflow",
        occurrenceCount: 2,
        successRate: 0,
        mixedRate: 0,
        degradationRate: 0.9,
        unchangedRate: 0,
        averageDelta: -5,
      }],
    });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    const rec = result.subsystemRecommendations[0];
    expect(rec.signal).toBe("low_confidence");
    expect(rec.severity).toBe("low");
    // min(0.3, 2*0.1) = 0.2
    expect(rec.confidence).toBe(0.2);
  });
});

describe("computeRecommendations — status & empties", () => {
  it("passes through insufficient_data from trends with empty recommendations", () => {
    const trends = makeTrends({ trendStatus: "insufficient_data", analyzedReportCount: 0 });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    expect(result.recommendationStatus).toBe(RECOMMENDATION_INSUFFICIENT_DATA);
    expect(result.subsystemRecommendations).toEqual([]);
  });

  it("returns ok with empty recommendations when no subsystem crosses a threshold", () => {
    const trends = makeTrends({
      subsystemTrends: [{
        subsystem: "stable_thing",
        occurrenceCount: 5,
        successRate: 0.2,
        mixedRate: 0.1,
        degradationRate: 0.1,
        unchangedRate: 0.6,
        averageDelta: 0,
      }],
    });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    expect(result.recommendationStatus).toBe(RECOMMENDATION_OK);
    expect(result.subsystemRecommendations).toEqual([]);
  });

  it("carries loadWarnings through from trends", () => {
    const trends = makeTrends({ loadWarnings: ["could not load outcome-xyz.json"] });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    expect(result.loadWarnings).toEqual(["could not load outcome-xyz.json"]);
  });
});

describe("computeRecommendations — sorting", () => {
  it("sorts by confidence desc, then |averageDelta| desc, then subsystem asc", () => {
    // Three low_confidence subsystems (all confidence 0.1) to exercise both tiebreaks:
    //   beta:  |delta| 5.0  -> first
    //   alpha: |delta| 2.0
    //   gamma: |delta| 2.0  -> alpha before gamma by subsystem asc
    const trends = makeTrends({
      subsystemTrends: [
        { subsystem: "alpha", occurrenceCount: 1, successRate: 0, mixedRate: 0, degradationRate: 1, unchangedRate: 0, averageDelta: -2 },
        { subsystem: "beta",  occurrenceCount: 1, successRate: 0, mixedRate: 0, degradationRate: 1, unchangedRate: 0, averageDelta: -5 },
        { subsystem: "gamma", occurrenceCount: 1, successRate: 0, mixedRate: 0, degradationRate: 1, unchangedRate: 0, averageDelta: -2 },
      ],
    });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    expect(result.subsystemRecommendations.map(r => r.subsystem)).toEqual(["beta", "alpha", "gamma"]);
  });

  it("sorts distinct confidences descending", () => {
    const trends = makeTrends({
      subsystemTrends: [
        { subsystem: "c", occurrenceCount: 5, successRate: 0.2, mixedRate: 0.5, degradationRate: 0.1, unchangedRate: 0.2, averageDelta: -0.8 }, // 0.55
        { subsystem: "a", occurrenceCount: 8, successRate: 0, mixedRate: 0, degradationRate: 0.5, unchangedRate: 0, averageDelta: -3.2 },        // 0.88
        { subsystem: "b", occurrenceCount: 4, successRate: 0.6, mixedRate: 0, degradationRate: 0, unchangedRate: 0.4, averageDelta: 2.5 },        // 0.69
      ],
    });
    const result = computeRecommendations(trends, undefined, GENERATED_AT);
    expect(result.subsystemRecommendations.map(r => r.confidence)).toEqual([0.88, 0.69, 0.55]);
  });
});

describe("computeRecommendations — determinism", () => {
  it("uses the injected generatedAt", () => {
    const result = computeRecommendations(makeTrends(), undefined, "2026-09-09T01:02:03.000Z");
    expect(result.generatedAt).toBe("2026-09-09T01:02:03.000Z");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/executive/recommendation-engine.vitest.ts`
Expected: FAIL — `computeRecommendations` is not defined (module does not exist yet).

- [ ] **Step 3: Write the implementation**

`src/executive/recommendation-engine.ts`:

```ts
/**
 * P10.7a — Recommendation Engine.
 *
 * Pure function that turns a P10.6 TrendResult into actionable per-subsystem
 * recommendation drafts. Detects a small set of signals (degrading, improving,
 * persistent instability, low confidence) via lightweight heuristics, assigns a
 * severity and a bounded, two-decimal confidence, and returns them sorted.
 *
 * Read-only and side-effect-free: no disk, no proposals, no engine hooks.
 *
 * @module
 */

import type { TrendResult, SubsystemTrend } from "./learning-engine.js";
import type { ExecutiveOutcomeEvaluationReport } from "./outcome-evaluator.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RecommendationSignal =
  | "degrading_trend"
  | "persistent_instability"
  | "improving_trend"
  | "low_confidence";

export type RecommendationSeverity = "info" | "low" | "medium" | "high";

export interface RecommendationDraft {
  subsystem: string;
  signal: RecommendationSignal;
  severity: RecommendationSeverity;
  recommendation: string;
  confidence: number;
  occurrenceCount: number;
  averageDelta: number;
  evidenceReportIds?: string[];
}

export const RECOMMENDATION_OK = "ok";
export const RECOMMENDATION_INSUFFICIENT_DATA = "insufficient_data";

export interface RecommendationResult {
  recommendationStatus: typeof RECOMMENDATION_OK | typeof RECOMMENDATION_INSUFFICIENT_DATA;
  generatedAt: string;
  requestedWindow: number;
  inputReportCount: number;
  analyzedReportCount: number;
  skippedReportCount: number;
  subsystemRecommendations: RecommendationDraft[];
  warnings: string[];       // recommendation/analysis warnings
  loadWarnings: string[];   // corrupt or failed outcome-report loads from the CLI pipeline
}

// ---------------------------------------------------------------------------
// Threshold constants
// ---------------------------------------------------------------------------

const DELTA_DEGRADE = -1;        // averageDelta strictly less than this → degrading candidate
const DELTA_IMPROVE = 1;         // averageDelta strictly greater than this → improving candidate
const DELTA_HIGH_SEVERITY = -3;  // degrading_trend is "high" below this, else "medium"
const DEGRADATION_RATE_THRESHOLD = 0.3;
const SUCCESS_RATE_THRESHOLD = 0.5;
const MIXED_RATE_THRESHOLD = 0.4;
const LOW_CONFIDENCE_OCCURRENCE = 2;   // occurrenceCount <= this → low_confidence (precedence winner)
const INSTABILITY_MIN_OCCURRENCE = 3;  // persistent_instability requires this many occurrences

const CAP_HIGH = 0.95;   // degrading & improving confidence cap
const CAP_INSTABILITY = 0.9;
const CAP_LOW = 0.3;

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Compute actionable recommendation drafts from a P10.6 TrendResult.
 *
 * @param trends      Required. Signal detection reads subsystem trends and the
 *                    overall trend status. When `trendStatus` is
 *                    `"insufficient_data"`, the result mirrors it with empty
 *                    recommendations.
 * @param reports     Reserved for P10.7b evidence enrichment (exemplar report
 *                    IDs). Not read in P10.7a.
 * @param generatedAt Injectable timestamp for deterministic output; defaults to
 *                    `new Date().toISOString()`.
 */
export function computeRecommendations(
  trends: TrendResult,
  _reports?: ExecutiveOutcomeEvaluationReport[],
  generatedAt: string = new Date().toISOString(),
): RecommendationResult {
  const base = {
    generatedAt,
    requestedWindow: trends.requestedWindow,
    inputReportCount: trends.inputReportCount,
    analyzedReportCount: trends.analyzedReportCount,
    skippedReportCount: trends.skippedReportCount,
    loadWarnings: [...trends.loadWarnings],
    warnings: [] as string[],
  };

  if (trends.trendStatus === "insufficient_data") {
    return {
      ...base,
      recommendationStatus: RECOMMENDATION_INSUFFICIENT_DATA,
      subsystemRecommendations: [],
    };
  }

  const drafts: RecommendationDraft[] = [];
  for (const trend of trends.subsystemTrends) {
    const draft = classifySubsystem(trend);
    if (draft) drafts.push(draft);
  }

  drafts.sort(compareRecommendation);

  return {
    ...base,
    recommendationStatus: RECOMMENDATION_OK,
    subsystemRecommendations: drafts,
  };
}

// ---------------------------------------------------------------------------
// Classification (precedence: low_confidence → degrading → instability → improving → none)
// ---------------------------------------------------------------------------

function classifySubsystem(trend: SubsystemTrend): RecommendationDraft | null {
  const { subsystem, occurrenceCount, averageDelta, degradationRate, successRate, mixedRate } = trend;

  // 1. low_confidence — too little data to claim anything stronger
  if (occurrenceCount <= LOW_CONFIDENCE_OCCURRENCE) {
    return {
      subsystem,
      signal: "low_confidence",
      severity: "low",
      recommendation: `Collect more data on ${subsystem} before acting`,
      confidence: round2(Math.min(CAP_LOW, occurrenceCount * 0.1)),
      occurrenceCount,
      averageDelta,
    };
  }

  // 2. degrading_trend
  if (averageDelta < DELTA_DEGRADE && degradationRate > DEGRADATION_RATE_THRESHOLD) {
    const severity: RecommendationSeverity = averageDelta < DELTA_HIGH_SEVERITY ? "high" : "medium";
    return {
      subsystem,
      signal: "degrading_trend",
      severity,
      recommendation: severity === "high"
        ? `Investigate ${subsystem} regressions`
        : `Monitor ${subsystem} for continued degradation`,
      confidence: round2(Math.min(
        CAP_HIGH,
        Math.abs(averageDelta) * 0.15 + degradationRate * 0.4 + Math.min(occurrenceCount / 10, 0.2),
      )),
      occurrenceCount,
      averageDelta,
    };
  }

  // 3. persistent_instability
  if (mixedRate > MIXED_RATE_THRESHOLD && occurrenceCount >= INSTABILITY_MIN_OCCURRENCE) {
    return {
      subsystem,
      signal: "persistent_instability",
      severity: "medium",
      recommendation: `Review ${subsystem} for stability improvements`,
      confidence: round2(Math.min(
        CAP_INSTABILITY,
        mixedRate * 0.5 + Math.min(occurrenceCount / 10, 0.3),
      )),
      occurrenceCount,
      averageDelta,
    };
  }

  // 4. improving_trend
  if (averageDelta > DELTA_IMPROVE && successRate > SUCCESS_RATE_THRESHOLD) {
    return {
      subsystem,
      signal: "improving_trend",
      severity: "info",
      recommendation: `Continue current ${subsystem} optimizations`,
      confidence: round2(Math.min(
        CAP_HIGH,
        averageDelta * 0.1 + successRate * 0.4 + Math.min(occurrenceCount / 10, 0.2),
      )),
      occurrenceCount,
      averageDelta,
    };
  }

  // 5. no actionable signal
  return null;
}

// ---------------------------------------------------------------------------
// Sort + helpers
// ---------------------------------------------------------------------------

function compareRecommendation(a: RecommendationDraft, b: RecommendationDraft): number {
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  const aAbs = Math.abs(a.averageDelta);
  const bAbs = Math.abs(b.averageDelta);
  if (bAbs !== aAbs) return bAbs - aAbs;
  return a.subsystem.localeCompare(b.subsystem);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/executive/recommendation-engine.vitest.ts`
Expected: PASS — all 10 tests green.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/executive/recommendation-engine.ts tests/executive/recommendation-engine.vitest.ts
git commit -m "feat(p10-7a): pure recommendation engine + unit tests"
```

---

### Task 2: `executive-recommend-handler.ts` + CLI routing + integration tests

**Files:**
- Create: `src/cli/commands/executive-recommend-handler.ts`
- Modify: `src/cli/commands/executive.ts` (add `case "recommend"` + update subcommand list)
- Create: `tests/cli/commands/executive-recommend-cli.vitest.ts`

**Interfaces:**
- Consumes: `computeLearningTrends` from `../../executive/learning-engine.js`; `computeRecommendations` from `../../executive/recommendation-engine.js`; `OutcomeReportStore` from `../../executive/outcome-store.js`; `ExecutiveOutcomeEvaluationReport` type
- Produces: `handleRecommendCommand(args: string[]): Promise<void>`

**CLI flow:** `store.list()` → `store.load()` (TOCTOU try/catch, mirrors P10.6 learn handler) → `computeLearningTrends()` → `computeRecommendations()` → terminal table or JSON.

**Routing (executive.ts):** dynamic import of the handler, consistent with the P10.6 `case "learn"` block. Subcommand list gains `recommend`.

- [ ] **Step 1: Write the failing integration tests**

`tests/cli/commands/executive-recommend-cli.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleRecommendCommand } from "../../../src/cli/commands/executive-recommend-handler.js";
import { OutcomeReportStore } from "../../../src/executive/outcome-store.js";
import type { ExecutiveOutcomeEvaluationReport } from "../../../src/executive/outcome-evaluator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a) => { err.push(a.join(" ")); });
  return { out: () => out, err: () => err, restore: () => { logSpy.mockRestore(); warnSpy.mockRestore(); } };
}

/** A completed report whose single objective degraded `workflow` by 4 points. */
function makeDegradedReport(planId: string): ExecutiveOutcomeEvaluationReport {
  return {
    schemaVersion: "p10.5.0",
    generatedAt: new Date().toISOString(),
    planId,
    planStatus: "completed",
    evaluationStatus: "completed",
    evaluatedSubsystems: ["workflow"],
    objectives: [{
      objectiveId: "o1",
      objectiveType: "stabilize",
      targetSubsystems: ["workflow"],
      subsystemDeltas: [{ subsystem: "workflow", baselineScore: 60, currentScore: 50, delta: -10 }],
      aggregateDelta: -10,
      outcome: "degraded",
    }],
    overallDelta: -10,
    warnings: [],
  };
}

function makeInsufficientReport(planId: string): ExecutiveOutcomeEvaluationReport {
  return {
    schemaVersion: "p10.5.0",
    generatedAt: new Date().toISOString(),
    planId,
    planStatus: "completed",
    evaluationStatus: "insufficient_data",
    evaluatedSubsystems: ["workflow"],
    objectives: [],
    overallDelta: 0,
    warnings: [],
  };
}

let tempRoot: string;
let execDir: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "p10-7a-cli-"));
  execDir = join(tempRoot, ".alix", "executive");
  mkdirSync(join(execDir, "outcomes"), { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("executive recommend CLI", () => {
  it("renders a terminal table with at least one recommendation", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    // Two degraded reports → occurrenceCount 2 → low_confidence; add more to cross degrading.
    for (let i = 0; i < 3; i++) store.save(makeDegradedReport(`p${i}`));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "10"]);

    const out = c.out().join("\n");
    expect(out).toContain("workflow");
    expect(out).toContain("Recommendation");

    cwdSpy.mockRestore();
    c.restore();
  });

  it("outputs valid JSON with --json", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    for (let i = 0; i < 3; i++) store.save(makeDegradedReport(`p${i}`));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "10", "--json"]);

    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.recommendationStatus).toBe("ok");
    expect(Array.isArray(parsed.subsystemRecommendations)).toBe(true);
    expect(parsed.subsystemRecommendations.length).toBeGreaterThan(0);
    expect(parsed.subsystemRecommendations[0]).toHaveProperty("signal");
    expect(parsed.subsystemRecommendations[0]).toHaveProperty("severity");
    expect(parsed.subsystemRecommendations[0]).toHaveProperty("confidence");

    cwdSpy.mockRestore();
    c.restore();
  });

  it("reports insufficient_data when all reports are insufficient", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    store.save(makeInsufficientReport("p1"));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "10", "--json"]);

    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.recommendationStatus).toBe("insufficient_data");
    expect(parsed.subsystemRecommendations).toEqual([]);

    cwdSpy.mockRestore();
    c.restore();
  });

  it("prints the empty-result block when trends are ok but no signal fires", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "10"]);

    const out = c.out().join("\n");
    expect(out).toContain("No recommendations generated.");
    expect(out).toContain("Recommendation status: ok");

    cwdSpy.mockRestore();
    c.restore();
  });

  it("silently excludes a corrupt report and still analyzes the valid one", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    for (let i = 0; i < 3; i++) store.save(makeDegradedReport(`p${i}`));
    // OutcomeReportStore.list() filters corrupt files; write one directly.
    writeFileSync(join(execDir, "outcomes", "outcome-corrupt.json"), "not valid json", "utf-8");

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "10", "--json"]);

    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.recommendationStatus).toBe("ok");
    expect(parsed.subsystemRecommendations.length).toBeGreaterThan(0);

    cwdSpy.mockRestore();
    c.restore();
  });

  it("--window 1 limits analysis to a single report", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    store.save(makeDegradedReport("p1"));
    store.save(makeDegradedReport("p2"));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "1", "--json"]);

    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.requestedWindow).toBe(1);

    cwdSpy.mockRestore();
    c.restore();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/cli/commands/executive-recommend-cli.vitest.ts`
Expected: FAIL — `handleRecommendCommand` is not defined (module does not exist yet).

- [ ] **Step 3: Write the CLI handler**

`src/cli/commands/executive-recommend-handler.ts`:

```ts
/**
 * P10.7a — Executive recommend CLI handler.
 *
 * Composes the P10.6 learning pipeline (OutcomeReportStore →
 * computeLearningTrends) with the P10.7a recommendation engine
 * (computeRecommendations) and renders a terminal table or JSON.
 *
 * Read-only: uses store.list()/load() only.
 *
 * @module
 */

import { join } from "node:path";
import type { ExecutiveOutcomeEvaluationReport } from "../../executive/outcome-evaluator.js";
import { OutcomeReportStore } from "../../executive/outcome-store.js";
import { computeLearningTrends } from "../../executive/learning-engine.js";
import { computeRecommendations } from "../../executive/recommendation-engine.js";
import type { RecommendationResult } from "../../executive/recommendation-engine.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW = 10;

// ---------------------------------------------------------------------------
// CLI handler
// ---------------------------------------------------------------------------

export async function handleRecommendCommand(args: string[]): Promise<void> {
  const windowIndex = args.indexOf("--window");
  const windowN = windowIndex !== -1 && windowIndex + 1 < args.length
    ? Math.max(1, parseInt(args[windowIndex + 1], 10) || DEFAULT_WINDOW)
    : DEFAULT_WINDOW;
  const useJson = args.includes("--json");

  const execDir = join(process.cwd(), ".alix", "executive");
  const store = new OutcomeReportStore(join(execDir, "outcomes"));

  const metas = store.list();
  const windowed = metas.slice(0, windowN);
  const reports: ExecutiveOutcomeEvaluationReport[] = [];

  for (const meta of windowed) {
    try {
      const report = store.load(meta.reportId);
      if (report) reports.push(report);
    } catch (e: any) {
      console.warn(`Skipping report ${meta.reportId}: ${e.message}`);
    }
  }

  const trends = computeLearningTrends(reports, windowN);
  const result = computeRecommendations(trends);

  if (useJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    renderTable(result);
  }
}

// ---------------------------------------------------------------------------
// Terminal rendering
// ---------------------------------------------------------------------------

function renderTable(result: RecommendationResult): void {
  if (result.subsystemRecommendations.length === 0) {
    console.log("No recommendations generated.");
    console.log(`Recommendation status: ${result.recommendationStatus}`);
    console.log(`Analyzed reports: ${result.analyzedReportCount}`);
    return;
  }

  console.log(`\nExecutive Recommendations (last ${result.requestedWindow} plans)`);
  console.log(`Generated: ${result.generatedAt}\n`);

  console.log(
    `${"Subsystem".padEnd(18)} ${"Signal".padEnd(24)} ${"Severity".padEnd(9)} ` +
    `${"Conf".padEnd(6)} ${"Occurrences".padEnd(12)} ${"Avg Δ".padEnd(7)} Recommendation`,
  );
  console.log("-".repeat(96));
  for (const r of result.subsystemRecommendations) {
    console.log(
      `${r.subsystem.padEnd(18)} ${r.signal.padEnd(24)} ${r.severity.padEnd(9)} ` +
      `${r.confidence.toFixed(2).padEnd(6)} ${String(r.occurrenceCount).padEnd(12)} ` +
      `${fmtDelta(r.averageDelta).padEnd(7)} ${r.recommendation}`,
    );
  }

  console.log(
    `\nInput: ${result.inputReportCount} reports | Skipped: ${result.skippedReportCount}`,
  );
  for (const w of result.warnings) console.error(`Warning: ${w}`);
  for (const w of result.loadWarnings) console.error(`Load warning: ${w}`);
}

function fmtDelta(delta: number): string {
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`;
}
```

- [ ] **Step 4: Wire routing into `executive.ts`**

In `src/cli/commands/executive.ts`, add a `case "recommend"` block immediately after the `case "learn"` block (which ends at the `}` before `default:`). The block:

```ts
    case "recommend": {
      const { handleRecommendCommand } = await import(
        "./executive-recommend-handler.js"
      );
      return handleRecommendCommand(rest);
    }
```

Then update the `default:` error subcommand list. The current line is:

```ts
      console.error("Available: dashboard, plan, evaluate, outcomes, learn");
```

Change it to:

```ts
      console.error("Available: dashboard, plan, evaluate, outcomes, learn, recommend");
```

- [ ] **Step 5: Run the integration tests to verify they pass**

Run: `npx vitest run tests/cli/commands/executive-recommend-cli.vitest.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/executive-recommend-handler.ts src/cli/commands/executive.ts tests/cli/commands/executive-recommend-cli.vitest.ts
git commit -m "feat(p10-7a): executive recommend CLI + routing"
```

---

### Task 3: Sentinel registration + full-suite verification

**Files:**
- Modify: `tests/executive/executive-sentinels.vitest.ts` (add both new files to `EXECUTIVE_FILES`)

**Goal:** Register both P10.7a files in the executive purity sentinel. Both are read-only and contain no forbidden mutation symbols, so NO write exceptions are needed.

- [ ] **Step 1: Add the new files to the sentinel allowlist**

In `tests/executive/executive-sentinels.vitest.ts`, the `EXECUTIVE_FILES` array ends with the P10.5a group:

```ts
  // P10.5a files
  "src/executive/outcome-evaluator.ts",
  "src/cli/commands/executive-evaluate-handler.ts",
  "src/cli/commands/executive-learn-handler.ts",
];
```

Append a P10.7a group before the closing `];`:

```ts
  // P10.5a files
  "src/executive/outcome-evaluator.ts",
  "src/cli/commands/executive-evaluate-handler.ts",
  "src/cli/commands/executive-learn-handler.ts",
  // P10.7a files
  "src/executive/recommendation-engine.ts",
  "src/cli/commands/executive-recommend-handler.ts",
];
```

- [ ] **Step 2: Run the sentinel to verify both new files pass with NO exceptions**

Run: `npx vitest run tests/executive/executive-sentinels.vitest.ts`
Expected: PASS — both new files scanned, no `forbidden symbol` errors. The sentinel's comment header says "21 tests total"; the count increases by 2. (No assertion depends on the literal 21, so this is a comment-only drift; leave the comment as-is unless a reviewer asks to update it.)

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — full suite green, including the 10 new recommendation-engine tests, the 6 new CLI tests, and the 2 new sentinel tests.

- [ ] **Step 4: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add tests/executive/executive-sentinels.vitest.ts
git commit -m "test(p10-7a): register recommendation files in executive purity sentinel"
```

---

### Task 4: Final whole-branch review + PR + tag

- [ ] Dispatch the whole-branch code review (8-angle `code-review` skill) against the branch diff from the P10.6 tag / merge-base.
- [ ] Triage findings: apply any correctness fixes (dispatch ONE fix subagent with the complete findings list), defer cleanup-only findings to the ledger with rationale.
- [ ] Run final `npx vitest run` + `npx tsc --noEmit`.
- [ ] Push branch, open PR against `main`, merge (squash), tag `alix-p10-7a-complete`, push tag.
- [ ] Update the progress ledger and write/append the memory entry.

---

## Self-Review (checked against the spec)

**Spec coverage:**
- ✅ Types (`RecommendationSignal`, `RecommendationSeverity`, `RecommendationDraft`, `RecommendationResult`, status constants) — Task 1
- ✅ Signal detection + severity + confidence formulas (all 4 signals) — Task 1 `classifySubsystem`
- ✅ Precedence order — Task 1 (tested explicitly)
- ✅ Confidence `round2` — Task 1
- ✅ Sort order — Task 1 (tested at both tiebreak levels)
- ✅ `generatedAt` injectable — Task 1 (3rd param + test)
- ✅ `loadWarnings` carried through — Task 1 (tested)
- ✅ insufficient_data passthrough — Task 1 (tested)
- ✅ Empty/no-signal → ok + empty — Task 1 (tested) + Task 2 empty-render test
- ✅ CLI `alix executive recommend [--window N] [--json]` — Task 2
- ✅ Terminal table + empty block — Task 2
- ✅ JSON output — Task 2
- ✅ Routing + subcommand list — Task 2 Step 4
- ✅ Sentinel registration, no exceptions — Task 3
- ✅ `--include-stable` NOT implemented / NOT tested — confirmed absent from Tasks 1–3
- ✅ `reports?` reserved, unreferenced — Task 1 (prefixed `_reports`)

**Placeholder scan:** none — every step has complete code or an exact command.

**Type consistency:** `RecommendationResult` fields (`recommendationStatus`, `generatedAt`, `requestedWindow`, `inputReportCount`, `analyzedReportCount`, `skippedReportCount`, `subsystemRecommendations`, `warnings`, `loadWarnings`) match across the type, the function return, and the CLI renderer. `RecommendationDraft` fields match across classification, tests, and the terminal row.

**Confidence example reconciliation:** the spec's illustrative terminal row showed `workflow 0.72`; the real formula at `avgDelta=-3.2, degradationRate=0.5, occurrenceCount=8` yields `0.88`, which is what the Task 1 test asserts. The plan's tests use computed values; the spec's illustrative table is left as-is (it is labeled illustrative).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-26-p10-7a-recommendation-engine.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task (Tasks 1–3), review between tasks, then a final whole-branch review before PR + tag.
2. **Inline Execution** — Execute Tasks 1–3 in this session with checkpoints.

**Which approach?**
