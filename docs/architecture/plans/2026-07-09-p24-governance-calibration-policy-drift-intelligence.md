# P24 — Governance Calibration & Policy Drift Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only governance calibration layer that detects policy drift from P22 closure intelligence and P23 replay/counterfactual readiness outputs — without executing, mutating, ranking, or auto-adopting.

**Architecture:** P24 is strictly additive to P9.0d. Six signal dimensions (calibration_skew, replay_divergence, convergent_gap, trend_direction, evidence_coverage, volatility) are detected via 4-layer aggregation over windowed P22/P23 records. PolicyDriftSignal (rich internal diagnostic) ≠ DriftFinding (external projection). Confidence bands classify evidence certainty, not action urgency.

**Tech Stack:** TypeScript, node:test, node:assert/strict, existing governance patterns

## Global Constraints

- No autonomous execution, background jobs, or scheduled watchers
- No shell, network, MCP, browser, fetch, or subprocess calls
- No execution adapters, executor imports, or tool invocations
- No policy mutation or readiness threshold mutation
- No approval, handoff, closure review, or audit event mutation
- No persisting P24 outputs as live governance state
- No operator ranking, productivity scoring, or leaderboard
- No auto-adoption, auto-close, or bypass around P14–P23
- No policy recommendations or threshold-change proposals ("change threshold from X to Y")
- Empty inputs must produce evidence_coverage signal (direction: "insufficient_evidence"), not zero signals
- All P24 pure modules use `import type` for external types only
- No `fs`, `child_process`, `exec`, `spawn`, network clients, execution adapters, mutable stores, audit emitters, approval/handoff/closure/policy writers in pure modules
- Every externally exposed artifact carries `readOnly: true; noPolicyMutation: true; noThresholdChange: true; noAutoAdoption: true; noRanking: true;`
- P9.0d, P22, P23 files remain untouched
- Tests use `node:test` (describe/it) + `node:assert/strict`, helper factory functions for minimal test objects

---

## File Structure

### Created Files (8)

| Slice | File | Purpose |
|-------|------|---------|
| P24.1 | `src/governance/policy-drift-types.ts` | PolicyDriftSignal types, direction/severity/kinds, threshold config + defaults |
| P24.2 | `src/governance/policy-drift.ts` | Pure `detectPolicyDrift()` — 4-layer aggregation |
| P24.3 | `src/governance/calibration-confidence-bands.ts` | Pure `buildConfidenceBands()` — evidence certainty classification |
| P24.4 | `src/governance/calibration-report.ts` | Pure `buildCalibrationReport()` + text/json renderers |
| P24.4 | `src/governance/drift-finding-adapter.ts` | `toDriftFindings()` — maps PolicyDriftSignal[] → DriftFinding[] |
| P24.4 | `src/cli/commands/governance-calibration.ts` | CLI handler for `alix governance calibration {detect|report|bands}` |
| P24.0 | `docs/architecture/specs/2026-07-09-p24-0-governance-calibration-policy-drift-intelligence-design.md` | Design spec (done) |
| P24.5 | `docs/architecture/checkpoints/2026-07-09-p24-5-checkpoint.md` | Checkpoint doc |

### Touched Files (1)

| File | Change |
|------|--------|
| `src/cli/commands/governance.ts` | Add `case "calibration"` dispatch (dynamic import) |

### Untouched Files

- `src/governance/governance-drift-detector.ts` (P9.0d)
- `src/governance/governance-types.ts` (DriftFinding type — consumed, not changed)
- `src/governance/replay/*` (P23)
- `src/governance/handoff-readiness-calibration.ts` (P22)
- `src/governance/handoff-intelligence-types.ts` (P22)

---

### Task 1: P24.1 — Calibration Signal Model (policy-drift-types.ts)

**Files:**
- Create: `src/governance/policy-drift-types.ts`
- Test: `tests/governance/policy-drift-types.test.ts`

**Interfaces:**
- Produces: `PolicyDriftSignalKind`, `PolicyDriftDirection`, `PolicyDriftSeverity`, `PolicyDriftSignal`, `PolicyDriftThresholds`, `DEFAULT_POLICY_DRIFT_THRESHOLDS` — consumed by Tasks 2, 3, 4, 5

- [ ] **Step 1: Write the failing type structure test**

Write `tests/governance/policy-drift-types.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_POLICY_DRIFT_THRESHOLDS } from "../../src/governance/policy-drift-types.js";
import type {
  PolicyDriftSignalKind,
  PolicyDriftDirection,
  PolicyDriftSeverity,
  PolicyDriftSignal,
  PolicyDriftThresholds,
} from "../../src/governance/policy-drift-types.js";

describe("PolicyDriftTypes", () => {

  it("has 6 signal kinds", () => {
    const kinds: PolicyDriftSignalKind[] = [
      "calibration_skew",
      "replay_divergence",
      "convergent_gap",
      "trend_direction",
      "evidence_coverage",
      "volatility",
    ];
    assert.equal(kinds.length, 6);
  });

  it("has 7 drift directions", () => {
    const dirs: PolicyDriftDirection[] = [
      "too_loose",
      "too_strict",
      "stale",
      "unstable",
      "improving",
      "insufficient_evidence",
      "neutral",
    ];
    assert.equal(dirs.length, 7);
  });

  it("has 4 severity levels", () => {
    const sevs: PolicyDriftSeverity[] = ["none", "low", "medium", "high"];
    assert.equal(sevs.length, 4);
  });

  it("DEFAULT_POLICY_DRIFT_THRESHOLDS has all 3 threshold groups", () => {
    assert.ok(DEFAULT_POLICY_DRIFT_THRESHOLDS.calibrationSkew);
    assert.ok(DEFAULT_POLICY_DRIFT_THRESHOLDS.replayDivergence);
    assert.ok(DEFAULT_POLICY_DRIFT_THRESHOLDS.convergentGap);
  });

  it("calibrationSkew medium threshold defaults to 0.60 rate / 10 sample", () => {
    const t = DEFAULT_POLICY_DRIFT_THRESHOLDS.calibrationSkew.medium;
    assert.equal(t.minRate, 0.60);
    assert.equal(t.minSampleSize, 10);
  });

  it("calibrationSkew high threshold defaults to 0.70 rate / 20 sample", () => {
    const t = DEFAULT_POLICY_DRIFT_THRESHOLDS.calibrationSkew.high;
    assert.equal(t.minRate, 0.70);
    assert.equal(t.minSampleSize, 20);
  });

  it("replayDivergence medium threshold defaults to 0.40 rate / 10 replays", () => {
    const t = DEFAULT_POLICY_DRIFT_THRESHOLDS.replayDivergence.medium;
    assert.equal(t.minRate, 0.40);
    assert.equal(t.minReplayCount, 10);
  });

  it("replayDivergence high threshold defaults to 0.60 rate / 20 replays", () => {
    const t = DEFAULT_POLICY_DRIFT_THRESHOLDS.replayDivergence.high;
    assert.equal(t.minRate, 0.60);
    assert.equal(t.minReplayCount, 20);
  });

  it("convergentGap medium threshold defaults to 0.30 rate / 8 paired", () => {
    const t = DEFAULT_POLICY_DRIFT_THRESHOLDS.convergentGap.medium;
    assert.equal(t.minRate, 0.30);
    assert.equal(t.minPairedCount, 8);
  });

  it("convergentGap high threshold defaults to 0.50 rate / 12 paired", () => {
    const t = DEFAULT_POLICY_DRIFT_THRESHOLDS.convergentGap.high;
    assert.equal(t.minRate, 0.50);
    assert.equal(t.minPairedCount, 12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/governance/policy-drift-types.test.ts`
Expected: FAIL with module-not-found / import errors (file doesn't exist yet)

- [ ] **Step 3: Write minimal types file**

Create `src/governance/policy-drift-types.ts`:

```typescript
/**
 * P24.1 — Governance Calibration & Policy Drift Types.
 *
 * Read-only calibration signal types for governance policy drift analysis.
 * No stores, no fs, no execution adapters, no audit emitters.
 *
 * PolicyDriftSignal ≠ DriftFinding.
 * PolicyDriftSignal is the rich internal diagnostic.
 * DriftFinding is the external/report-compatible projection (handled by
 * drift-finding-adapter.ts).
 */

// ---------------------------------------------------------------------------
// Signal kind, direction, severity
// ---------------------------------------------------------------------------

export type PolicyDriftSignalKind =
  | "calibration_skew"
  | "replay_divergence"
  | "convergent_gap"
  | "trend_direction"
  | "evidence_coverage"
  | "volatility";

export type PolicyDriftDirection =
  | "too_loose"
  | "too_strict"
  | "stale"
  | "unstable"
  | "improving"
  | "insufficient_evidence"
  | "neutral";

export type PolicyDriftSeverity = "none" | "low" | "medium" | "high";

// ---------------------------------------------------------------------------
// Evidence reference
// ---------------------------------------------------------------------------

export interface PolicyDriftEvidenceRef {
  source: "p22_calibration" | "p23_replay_diff" | "p23_candidate_lesson";
  lifecycleId?: string;
  handoffId?: string;
  replayId?: string;
  basis?: string;
}

// ---------------------------------------------------------------------------
// Trend metadata
// ---------------------------------------------------------------------------

export interface PolicyDriftTrend {
  previousWindowStart: string;
  previousWindowEnd: string;
  previousValue: number;
  currentValue: number;
  delta: number;
  direction: "improving" | "degrading" | "stable" | "insufficient_history";
}

// ---------------------------------------------------------------------------
// PolicyDriftSignal — the rich internal diagnostic
// ---------------------------------------------------------------------------

export interface PolicyDriftSignal {
  signalId: string;
  kind: PolicyDriftSignalKind;
  windowStart: string;
  windowEnd: string;
  direction: PolicyDriftDirection;
  severity: PolicyDriftSeverity;
  confidence: number;

  sampleSize: {
    p22CalibrationCount: number;
    p23ReplayCount: number;
    pairedLifecycleCount: number;
  };

  rates: {
    overconfidentRate?: number;
    underconfidentRate?: number;
    accurateRate?: number;
    readinessChangedRate?: number;
    blockedInCounterfactualRate?: number;
    evidenceGapChangedRate?: number;
    convergentGapRate?: number;
  };

  trend?: PolicyDriftTrend;

  implicatedPolicyAreas: string[];
  evidenceRefs: PolicyDriftEvidenceRef[];
  rationale: string[];
}

// ---------------------------------------------------------------------------
// Threshold configuration
// ---------------------------------------------------------------------------

export interface CalibrationSkewThreshold {
  medium: { minRate: number; minSampleSize: number };
  high:   { minRate: number; minSampleSize: number };
}

export interface ReplayDivergenceThreshold {
  medium: { minRate: number; minReplayCount: number };
  high:   { minRate: number; minReplayCount: number };
}

export interface ConvergentGapThreshold {
  medium: { minRate: number; minPairedCount: number };
  high:   { minRate: number; minPairedCount: number };
}

export interface PolicyDriftThresholds {
  calibrationSkew: CalibrationSkewThreshold;
  replayDivergence: ReplayDivergenceThreshold;
  convergentGap: ConvergentGapThreshold;
}

export const DEFAULT_POLICY_DRIFT_THRESHOLDS: PolicyDriftThresholds = {
  calibrationSkew: {
    medium: { minRate: 0.60, minSampleSize: 10 },
    high:   { minRate: 0.70, minSampleSize: 20 },
  },
  replayDivergence: {
    medium: { minRate: 0.40, minReplayCount: 10 },
    high:   { minRate: 0.60, minReplayCount: 20 },
  },
  convergentGap: {
    medium: { minRate: 0.30, minPairedCount: 8 },
    high:   { minRate: 0.50, minPairedCount: 12 },
  },
};

// ---------------------------------------------------------------------------
// Boundary artifact (applied to externally-exposed outputs only)
// ---------------------------------------------------------------------------

export interface PolicyDriftBoundaryFlags {
  readonly readOnly: true;
  readonly noPolicyMutation: true;
  readonly noThresholdChange: true;
  readonly noAutoAdoption: true;
  readonly noRanking: true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/governance/policy-drift-types.test.ts`
Expected: PASS (all 10 tests)

- [ ] **Step 5: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile (no type errors)

- [ ] **Step 6: Commit**

```bash
git add src/governance/policy-drift-types.ts tests/governance/policy-drift-types.test.ts
git commit -m "feat(P24.1): calibration signal model — types, directions, thresholds

6 signal kinds, 7 directions, 4 severity levels, PolicyDriftSignal interface,
default threshold constants. Pure types — no detector logic, no stores, no fs.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: P24.2 — Policy Drift Detector (policy-drift.ts)

**Files:**
- Create: `src/governance/policy-drift.ts`
- Test: `tests/governance/policy-drift.test.ts`

**Interfaces:**
- Consumes: `PolicyDriftSignal`, `PolicyDriftThresholds`, `DEFAULT_POLICY_DRIFT_THRESHOLDS` from Task 1
- Also consumes external P22/P23 types:
  - `CalibrationLabel` from `../../src/governance/handoff-readiness-calibration.js` (P22)
  - `ReplayDiffDetail`, `ReplayCandidateLesson` from `../../src/governance/replay/types.js` (P23)
- Produces: `detectPolicyDrift(opts)` → `PolicyDriftSignal[]` — consumed by Tasks 3, 4, 5

- [ ] **Step 1: Write the failing tests**

Create `tests/governance/policy-drift.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectPolicyDrift } from "../../src/governance/policy-drift.js";
import type { PolicyDriftSignal } from "../../src/governance/policy-drift-types.js";
import type { CalibrationLabel } from "../../src/governance/handoff-readiness-calibration.js";

const VALID_ISO = "2026-07-08T18:00:00.000Z";
const WINDOW_START = "2026-06-01T00:00:00.000Z";
const WINDOW_END = "2026-07-01T00:00:00.000Z";
const PREV_START = "2026-05-01T00:00:00.000Z";
const PREV_END = "2026-06-01T00:00:00.000Z";

function cal(overrides: Partial<{
  handoffId: string; planId: string; readinessLevel: string;
  closureDecision: string; calibration: CalibrationLabel;
  evidenceComplete: boolean; evidenceCount: number;
  lifecycleId: string;
}> = {}): Record<string, unknown> {
  return {
    handoffId: "ho-1",
    planId: "plan-1",
    readinessLevel: "dry_run_capable",
    closureDecision: "accepted",
    calibration: "accurate",
    evidenceComplete: true,
    evidenceCount: 3,
    lifecycleId: "lc-1",
    ...overrides,
  };
}

function diff(overrides: Partial<{
  category: string; sourceId: string; field: string;
  originalValue: unknown; counterfactualValue: unknown;
  lifecycleId: string;
}> = {}): Record<string, unknown> {
  return {
    category: "unchanged",
    sourceId: "src-1",
    field: "readinessLevel",
    originalValue: "dry_run_capable",
    counterfactualValue: "dry_run_capable",
    lifecycleId: "lc-1",
    ...overrides,
  };
}

function lesson(overrides: Partial<{
  lessonId: string; summary: string; basis: string[];
  confidence: string; appliesTo: string; lifecycleId: string;
}> = {}): Record<string, unknown> {
  return {
    lessonId: "l-1",
    summary: "Readiness may have been overestimated",
    basis: ["missing evidence"],
    confidence: "medium",
    appliesTo: "readiness",
    lifecycleId: "lc-1",
    ...overrides,
  };
}

describe("detectPolicyDrift", () => {

  it("empty inputs produce evidence_coverage signal with insufficient_evidence", () => {
    const signals = detectPolicyDrift({
      calibrations: [],
      replayDiffs: [],
      candidateLessons: [],
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    assert.equal(signals.length, 1);
    assert.equal(signals[0]!.kind, "evidence_coverage");
    assert.equal(signals[0]!.direction, "insufficient_evidence");
    assert.ok(["none", "low"].includes(signals[0]!.severity));
  });

  it("detects calibration_skew when overconfident rate exceeds threshold", () => {
    const calibrations = Array.from({ length: 20 }, (_, i) => cal({
      handoffId: `ho-${i}`,
      calibration: i < 12 ? "overconfident" : "accurate",
    }));
    const signals = detectPolicyDrift({
      calibrations,
      replayDiffs: [],
      candidateLessons: [],
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    const skew = signals.find(s => s.kind === "calibration_skew");
    assert.ok(skew, "expected calibration_skew signal");
    assert.equal(skew!.direction, "too_loose");
    assert.equal(skew!.severity, "medium");
    assert.equal(skew!.rates.overconfidentRate, 0.6);
  });

  it("detects calibration_skew high when overconfident rate >= 0.70 with >= 20 samples", () => {
    const calibrations = Array.from({ length: 20 }, () => cal({ calibration: "overconfident" }));
    const signals = detectPolicyDrift({
      calibrations,
      replayDiffs: [],
      candidateLessons: [],
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    const skew = signals.find(s => s.kind === "calibration_skew");
    assert.ok(skew);
    assert.equal(skew!.severity, "high");
  });

  it("does not emit calibration_skew when accurate rate is within band", () => {
    const calibrations = Array.from({ length: 20 }, () => cal({ calibration: "accurate" }));
    const signals = detectPolicyDrift({
      calibrations,
      replayDiffs: [],
      candidateLessons: [],
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    const skew = signals.find(s => s.kind === "calibration_skew");
    assert.equal(skew, undefined);
  });

  it("detects replay_divergence when readiness_changed rate exceeds threshold", () => {
    const diffs = Array.from({ length: 15 }, (_, i) => diff({
      sourceId: `src-${i}`,
      category: i < 7 ? "readiness_changed" : "unchanged",
    }));
    const signals = detectPolicyDrift({
      calibrations: [],
      replayDiffs: diffs,
      candidateLessons: [],
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    const divergence = signals.find(s => s.kind === "replay_divergence");
    assert.ok(divergence, "expected replay_divergence signal");
    assert.equal(divergence!.rates.readinessChangedRate, 7 / 15);
  });

  it("detects convergent_gap when P22 + P23 align on same lifecycle", () => {
    // 10 paired lifecycles: 4 have both overconfident calibration AND blocked_in_counterfactual
    const calibrations = Array.from({ length: 10 }, (_, i) => cal({
      handoffId: `ho-${i}`,
      lifecycleId: `lc-${i}`,
      calibration: i < 4 ? "overconfident" : "accurate",
    }));
    const diffs = Array.from({ length: 10 }, (_, i) => diff({
      sourceId: `src-${i}`,
      lifecycleId: `lc-${i}`,
      category: i < 4 ? "blocked_in_counterfactual" : "unchanged",
    }));
    const signals = detectPolicyDrift({
      calibrations,
      replayDiffs: diffs,
      candidateLessons: [],
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    const gap = signals.find(s => s.kind === "convergent_gap");
    assert.ok(gap, "expected convergent_gap signal");
    assert.equal(gap!.rates.convergentGapRate, 0.40);
  });

  it("computes trend_direction between windows", () => {
    const currentCal = Array.from({ length: 20 }, () => cal({ calibration: "overconfident" }));
    const prevCal = Array.from({ length: 20 }, () => cal({ calibration: "accurate" }));
    const signals = detectPolicyDrift({
      calibrations: currentCal,
      replayDiffs: [],
      candidateLessons: [],
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      previousWindowStart: PREV_START,
      previousWindowEnd: PREV_END,
      previousCalibrations: prevCal,
    });
    const trend = signals.find(s => s.kind === "trend_direction");
    assert.ok(trend, "expected trend_direction signal");
    assert.equal(trend!.direction, "too_loose");
    assert.ok(trend!.trend);
    assert.equal(trend!.trend!.direction, "degrading");
    assert.ok(trend!.trend!.delta > 0);
  });

  it("emits evidence_coverage when sample count is too low", () => {
    const calibrations = [cal({ handoffId: "ho-1" })];
    const signals = detectPolicyDrift({
      calibrations,
      replayDiffs: [],
      candidateLessons: [],
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    const coverage = signals.find(s => s.kind === "evidence_coverage");
    assert.ok(coverage, "expected evidence_coverage signal");
    assert.equal(coverage!.direction, "insufficient_evidence");
  });

  it("does not emit volatility with only two windows (requires 3+ windows)", () => {
    // With only 2 windows, volatility cannot be detected. Verify no crash.
    const prevCal = Array.from({ length: 20 }, () => cal({ calibration: "overconfident" }));
    const currCal = Array.from({ length: 20 }, () => cal({ calibration: "accurate" }));
    const signals = detectPolicyDrift({
      calibrations: currCal,
      replayDiffs: [],
      candidateLessons: [],
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      previousWindowStart: PREV_START,
      previousWindowEnd: PREV_END,
      previousCalibrations: prevCal,
    });
    // Overconfident dropped from ~100% to 0% → improvement, no volatility
    assert.ok(Array.isArray(signals));
    const volatility = signals.find(s => s.kind === "volatility");
    assert.equal(volatility, undefined);
  });

  it("produces deterministic output for same inputs", () => {
    const calibrations = Array.from({ length: 15 }, (_, i) => cal({
      handoffId: `ho-${i}`,
      calibration: i < 9 ? "overconfident" : "accurate",
    }));
    const result1 = detectPolicyDrift({
      calibrations,
      replayDiffs: [],
      candidateLessons: [],
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    const result2 = detectPolicyDrift({
      calibrations,
      replayDiffs: [],
      candidateLessons: [],
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    assert.deepEqual(result1, result2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/governance/policy-drift.test.ts`
Expected: FAIL with module-not-found (policy-drift.ts doesn't exist yet)

- [ ] **Step 3: Write the minimal detector implementation**

Create `src/governance/policy-drift.ts`:

```typescript
/**
 * P24.2 — Policy Drift Detector.
 *
 * Pure function: consumes P22 calibration records and P23 replay diff/report
 * records, applies 4-layer aggregation, and emits PolicyDriftSignal[].
 *
 * No stores. No file reads. No CLI args. No date guessing inside.
 * Deterministic: same inputs + same thresholds → same output every time.
 *
 * CORE INVARIANT: This module NEVER writes to any store, mutates any
 * policy, changes any threshold, ranks any operator, or auto-adopts.
 */

import type { PolicyDriftSignal } from "./policy-drift-types.js";
import type {
  PolicyDriftThresholds,
  PolicyDriftDirection,
  PolicyDriftEvidenceRef,
} from "./policy-drift-types.js";
import { DEFAULT_POLICY_DRIFT_THRESHOLDS } from "./policy-drift-types.js";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CalibrationInput {
  handoffId: string;
  planId: string;
  readinessLevel: string;
  closureDecision: string;
  calibration: string; // "overconfident" | "underconfident" | "accurate"
  evidenceComplete: boolean;
  evidenceCount: number;
  lifecycleId?: string;
}

export interface ReplayDiffInput {
  category: string;
  sourceId: string;
  field: string;
  originalValue: unknown;
  counterfactualValue: unknown;
  lifecycleId?: string;
}

export interface CandidateLessonInput {
  lessonId: string;
  summary: string;
  basis: readonly string[];
  confidence: string;
  appliesTo: string;
  lifecycleId?: string;
}

// ---------------------------------------------------------------------------
// Detect options
// ---------------------------------------------------------------------------

export interface DetectPolicyDriftOpts {
  calibrations: CalibrationInput[];
  replayDiffs: ReplayDiffInput[];
  candidateLessons: CandidateLessonInput[];
  windowStart: string;
  windowEnd: string;
  previousWindowStart?: string;
  previousWindowEnd?: string;
  previousCalibrations?: CalibrationInput[];
  previousReplayDiffs?: ReplayDiffInput[];
  thresholds?: PolicyDriftThresholds;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deterministicId(kind: string, windowStart: string, windowEnd: string, index: number): string {
  const hash = createHash("sha256")
    .update(["p24", kind, windowStart, windowEnd, String(index)].join("|"))
    .digest("hex")
    .slice(0, 16);
  return `p24-${kind.slice(0, 2)}:${hash}`;
}


function safeDiv(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

// ---------------------------------------------------------------------------
// Layer 1: Compute source rates
// ---------------------------------------------------------------------------

function computeCalibrationRates(
  calibrations: CalibrationInput[],
): { overconfidentRate: number; underconfidentRate: number; accurateRate: number } {
  const total = calibrations.length;
  if (total === 0) return { overconfidentRate: 0, underconfidentRate: 0, accurateRate: 0 };
  const over = calibrations.filter(c => c.calibration === "overconfident").length;
  const under = calibrations.filter(c => c.calibration === "underconfident").length;
  const accurate = calibrations.filter(c => c.calibration === "accurate").length;
  return {
    overconfidentRate: safeDiv(over, total),
    underconfidentRate: safeDiv(under, total),
    accurateRate: safeDiv(accurate, total),
  };
}

function computeReplayDivergenceRates(
  replayDiffs: ReplayDiffInput[],
): { readinessChangedRate: number; blockedInCounterfactualRate: number; evidenceGapChangedRate: number } {
  const total = replayDiffs.length;
  if (total === 0) return { readinessChangedRate: 0, blockedInCounterfactualRate: 0, evidenceGapChangedRate: 0 };
  const readinessChanged = replayDiffs.filter(d => d.category === "readiness_changed").length;
  const blocked = replayDiffs.filter(d => d.category === "blocked_in_counterfactual").length;
  const evidenceGap = replayDiffs.filter(d => d.category === "evidence_gap_changed").length;
  return {
    readinessChangedRate: safeDiv(readinessChanged, total),
    blockedInCounterfactualRate: safeDiv(blocked, total),
    evidenceGapChangedRate: safeDiv(evidenceGap, total),
  };
}

// ---------------------------------------------------------------------------
// Layer 2: Lifecycle pairing (convergent gaps)
// ---------------------------------------------------------------------------

function computeConvergentGapRate(
  calibrations: CalibrationInput[],
  replayDiffs: ReplayDiffInput[],
): { convergentGapRate: number; pairedCount: number; evidenceRefs: PolicyDriftEvidenceRef[] } {
  // Build lifecycle maps
  const calByLc = new Map<string, CalibrationInput[]>();
  for (const c of calibrations) {
    if (c.lifecycleId) {
      const list = calByLc.get(c.lifecycleId) ?? [];
      list.push(c);
      calByLc.set(c.lifecycleId, list);
    }
  }

  const diffByLc = new Map<string, ReplayDiffInput[]>();
  for (const d of replayDiffs) {
    if (d.lifecycleId) {
      const list = diffByLc.get(d.lifecycleId) ?? [];
      list.push(d);
      diffByLc.set(d.lifecycleId, list);
    }
  }

  // Find lifecycles present in BOTH maps
  const pairedLcs = new Set<string>();
  for (const lc of calByLc.keys()) {
    if (diffByLc.has(lc)) pairedLcs.add(lc);
  }

  const pairedCount = pairedLcs.size;
  if (pairedCount === 0) return { convergentGapRate: 0, pairedCount: 0, evidenceRefs: [] };

  // Count convergent gaps: lifecycle has overconfident calibration + blocked_in_counterfactual
  let gapCount = 0;
  const refs: PolicyDriftEvidenceRef[] = [];
  for (const lc of pairedLcs) {
    const cals = calByLc.get(lc)!;
    const diffs = diffByLc.get(lc)!;
    const hasOverconfident = cals.some(c => c.calibration === "overconfident");
    const hasBlocked = diffs.some(d => d.category === "blocked_in_counterfactual");
    if (hasOverconfident && hasBlocked) {
      gapCount++;
      refs.push({
        source: "p23_replay_diff",
        lifecycleId: lc,
        basis: `Lifecycle ${lc}: overconfident calibration + blocked in counterfactual`,
      });
    }
  }

  return {
    convergentGapRate: safeDiv(gapCount, pairedCount),
    pairedCount,
    evidenceRefs: refs,
  };
}

// ---------------------------------------------------------------------------
// Layer 3: Window comparison (trend)
// ---------------------------------------------------------------------------

function computeTrend(
  currentRates: { overconfidentRate: number },
  previousRates: { overconfidentRate: number },
  prevStart?: string,
  prevEnd?: string,
): PolicyDriftSignal["trend"] | undefined {
  if (!prevStart || !prevEnd) return undefined;

  const delta = currentRates.overconfidentRate - previousRates.overconfidentRate;
  // Treat delta within 0.05 as stable
  const absDelta = Math.abs(delta);
  let direction: "improving" | "degrading" | "stable" | "insufficient_history";
  if (absDelta < 0.05) {
    direction = "stable";
  } else if (delta > 0) {
    direction = "degrading"; // overconfidence increased
  } else {
    direction = "improving"; // overconfidence decreased
  }

  return {
    previousWindowStart: prevStart,
    previousWindowEnd: prevEnd,
    previousValue: previousRates.overconfidentRate,
    currentValue: currentRates.overconfidentRate,
    delta,
    direction,
  };
}

// ---------------------------------------------------------------------------
// Main: detectPolicyDrift
// ---------------------------------------------------------------------------

export function detectPolicyDrift(opts: DetectPolicyDriftOpts): PolicyDriftSignal[] {
  const { calibrations, replayDiffs, candidateLessons, windowStart, windowEnd } = opts;
  const thresholds = opts.thresholds ?? DEFAULT_POLICY_DRIFT_THRESHOLDS;
  const signals: PolicyDriftSignal[] = [];

  const totalSamples = calibrations.length + replayDiffs.length + candidateLessons.length;
  const pairedInfo = computeConvergentGapRate(calibrations, replayDiffs);

  // ---- Guard: if no data at all, emit evidence_coverage signal ----
  if (totalSamples === 0 && pairedInfo.pairedCount === 0) {
    signals.push({
      signalId: createHash("sha256").update(["p24", "evidence_coverage", windowStart, windowEnd, "0"].join("|")).digest("hex").slice(0, 16),
      kind: "evidence_coverage",
      windowStart,
      windowEnd,
      direction: "insufficient_evidence",
      severity: "none",
      confidence: 1,
      sampleSize: { p22CalibrationCount: 0, p23ReplayCount: 0, pairedLifecycleCount: 0 },
      rates: {},
      implicatedPolicyAreas: [],
      evidenceRefs: [],
      rationale: ["No calibration or replay data available for this window."],
    });
    return signals;
  }

  // ---- Layer 1: Source rates ----
  const calRates = computeCalibrationRates(calibrations);
  const replayRates = computeReplayDivergenceRates(replayDiffs);

  // ---- Layer 1 → calibration_skew signal ----
  if (calibrations.length > 0) {
    const overThreshold = thresholds.calibrationSkew;
    let severity: "medium" | "high" | null = null;
    let direction: PolicyDriftDirection = "neutral";

    if (calRates.overconfidentRate >= overThreshold.high.minRate && calibrations.length >= overThreshold.high.minSampleSize) {
      severity = "high";
      direction = "too_loose";
    } else if (calRates.overconfidentRate >= overThreshold.medium.minRate && calibrations.length >= overThreshold.medium.minSampleSize) {
      severity = "medium";
      direction = "too_loose";
    }

    // Check underconfident skew
    if (!severity) {
      if (calRates.underconfidentRate >= overThreshold.high.minRate && calibrations.length >= overThreshold.high.minSampleSize) {
        severity = "high";
        direction = "too_strict";
      } else if (calRates.underconfidentRate >= overThreshold.medium.minRate && calibrations.length >= overThreshold.medium.minSampleSize) {
        severity = "medium";
        direction = "too_strict";
      }
    }

    if (severity) {
      const refs: PolicyDriftEvidenceRef[] = calibrations
        .filter(c => c.calibration === "overconfident" || c.calibration === "underconfident")
        .slice(0, 5)
        .map(c => ({
          source: "p22_calibration" as const,
          handoffId: c.handoffId,
          lifecycleId: c.lifecycleId,
          basis: `Calibration: ${c.calibration} (readiness ${c.readinessLevel} → ${c.closureDecision})`,
        }));

      signals.push({
        signalId: createHash("sha256").update(["p24", "calibration_skew", windowStart, windowEnd, "0"].join("|")).digest("hex").slice(0, 16),
        kind: "calibration_skew",
        windowStart,
        windowEnd,
        direction,
        severity,
        confidence: calibrations.length >= 50 ? 0.9 : calibrations.length >= 20 ? 0.7 : 0.5,
        sampleSize: {
          p22CalibrationCount: calibrations.length,
          p23ReplayCount: replayDiffs.length,
          pairedLifecycleCount: pairedInfo.pairedCount,
        },
        rates: {
          overconfidentRate: calRates.overconfidentRate,
          underconfidentRate: calRates.underconfidentRate,
          accurateRate: calRates.accurateRate,
        },
        implicatedPolicyAreas: [],
        evidenceRefs: refs,
        rationale: [
          `${direction === "too_loose" ? "Overconfidence" : "Underconfidence"} rate ${direction === "too_loose" ? calRates.overconfidentRate : calRates.underconfidentRate}` +
          ` (threshold: ${severity === "high" ? 0.70 : 0.60}) across ${calibrations.length} calibrations.`,
        ],
      });
    }
  }

  // ---- Layer 1 → replay_divergence signal ----
  if (replayDiffs.length > 0) {
    const divThreshold = thresholds.replayDivergence;
    let severity: "medium" | "high" | null = null;

    if (replayRates.readinessChangedRate >= divThreshold.high.minRate && replayDiffs.length >= divThreshold.high.minReplayCount) {
      severity = "high";
    } else if (replayRates.readinessChangedRate >= divThreshold.medium.minRate && replayDiffs.length >= divThreshold.medium.minReplayCount) {
      severity = "medium";
    }

    if (severity) {
      const refs: PolicyDriftEvidenceRef[] = replayDiffs
        .filter(d => d.category === "readiness_changed" || d.category === "blocked_in_counterfactual")
        .slice(0, 5)
        .map(d => ({
          source: "p23_replay_diff" as const,
          replayId: d.sourceId,
          lifecycleId: d.lifecycleId,
          basis: `Diff: ${d.category} (${d.field}: ${String(d.originalValue)} → ${String(d.counterfactualValue)})`,
        }));

      signals.push({
        signalId: createHash("sha256").update(["p24", "replay_divergence", windowStart, windowEnd, "0"].join("|")).digest("hex").slice(0, 16),
        kind: "replay_divergence",
        windowStart,
        windowEnd,
        direction: "stale",
        severity,
        confidence: replayDiffs.length >= 30 ? 0.9 : replayDiffs.length >= 15 ? 0.7 : 0.5,
        sampleSize: {
          p22CalibrationCount: calibrations.length,
          p23ReplayCount: replayDiffs.length,
          pairedLifecycleCount: pairedInfo.pairedCount,
        },
        rates: {
          readinessChangedRate: replayRates.readinessChangedRate,
          blockedInCounterfactualRate: replayRates.blockedInCounterfactualRate,
          evidenceGapChangedRate: replayRates.evidenceGapChangedRate,
        },
        implicatedPolicyAreas: [],
        evidenceRefs: refs,
        rationale: [
          `Readiness change rate ${replayRates.readinessChangedRate} across ${replayDiffs.length} replays.` +
          ` Counterfactual assumptions frequently produce different readiness outcomes.`,
        ],
      });
    }
  }

  // ---- Layer 2: convergent_gap signal ----
  if (pairedInfo.pairedCount >= thresholds.convergentGap.medium.minPairedCount) {
    const cgThreshold = thresholds.convergentGap;
    let severity: "medium" | "high" | null = null;

    if (pairedInfo.convergentGapRate >= cgThreshold.high.minRate && pairedInfo.pairedCount >= cgThreshold.high.minPairedCount) {
      severity = "high";
    } else if (pairedInfo.convergentGapRate >= cgThreshold.medium.minRate && pairedInfo.pairedCount >= cgThreshold.medium.minPairedCount) {
      severity = "medium";
    }

    if (severity) {
      signals.push({
        signalId: createHash("sha256").update(["p24", "convergent_gap", windowStart, windowEnd, "0"].join("|")).digest("hex").slice(0, 16),
        kind: "convergent_gap",
        windowStart,
        windowEnd,
        direction: "stale",
        severity,
        confidence: pairedInfo.pairedCount >= 20 ? 0.9 : pairedInfo.pairedCount >= 12 ? 0.7 : 0.5,
        sampleSize: {
          p22CalibrationCount: calibrations.length,
          p23ReplayCount: replayDiffs.length,
          pairedLifecycleCount: pairedInfo.pairedCount,
        },
        rates: {
          convergentGapRate: pairedInfo.convergentGapRate,
        },
        implicatedPolicyAreas: [],
        evidenceRefs: pairedInfo.evidenceRefs.slice(0, 10),
        rationale: [
          `${pairedInfo.convergentGapRate} of paired lifecycles show both P22 overconfidence AND P23 blocked_in_counterfactual.` +
          ` This converging evidence suggests a likely policy calibration gap.`,
        ],
      });
    }
  }

  // ---- Layer 3: trend_direction signal ----
  if (opts.previousCalibrations && opts.previousWindowStart && opts.previousWindowEnd) {
    const prevRates = computeCalibrationRates(opts.previousCalibrations);
    const trend = computeTrend(
      { overconfidentRate: calRates.overconfidentRate },
      { overconfidentRate: prevRates.overconfidentRate },
      opts.previousWindowStart,
      opts.previousWindowEnd,
    );

    if (trend && trend.direction !== "stable") {
      signals.push({
        signalId: createHash("sha256").update(["p24", "trend_direction", windowStart, windowEnd, "0"].join("|")).digest("hex").slice(0, 16),
        kind: "trend_direction",
        windowStart,
        windowEnd,
        direction: trend.direction === "degrading" ? "too_loose" : "improving",
        severity: "medium",
        confidence: calibrations.length >= 20 ? 0.7 : 0.5,
        sampleSize: {
          p22CalibrationCount: calibrations.length,
          p23ReplayCount: replayDiffs.length,
          pairedLifecycleCount: pairedInfo.pairedCount,
        },
        rates: {
          overconfidentRate: calRates.overconfidentRate,
        },
        trend,
        implicatedPolicyAreas: [],
        evidenceRefs: [],
        rationale: [
          `Overconfidence rate changed from ${trend.previousValue} to ${trend.currentValue} ` +
          `(delta: ${trend.delta > 0 ? "+" : ""}${trend.delta}). Direction: ${trend.direction}.`,
        ],
      });
    }
  }

  // ---- Layer 4: evidence_coverage signal (guard) ----
  const minCalibrations = thresholds.convergentGap.medium.minPairedCount;
  if (calibrations.length > 0 && calibrations.length < minCalibrations) {
    signals.push({
      signalId: createHash("sha256").update(["p24", "evidence_coverage", windowStart, windowEnd, "1"].join("|")).digest("hex").slice(0, 16),
      kind: "evidence_coverage",
      windowStart,
      windowEnd,
      direction: "insufficient_evidence",
      severity: "low",
      confidence: 1,
      sampleSize: {
        p22CalibrationCount: calibrations.length,
        p23ReplayCount: replayDiffs.length,
        pairedLifecycleCount: pairedInfo.pairedCount,
      },
      rates: {
        overconfidentRate: calRates.overconfidentRate,
        accurateRate: calRates.accurateRate,
      },
      implicatedPolicyAreas: [],
      evidenceRefs: [],
      rationale: [
        `Only ${calibrations.length} calibrations in this window (minimum ${minCalibrations} for confident assessment).`,
        `Policy drift cannot be reliably detected from this sample size.`,
      ],
    });
  }

  // ---- Deterministic sort ----
  signals.sort((a, b) => {
    const kindOrder: Record<string, number> = {
      convergent_gap: 0,
      calibration_skew: 1,
      replay_divergence: 2,
      trend_direction: 3,
      volatility: 4,
      evidence_coverage: 5,
    };
    const ka = kindOrder[a.kind] ?? 99;
    const kb = kindOrder[b.kind] ?? 99;
    if (ka !== kb) return ka - kb;
    return a.signalId.localeCompare(b.signalId);
  });

  return signals;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/governance/policy-drift.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/governance/policy-drift.ts tests/governance/policy-drift.test.ts
git commit -m "feat(P24.2): policy drift detector — 4-layer aggregation

- Layer 1: source rates (calibration skew, replay divergence)
- Layer 2: lifecycle pairing (convergent gaps)
- Layer 3: window comparison (trend direction)
- Layer 4: confidence guards (evidence coverage, volatility)
- Empty inputs produce evidence_coverage signal (not zero signals)
- Deterministic sort, no stores, no mutation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: P24.3 — Governance Confidence Bands (calibration-confidence-bands.ts)

**Files:**
- Create: `src/governance/calibration-confidence-bands.ts`
- Test: `tests/governance/calibration-confidence-bands.test.ts`

**Interfaces:**
- Consumes: `PolicyDriftSignal[]` from Task 2
- Produces: `buildConfidenceBands(signals, opts)` → `CalibrationConfidenceBand[]` — consumed by Task 4

- [ ] **Step 1: Write the failing tests**

Create `tests/governance/calibration-confidence-bands.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildConfidenceBands } from "../../src/governance/calibration-confidence-bands.js";
import type { PolicyDriftSignal } from "../../src/governance/policy-drift-types.js";

const ISO = "2026-07-08T18:00:00.000Z";

function signal(overrides: Partial<PolicyDriftSignal> = {}): PolicyDriftSignal {
  return {
    signalId: "s-1",
    kind: "calibration_skew",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z",
    direction: "too_loose",
    severity: "medium",
    confidence: 0.7,
    sampleSize: { p22CalibrationCount: 20, p23ReplayCount: 15, pairedLifecycleCount: 10 },
    rates: { overconfidentRate: 0.65 },
    implicatedPolicyAreas: [],
    evidenceRefs: [],
    rationale: [],
    ...overrides,
  };
}

describe("buildConfidenceBands", () => {

  it("empty signals produce insufficient_evidence band", () => {
    const bands = buildConfidenceBands([]);
    assert.equal(bands.length, 1);
    assert.equal(bands[0]!.label, "insufficient_evidence");
  });

  it("high confidence band for adequate samples + low volatility + clear signal", () => {
    const signals = [
      signal({
        sampleSize: { p22CalibrationCount: 30, p23ReplayCount: 25, pairedLifecycleCount: 15 },
        confidence: 0.9,
        kind: "calibration_skew",
      }),
    ];
    const bands = buildConfidenceBands(signals);
    const high = bands.find(b => b.label === "high_confidence_drift");
    assert.ok(high, "expected high_confidence_drift band");
  });

  it("low confidence band for few samples", () => {
    const signals = [
      signal({
        sampleSize: { p22CalibrationCount: 3, p23ReplayCount: 1, pairedLifecycleCount: 0 },
        confidence: 0.5,
      }),
    ];
    const bands = buildConfidenceBands(signals);
    const low = bands.find(b => b.label === "low_confidence_drift");
    assert.ok(low, "expected low_confidence_drift band");
  });

  it("no actionable-urgency labels in output", () => {
    const signals = [signal()];
    const bands = buildConfidenceBands(signals);
    for (const band of bands) {
      assert.ok(!["critical", "urgent", "must_fix"].includes(band.label));
    }
  });

  it("neutral band when no drift detected", () => {
    const signals: PolicyDriftSignal[] = [];
    // Only evidence_coverage with insufficient_evidence is still insufficient_evidence, not neutral
    const bands = buildConfidenceBands(signals);
    // Empty signals = insufficient_evidence (from test 1)
    assert.ok(bands.length > 0);
  });

  it("volatile band for high volatility signals", () => {
    // High severity but low confidence → volatility candidate
    const signals = [
      signal({
        kind: "volatility",
        severity: "high",
        confidence: 0.3,
        direction: "unstable",
      }),
    ];
    const bands = buildConfidenceBands(signals);
    const volatile = bands.find(b => b.label === "volatile_or_unstable");
    assert.ok(volatile, "expected volatile_or_unstable band");
  });

  it("moderate confidence for adequate samples with mixed signals", () => {
    const signals = [
      signal({
        sampleSize: { p22CalibrationCount: 15, p23ReplayCount: 12, pairedLifecycleCount: 5 },
        confidence: 0.5,
      }),
    ];
    const bands = buildConfidenceBands(signals);
    const moderate = bands.find(b => b.label === "moderate_confidence_drift");
    assert.ok(moderate, "expected moderate_confidence_drift band");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/governance/calibration-confidence-bands.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the confidence bands implementation**

Create `src/governance/calibration-confidence-bands.ts`:

```typescript
/**
 * P24.3 — Governance Confidence Bands.
 *
 * Classifies signal confidence + evidence_coverage + volatility into
 * evidence-certainty bands. Bands describe certainty, not action urgency.
 *
 * No actionable labels (critical, urgent, must_fix) are used.
 * No stores, no fs, no mutation.
 */

import type { PolicyDriftSignal } from "./policy-drift-types.js";

// ---------------------------------------------------------------------------
// Confidence band types
// ---------------------------------------------------------------------------

export type ConfidenceBandLabel =
  | "high_confidence_drift"
  | "moderate_confidence_drift"
  | "low_confidence_drift"
  | "insufficient_evidence"
  | "volatile_or_unstable"
  | "neutral_or_stable";

export interface CalibrationConfidenceBand {
  label: ConfidenceBandLabel;
  windowStart: string;
  windowEnd: string;
  confidence: number;
  signalCount: number;
  rationale: string[];
}

// ---------------------------------------------------------------------------
// buildConfidenceBands
// ---------------------------------------------------------------------------

export function buildConfidenceBands(
  signals: PolicyDriftSignal[],
  opts?: { windowStart?: string; windowEnd?: string },
): CalibrationConfidenceBand[] {
  const bands: CalibrationConfidenceBand[] = [];
  const windowStart = opts?.windowStart ?? (signals.length > 0 ? signals[0]!.windowStart : "");
  const windowEnd = opts?.windowEnd ?? (signals.length > 0 ? signals[0]!.windowEnd : "");

  // ---- If no signals at all → insufficient_evidence ----
  if (signals.length === 0) {
    bands.push({
      label: "insufficient_evidence",
      windowStart,
      windowEnd,
      confidence: 1,
      signalCount: 0,
      rationale: ["No policy drift signals available for this window."],
    });
    return bands;
  }

  // ---- Check for volatility or unstable signals ----
  const volatilitySignals = signals.filter(
    s => s.kind === "volatility" || s.direction === "unstable",
  );
  if (volatilitySignals.length > 0 && volatilitySignals.some(s => s.severity === "high" || s.severity === "medium")) {
    bands.push({
      label: "volatile_or_unstable",
      windowStart,
      windowEnd,
      confidence: Math.min(...volatilitySignals.map(s => s.confidence)),
      signalCount: volatilitySignals.length,
      rationale: [
        `${volatilitySignals.length} signal(s) with unstable or volatile direction.`,
        "Governance calibration signals swing without a consistent directional trend.",
      ],
    });
  }

  // ---- Check for evidence coverage signals indicating insufficient data ----
  const coverageSignals = signals.filter(s => s.kind === "evidence_coverage");
  const hasInsufficientEvidence = coverageSignals.some(
    s => s.direction === "insufficient_evidence",
  );
  if (hasInsufficientEvidence) {
    bands.push({
      label: "insufficient_evidence",
      windowStart,
      windowEnd,
      confidence: 1,
      signalCount: coverageSignals.length,
      rationale: coverageSignals.flatMap(s => s.rationale),
    });
  }

  // ---- Classify non-coverage, non-volatility signals by confidence + sample size ----
  const analyzableSignals = signals.filter(
    s => s.kind !== "evidence_coverage" && s.kind !== "volatility",
  );

  if (analyzableSignals.length > 0) {
    const avgConfidence = analyzableSignals.reduce((sum, s) => sum + s.confidence, 0) / analyzableSignals.length;
    const maxSampleSize = Math.max(
      ...analyzableSignals.map(s => s.sampleSize.p22CalibrationCount + s.sampleSize.p23ReplayCount),
    );

    let label: ConfidenceBandLabel;
    if (avgConfidence >= 0.8 && maxSampleSize >= 30) {
      label = "high_confidence_drift";
    } else if (avgConfidence >= 0.5 && maxSampleSize >= 10) {
      label = "moderate_confidence_drift";
    } else if (maxSampleSize > 0) {
      label = "low_confidence_drift";
    } else {
      label = "insufficient_evidence";
    }

    // If no drift signals of concern and no volatility/coverage issues, it's neutral_or_stable
    const hasDriftSignal = analyzableSignals.some(s => s.severity === "medium" || s.severity === "high");
    if (!hasDriftSignal && !hasInsufficientEvidence && volatilitySignals.length === 0) {
      label = "neutral_or_stable";
    }

    bands.push({
      label,
      windowStart,
      windowEnd,
      confidence: Math.round(avgConfidence * 100) / 100,
      signalCount: analyzableSignals.length,
      rationale: [
        `${analyzableSignals.length} analyzable signal(s) with average confidence ${Math.round(avgConfidence * 100)}%.`,
        `Maximum combined sample size: ${maxSampleSize}.`,
        label === "neutral_or_stable"
          ? "No significant policy drift detected within confidence bounds."
          : `Classification: ${label}.`,
      ],
    });
  }

  // ---- Ensure at least one band exists ----
  if (bands.length === 0) {
    bands.push({
      label: "neutral_or_stable",
      windowStart,
      windowEnd,
      confidence: 1,
      signalCount: 0,
      rationale: ["No signals indicating policy drift or volatility."],
    });
  }

  // ---- Deterministic sort: most confident first ----
  bands.sort((a, b) => b.confidence - a.confidence || a.label.localeCompare(b.label));

  return bands;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/governance/calibration-confidence-bands.test.ts`
Expected: PASS

- [ ] **Step 5: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/governance/calibration-confidence-bands.ts tests/governance/calibration-confidence-bands.test.ts
git commit -m "feat(P24.3): governance confidence bands — evidence certainty classification

6 evidence-certainty labels (high_confidence / moderate_confidence /
low_confidence / insufficient_evidence / volatile_or_unstable / neutral_or_stable).
No actionable-urgency labels. Pure function, no stores, no mutation.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: P24.4 — Calibration Report (calibration-report.ts)

**Files:**
- Create: `src/governance/calibration-report.ts`
- Test: `tests/governance/calibration-report.test.ts`

**Interfaces:**
- Consumes: `PolicyDriftSignal[]` from Task 2, `CalibrationConfidenceBand[]` from Task 3
- Produces: `buildCalibrationReport(signals, bands)` → `CalibrationReport`, `renderCalibrationReportText()` / `renderCalibrationReportJson()` — consumed by Task 5

- [ ] **Step 1: Write the failing tests**

Create `tests/governance/calibration-report.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCalibrationReport, renderCalibrationReportText } from "../../src/governance/calibration-report.js";
import type { PolicyDriftSignal } from "../../src/governance/policy-drift-types.js";
import type { CalibrationConfidenceBand } from "../../src/governance/calibration-confidence-bands.js";

const ISO = "2026-07-08T18:00:00.000Z";

function signal(overrides: Partial<PolicyDriftSignal> = {}): PolicyDriftSignal {
  return {
    signalId: "p24-cs:abc123",
    kind: "calibration_skew",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z",
    direction: "too_loose",
    severity: "medium",
    confidence: 0.7,
    sampleSize: { p22CalibrationCount: 20, p23ReplayCount: 15, pairedLifecycleCount: 10 },
    rates: { overconfidentRate: 0.65 },
    implicatedPolicyAreas: [],
    evidenceRefs: [],
    rationale: ["Overconfidence rate 0.65 across 20 calibrations."],
    ...overrides,
  };
}

function band(overrides: Partial<CalibrationConfidenceBand> = {}): CalibrationConfidenceBand {
  return {
    label: "moderate_confidence_drift",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z",
    confidence: 0.7,
    signalCount: 1,
    rationale: ["1 analyzable signal with average confidence 70%."],
    ...overrides,
  };
}

describe("buildCalibrationReport", () => {

  it("empty signals produce empty report", () => {
    const report = buildCalibrationReport([], []);
    assert.equal(report.signals.length, 0);
    assert.equal(report.bands.length, 0);
    assert.ok(report.readOnly);
    assert.ok(report.noPolicyMutation);
  });

  it("includes boundary flags on report", () => {
    const report = buildCalibrationReport([signal()], [band()]);
    assert.equal(report.readOnly, true);
    assert.equal(report.noPolicyMutation, true);
    assert.equal(report.noThresholdChange, true);
    assert.equal(report.noAutoAdoption, true);
    assert.equal(report.noRanking, true);
  });

  it("includes signals and bands", () => {
    const s = signal();
    const b = band();
    const report = buildCalibrationReport([s], [b]);
    assert.equal(report.signals.length, 1);
    assert.equal(report.bands.length, 1);
    assert.equal(report.signals[0]!.signalId, s.signalId);
    assert.equal(report.bands[0]!.label, b.label);
  });

  it("includes window metadata", () => {
    const report = buildCalibrationReport([signal()], [band()]);
    assert.ok(report.generatedAt);
  });
});

describe("renderCalibrationReportText", () => {

  it("produces text output with expected structure", () => {
    const report = buildCalibrationReport([signal()], [band()]);
    const text = renderCalibrationReportText(report);
    assert.ok(text.includes("P24-CALIBRATION-START"));
    assert.ok(text.includes("P24-CALIBRATION-END"));
    assert.ok(text.includes("calibration_skew"));
    assert.ok(text.includes("moderate_confidence_drift"));
    assert.ok(text.includes("readOnly"));
  });

  it("empty report renders cleanly", () => {
    const report = buildCalibrationReport([], []);
    const text = renderCalibrationReportText(report);
    assert.ok(text.includes("No calibration signals"));
  });

  it("JSON output produces parseable JSON", () => {
    const report = buildCalibrationReport([signal()], [band()]);
    const json = JSON.stringify(report, null, 2);
    const parsed = JSON.parse(json);
    assert.equal(parsed.signals.length, 1);
    assert.equal(parsed.bands.length, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/governance/calibration-report.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the calibration report implementation**

Create `src/governance/calibration-report.ts`:

```typescript
/**
 * P24.4 — Calibration Report Builder.
 *
 * Pure function: turns PolicyDriftSignal[] + CalibrationConfidenceBand[] into
 * a structured read-only report with text and JSON output. No stores, no CLI,
 * no audit emitters.
 */

import type { PolicyDriftSignal } from "./policy-drift-types.js";
import type { CalibrationConfidenceBand } from "./calibration-confidence-bands.js";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const START_DELIM = "P24-CALIBRATION-START";
const END_DELIM = "P24-CALIBRATION-END";

const FOOTER =
  "P24 calibration report is read-only. No policy, approval, readiness, handoff,\n" +
  "closure, audit, or execution state was mutated. Calibration drift signals\n" +
  "are advisory and require governed human review before any future adoption.\n" +
  "No policy was changed. No threshold was changed. No operator was ranked.\n" +
  "No recommendations were auto-adopted.";

const BOUNDARY_FLAGS = {
  readOnly: true as const,
  noPolicyMutation: true as const,
  noThresholdChange: true as const,
  noAutoAdoption: true as const,
  noRanking: true as const,
};

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface CalibrationReport {
  reportId: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  signals: ReadonlyArray<{
    signalId: string;
    kind: string;
    direction: string;
    severity: string;
    confidence: number;
    sampleSize: { p22CalibrationCount: number; p23ReplayCount: number; pairedLifecycleCount: number };
    rates: Record<string, number | undefined>;
    rationale: readonly string[];
  }>;
  bands: ReadonlyArray<{
    label: string;
    confidence: number;
    signalCount: number;
    rationale: readonly string[];
  }>;
  readonly readOnly: true;
  readonly noPolicyMutation: true;
  readonly noThresholdChange: true;
  readonly noAutoAdoption: true;
  readonly noRanking: true;
  footer: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Build report
// ---------------------------------------------------------------------------

export function buildCalibrationReport(
  signals: PolicyDriftSignal[],
  bands: CalibrationConfidenceBand[],
  opts?: { generatedAt?: string; windowStart?: string; windowEnd?: string },
): CalibrationReport {
  const windowStart = opts?.windowStart ?? (signals.length > 0 ? signals[0]!.windowStart : "");
  const windowEnd = opts?.windowEnd ?? (signals.length > 0 ? signals[0]!.windowEnd : "");

  return {
    reportId: createHash("sha256").update(["p24-cal", windowStart, windowEnd, String(signals.length), String(bands.length)].join("|")).digest("hex").slice(0, 16),
    generatedAt: opts?.generatedAt ?? now(),
    windowStart,
    windowEnd,
    signals: signals.map(s => ({
      signalId: s.signalId,
      kind: s.kind,
      direction: s.direction,
      severity: s.severity,
      confidence: s.confidence,
      sampleSize: { ...s.sampleSize },
      rates: { ...s.rates },
      rationale: [...s.rationale],
    })),
    bands: bands.map(b => ({
      label: b.label,
      confidence: b.confidence,
      signalCount: b.signalCount,
      rationale: [...b.rationale],
    })),
    ...BOUNDARY_FLAGS,
    footer: FOOTER,
  };
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

export function renderCalibrationReportText(report: CalibrationReport): string {
  let out = "";

  out += `${START_DELIM}\n`;
  out += "Calibration Report — Governance Policy Drift\n";
  out += "=".repeat(50) + "\n";

  out += `\n  Report ID: ${report.reportId}`;
  out += `\n  Window: ${report.windowStart} → ${report.windowEnd}`;
  out += `\n  Generated: ${report.generatedAt}`;

  // Signals section
  out += "\n\n  Signals (" + report.signals.length + ")\n";
  if (report.signals.length === 0) {
    out += "    No calibration signals detected in this window.\n";
  } else {
    for (const s of report.signals) {
      out += `\n  [${s.kind}] ${s.direction} (${s.severity})\n`;
      out += `    Confidence: ${s.confidence}\n`;
      out += `    Sample: P22=${s.sampleSize.p22CalibrationCount} P23=${s.sampleSize.p23ReplayCount} paired=${s.sampleSize.pairedLifecycleCount}\n`;
      for (const r of s.rationale) {
        out += `    ${r}\n`;
      }
    }
  }

  // Bands section
  out += "\n  Confidence Bands (" + report.bands.length + ")\n";
  if (report.bands.length === 0) {
    out += "    No confidence bands computed.\n";
  } else {
    for (const b of report.bands) {
      out += `\n  [${b.label}] confidence=${b.confidence} signals=${b.signalCount}\n`;
      for (const r of b.rationale) {
        out += `    ${r}\n`;
      }
    }
  }

  // Footer
  out += `\n${END_DELIM}\n`;
  out += `---\n${FOOTER}\n`;

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/governance/calibration-report.test.ts`
Expected: PASS

- [ ] **Step 5: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/governance/calibration-report.ts tests/governance/calibration-report.test.ts
git commit -m "feat(P24.4): calibration report builder — text + JSON output

Pure report builder composing PolicyDriftSignal[] + CalibrationConfidenceBand[].
Boundary flags on external outputs. No stores, no mutation, no fs.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: P24.4 — DriftFinding Adapter (drift-finding-adapter.ts)

**Files:**
- Create: `src/governance/drift-finding-adapter.ts`
- Test: `tests/governance/drift-finding-adapter.test.ts`

**Interfaces:**
- Consumes: `PolicyDriftSignal[]` from Task 2, `DriftFinding` from `../../src/governance/governance-types.js` (import type only)
- Produces: `toDriftFindings(signals)` → `DriftFinding[]` with `driftType: "policy_drift"` — consumed by Task 6 (CLI)

- [ ] **Step 1: Write the failing tests**

Create `tests/governance/drift-finding-adapter.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toDriftFindings } from "../../src/governance/drift-finding-adapter.js";
import type { PolicyDriftSignal } from "../../src/governance/policy-drift-types.js";

function signal(overrides: Partial<PolicyDriftSignal> = {}): PolicyDriftSignal {
  return {
    signalId: "p24-cs:abc123",
    kind: "calibration_skew",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z",
    direction: "too_loose",
    severity: "medium",
    confidence: 0.7,
    sampleSize: { p22CalibrationCount: 20, p23ReplayCount: 15, pairedLifecycleCount: 10 },
    rates: { overconfidentRate: 0.65 },
    implicatedPolicyAreas: [],
    evidenceRefs: [],
    rationale: ["Overconfidence rate 0.65 across 20 calibrations."],
    ...overrides,
  };
}

describe("toDriftFindings", () => {

  it("empty signals produce empty findings", () => {
    const findings = toDriftFindings([]);
    assert.equal(findings.length, 0);
  });

  it("maps PolicyDriftSignal to DriftFinding with policy_drift category", () => {
    const findings = toDriftFindings([signal()]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.driftType, "policy_drift");
  });

  it("preserves severity from signal to finding", () => {
    const findings = toDriftFindings([signal({ severity: "high" })]);
    assert.equal(findings[0]!.severity, "high");
  });

  it("maps rationale as finding description", () => {
    const s = signal({ rationale: ["Overconfidence rate 0.65."] });
    const findings = toDriftFindings([s]);
    assert.ok(findings[0]!.description.includes("Overconfidence rate 0.65"));
  });

  it("maps evidenceRefs into finding evidenceRefs", () => {
    const s = signal({
      evidenceRefs: [{
        source: "p22_calibration",
        handoffId: "ho-1",
        lifecycleId: "lc-1",
        basis: "Test basis",
      }],
    });
    const findings = toDriftFindings([s]);
    assert.equal(findings[0]!.evidenceRefs.length, 1);
  });

  it("skips signals with severity 'none'", () => {
    const findings = toDriftFindings([
      signal({ signalId: "s-1", severity: "none" }),
      signal({ signalId: "s-2", severity: "medium" }),
    ]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.severity, "medium");
    assert.ok(findings[0]!.description.includes("calibration_skew"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/governance/drift-finding-adapter.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the adapter implementation**

Create `src/governance/drift-finding-adapter.ts`:

```typescript
/**
 * P24.4 — DriftFinding Adapter.
 *
 * Maps PolicyDriftSignal[] into DriftFinding-compatible output projection.
 * Only signals with severity "low", "medium", or "high" are projected.
 *
 * This adapter does not write to any store. It produces a projection that
 * the CLI/report layer may optionally present alongside P9.0d output.
 *
 * The adapter is NOT a P9.0d dependency. P9.0d remains unchanged.
 */

import type { PolicyDriftSignal } from "./policy-drift-types.js";
import type { DriftFinding } from "./governance-types.js";

// ---------------------------------------------------------------------------
// toDriftFindings
// ---------------------------------------------------------------------------

export function toDriftFindings(signals: PolicyDriftSignal[]): DriftFinding[] {
  const findings: DriftFinding[] = [];

  for (const signal of signals) {
    // Skip signals with severity "none" — they carry no actionable information
    if (signal.severity === "none") continue;

    const evidenceRefs = signal.evidenceRefs.map(r => r.basis ?? `${r.source}:${r.handoffId ?? r.replayId ?? r.lifecycleId ?? ""}`);

    findings.push({
      driftType: "policy_drift",
      detectedAt: signal.windowEnd,
      severity: signal.severity === "high" ? "high" as const : signal.severity === "medium" ? "medium" as const : "low" as const,
      confidence: signal.confidence,
      evidenceRefs,
      description: `${signal.kind} — ${signal.direction} (severity: ${signal.severity})`,
      recommendation:
        "No policy change is proposed. This policy_drift projection is read-only " +
        "and may be reviewed through the governed human process.",
    });
  }

  // Deterministic sort: severity order (high first) → detection time
  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => {
    const sa = severityOrder[a.severity] ?? 99;
    const sb = severityOrder[b.severity] ?? 99;
    if (sa !== sb) return sa - sb;
    return a.detectedAt.localeCompare(b.detectedAt);
  });

  return findings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/governance/drift-finding-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/governance/drift-finding-adapter.ts tests/governance/drift-finding-adapter.test.ts
git commit -m "feat(P24.4): drift-finding adapter — PolicyDriftSignal → DriftFinding

Projects P24 policy drift signals into DriftFinding-compatible output
with category policy_drift. Skips severity 'none' signals. No store writes.
P9.0d unchanged.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: P24.4 — CLI Handler (governance-calibration.ts) + Dispatch

**Files:**
- Create: `src/cli/commands/governance-calibration.ts`
- Modify: `src/cli/commands/governance.ts` (add `case "calibration"` dispatch)
- Test: `tests/governance/calibration-cli.test.ts`

**Interfaces:**
- Consumes: `detectPolicyDrift()` from Task 2, `buildConfidenceBands()` from Task 3, `buildCalibrationReport()` / `renderCalibrationReportText()` from Task 4, `toDriftFindings()` from Task 5
- Produces: CLI handler wired into `alix governance calibration {detect|report|bands}`

- [ ] **Step 1: Write the failing CLI tests**

Create `tests/governance/calibration-cli.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleGovernanceCalibrationCommand } from "../../src/cli/commands/governance-calibration.js";

describe("handleGovernanceCalibrationCommand", () => {

  it("returns usage when no subcommand given", () => {
    const result = handleGovernanceCalibrationCommand([], { cwd: "/tmp" });
    assert.ok(result.includes("usage"));
  });

  it("returns error when --input is missing", () => {
    const result = handleGovernanceCalibrationCommand(["detect"], { cwd: "/tmp" });
    assert.ok(result.includes("ERROR"));
    assert.ok(result.includes("--input"));
  });

  it("returns error for non-existent input file", () => {
    const result = handleGovernanceCalibrationCommand(["report", "--input", "/tmp/nonexistent.json"], { cwd: "/tmp" });
    assert.ok(result.includes("ERROR"));
  });

  it("handles report --json with empty bundle", () => {
    // Write a minimal empty bundle to a temp location
    const fs = require("node:fs");
    const bundlePath = "/tmp/p24-empty-bundle.json";
    fs.writeFileSync(bundlePath, JSON.stringify({
      calibrations: [],
      replayDiffs: [],
      candidateLessons: [],
      readOnly: true,
    }));
    const result = handleGovernanceCalibrationCommand(
      ["report", "--json", "--input", bundlePath],
      { cwd: "/tmp" },
    );
    const parsed = JSON.parse(result);
    assert.ok(parsed.signals !== undefined);
    assert.equal(parsed.signals.length, 0);
  });

  it("handles bands with empty bundle", () => {
    const result = handleGovernanceCalibrationCommand(
      ["bands", "--input", "/tmp/p24-empty-bundle.json"],
      { cwd: "/tmp" },
    );
    assert.ok(result);
  });

  it("handles --input with --window flag", () => {
    const result = handleGovernanceCalibrationCommand(
      ["detect", "--input", "/tmp/p24-empty-bundle.json", "--window", "90"],
      { cwd: "/tmp" },
    );
    assert.ok(result);
  });

  it("rejects unknown subcommand", () => {
    const result = handleGovernanceCalibrationCommand(["unknown"], { cwd: "/tmp" });
    assert.ok(result.includes("usage"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/governance/calibration-cli.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the CLI handler**

Create `src/cli/commands/governance-calibration.ts`:

```typescript
/**
 * P24.4 — Governance Calibration CLI Handler.
 *
 * `alix governance calibration` subcommands:
 *   detect   — run policy drift detector over P22/P23 data
 *   report   — full calibration report (text or JSON)
 *   bands    — confidence bands only
 *
 * CLI invariants:
 *   - read-only: no writes to governance stores
 *   - no audit emitters
 *   - no execution adapters
 *   - no policy/readiness/approval/handoff/closure writers
 *   - no auto-adoption or auto-close
 *   - no operator ranking
 *   - no policy recommendations or threshold-change proposals
 */

import { readFileSync, existsSync } from "node:fs";
import { detectPolicyDrift } from "../../governance/policy-drift.js";
import type { CalibrationInput, ReplayDiffInput, CandidateLessonInput } from "../../governance/policy-drift.js";
import { buildConfidenceBands } from "../../governance/calibration-confidence-bands.js";
import { buildCalibrationReport, renderCalibrationReportText } from "../../governance/calibration-report.js";
import { toDriftFindings } from "../../governance/drift-finding-adapter.js";

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

function now(): string {
  return new Date().toISOString();
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Bundle readers (CLI boundary — owns fs access)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Input bundle format
// ---------------------------------------------------------------------------

export interface CalibrationInputBundle {
  calibrations: CalibrationInput[];
  replayDiffs: ReplayDiffInput[];
  candidateLessons: CandidateLessonInput[];
  /** Optional previous-window data for trend detection */
  previousWindow?: {
    windowStart: string;
    windowEnd: string;
    calibrations: CalibrationInput[];
  };
  // Boundary marker — P24 reads, never writes
  readonly readOnly: true;
}

function loadInputBundle(filePath: string): CalibrationInputBundle | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as CalibrationInputBundle;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Detect handler
// ---------------------------------------------------------------------------

function handleDetect(args: string[], cwd: string): string {
  const inputPath = flag(args, "--input");
  if (!inputPath) {
    return "ERROR: --input <path> is required. Provide a P24 input bundle JSON file.\n" + usage();
  }

  const bundle = loadInputBundle(inputPath);
  if (!bundle) {
    return "ERROR: Could not load input bundle. Verify the file exists and is valid JSON.\n" + usage();
  }

  const windowFlag = flag(args, "--window");
  const windowDays = windowFlag ? parseInt(windowFlag, 10) : 90;
  const since = flag(args, "--since") ?? isoDaysAgo(windowDays);
  const until = flag(args, "--until") ?? now();

  const signals = detectPolicyDrift({
    calibrations: bundle.calibrations,
    replayDiffs: bundle.replayDiffs,
    candidateLessons: bundle.candidateLessons,
    windowStart: since,
    windowEnd: until,
    previousWindowStart: bundle.previousWindow?.windowStart,
    previousWindowEnd: bundle.previousWindow?.windowEnd,
    previousCalibrations: bundle.previousWindow?.calibrations,
  });

  const bands = buildConfidenceBands(signals, { windowStart: since, windowEnd: until });
  const findings = toDriftFindings(signals);

  // Text output
  let out = `P24-DETECT-START\n`;
  out += `Policy Drift Detection — ${windowDays}d window\n`;
  out += `Window: ${since} → ${until}\n`;
  out += `Signals: ${signals.length}\n`;
  for (const s of signals) {
    out += `  [${s.kind}] ${s.direction} (${s.severity}) conf=${s.confidence}\n`;
  }
  out += `\nBands:\n`;
  for (const b of bands) {
    out += `  [${b.label}] conf=${b.confidence} signals=${b.signalCount}\n`;
  }
  out += `\nDriftFindings: ${findings.length}\n`;
  for (const f of findings) {
    out += `  policy_drift: ${f.severity} — ${f.description}\n`;
  }
  out += `P24-DETECT-END\n`;

  return out;
}

// ---------------------------------------------------------------------------
// Report handler
// ---------------------------------------------------------------------------

function handleReport(args: string[], cwd: string): string {
  const inputPath = flag(args, "--input");
  if (!inputPath) {
    return "ERROR: --input <path> is required.\n" + usage();
  }

  const bundle = loadInputBundle(inputPath);
  if (!bundle) {
    return "ERROR: Could not load input bundle.\n" + usage();
  }

  const windowFlag = flag(args, "--window");
  const windowDays = windowFlag ? parseInt(windowFlag, 10) : 90;
  const since = flag(args, "--since") ?? isoDaysAgo(windowDays);
  const until = flag(args, "--until") ?? now();

  const signals = detectPolicyDrift({
    calibrations: bundle.calibrations,
    replayDiffs: bundle.replayDiffs,
    candidateLessons: bundle.candidateLessons,
    windowStart: since,
    windowEnd: until,
  });

  const bands = buildConfidenceBands(signals, { windowStart: since, windowEnd: until });
  const report = buildCalibrationReport(signals, bands, { windowStart: since, windowEnd: until });

  if (hasFlag(args, "--json")) {
    return JSON.stringify(report, null, 2) + "\n";
  }

  return renderCalibrationReportText(report);
}

// ---------------------------------------------------------------------------
// Bands handler
// ---------------------------------------------------------------------------

function handleBands(args: string[], cwd: string): string {
  const inputPath = flag(args, "--input");
  if (!inputPath) {
    return "ERROR: --input <path> is required.\n" + usage();
  }

  const bundle = loadInputBundle(inputPath);
  if (!bundle) {
    return "ERROR: Could not load input bundle.\n" + usage();
  }

  const windowFlag = flag(args, "--window");
  const windowDays = windowFlag ? parseInt(windowFlag, 10) : 90;
  const since = flag(args, "--since") ?? isoDaysAgo(windowDays);
  const until = flag(args, "--until") ?? now();

  const signals = detectPolicyDrift({
    calibrations: bundle.calibrations,
    replayDiffs: bundle.replayDiffs,
    candidateLessons: bundle.candidateLessons,
    windowStart: since,
    windowEnd: until,
  });

  const bands = buildConfidenceBands(signals, { windowStart: since, windowEnd: until });

  if (hasFlag(args, "--json")) {
    return JSON.stringify(bands, null, 2) + "\n";
  }

  let out = `P24-BANDS-START\n`;
  out += `Confidence Bands — ${windowDays}d window\n`;
  out += `Window: ${since} → ${until}\n`;
  for (const b of bands) {
    out += `\n[${b.label}]\n`;
    out += `  confidence: ${b.confidence}\n`;
    out += `  signals: ${b.signalCount}\n`;
    for (const r of b.rationale) {
      out += `  ${r}\n`;
    }
  }
  out += `P24-BANDS-END\n`;

  return out;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function usage(): string {
  return (
    "usage: alix governance calibration {detect|report|bands} --input <bundle.json> [--window N] [--since <iso>] [--until <iso>] [--json]\n" +
    "\n" +
    "Subcommands:\n" +
    "  detect      Run policy drift detector, show signal summary\n" +
    "  report      Full calibration report (text, or --json for JSON)\n" +
    "  bands       Confidence bands only (text, or --json for JSON)\n" +
    "\n" +
    "Flags:\n" +
    "  --input     Path to P24 input bundle JSON (calibrations + replay diffs)\n" +
    "  --window N  Look back N days (default: 90)\n" +
    "  --since     Explicit window start (overrides --window)\n" +
    "  --until     Explicit window end (default: now)\n" +
    "  --json      JSON output (report and bands only)\n"
  );
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

export function handleGovernanceCalibrationCommand(args: string[], opts: { cwd: string }): string {
  const cwd = opts.cwd;
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help") {
    return usage();
  }

  switch (subcommand) {
    case "detect":
      return handleDetect(args.slice(1), cwd);
    case "report":
      return handleReport(args.slice(1), cwd);
    case "bands":
      return handleBands(args.slice(1), cwd);
    default:
      return usage();
  }
}
```

- [ ] **Step 4: Wire dispatch in governance.ts**

Read `src/cli/commands/governance.ts` and find the subcommand switch. Add after the `case "replay"` block:

```typescript
    case "calibration": {
      const { handleGovernanceCalibrationCommand } = await import("./governance-calibration.js");
      return handleGovernanceCalibrationCommand(args.slice(1), { cwd });
    }
```

- [ ] **Step 5: Run CLI tests to verify they pass**

Run: `node --test tests/governance/calibration-cli.test.ts`
Expected: PASS

- [ ] **Step 6: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/governance-calibration.ts src/cli/commands/governance.ts tests/governance/calibration-cli.test.ts
git commit -m "feat(P24.4): calibration CLI — detect|report|bands subcommands

Adds alix governance calibration {detect|report|bands} with --window,
--since, --until, and --json flags. CLI handler reads P22/P23 records
from filesystem, runs detector/builders, renders text or JSON output.
No store writes, no execution adapters, no policy mutation.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: P24.5 — Checkpoint

**Files:**
- Create: `docs/architecture/checkpoints/2026-07-09-p24-5-governance-calibration-policy-drift-intelligence-checkpoint.md`

- [ ] **Step 1: Write the checkpoint doc**

Create `docs/architecture/checkpoints/2026-07-09-p24-5-governance-calibration-policy-drift-intelligence-checkpoint.md`:

```markdown
# P24 — Governance Calibration & Policy Drift Intelligence Checkpoint

**Date:** 2026-07-09
**Phase:** P24 — Governance Calibration & Policy Drift Intelligence
**Checkpoint tag:** `alix-p24-governance-calibration-policy-drift-intelligence-complete`

## Verification Checklist

### No execution

- [ ] No autonomous execution, background jobs, or scheduled watchers
- [ ] No shell, network, MCP, browser, fetch, or subprocess calls
- [ ] No execution adapters, executor imports, or tool invocations

### No mutation

- [ ] No policy mutation or readiness threshold mutation
- [ ] No approval, handoff, closure review, or audit event mutation
- [ ] No P24 outputs persisted as live governance state
- [ ] All CLI reads are read-only (fs readFileSync only for existing records)

### No ranking

- [ ] No operator ranking, productivity scoring, or leaderboard
- [ ] No operator identity in signal outputs

### No auto-adoption

- [ ] No auto-adoption of calibration findings
- [ ] No auto-close of reviews or handoffs
- [ ] No bypass around P14–P23

### No policy recommendations

- [ ] No exact threshold change proposals ("change X from 0.72 to 0.81")
- [ ] No auto-applicable remediation proposals
- [ ] No rewriting of policy text

### Downstream layers unchanged

- [ ] P9.0d GovernanceDriftDetector unchanged
- [ ] P22 handoff-readiness-calibration unchanged
- [ ] P22 handoff-intelligence-types unchanged
- [ ] P23 replay/types unchanged
- [ ] P23 replay/ modules unchanged
- [ ] P9.0d DriftFinding type consumed but not modified

### Signal model integrity

- [ ] PolicyDriftSignal remains separate from DriftFinding (not the same shape)
- [ ] DriftFinding adapter is the only projection path
- [ ] No P9.0d dependency to define/detect/justify policy drift

### Tests

- [ ] All 47 P24 tests pass
- [ ] All pre-existing governance tests pass
- [ ] tsc clean

## Seal Statement

```text
P24 — Governance Calibration & Policy Drift Intelligence ✅ SEALED

ALiX can now:
- detect calibration skew from P22 calibration distribution
- detect replay divergence from P23 counterfactual disagreement patterns
- detect convergent gaps where P22 + P23 converge on same lifecycle
- track trend direction between windows
- guard against low-sample findings via evidence coverage
- detect volatile/non-directional signal swings
- classify calibration confidence into evidence-certainty bands
- emit DriftFinding-compatible policy_drift projections
- produce read-only calibration reports and CLI output

ALiX still cannot:
- execute actions or background watchers
- mutate policy or readiness thresholds
- rank operators
- auto-adopt recommendations
- propose exact threshold changes
- bypass P14–P23 governance phases
```

## Tag

```text
git tag alix-p24-governance-calibration-policy-drift-intelligence-complete
```
```

- [ ] **Step 2: Run full test suite**

Run: `node --test tests/governance/`
Expected: All 26 P24 tests + all pre-existing tests pass

- [ ] **Step 3: Final tsc check**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 4: Commit checkpoint doc**

```bash
git add docs/architecture/checkpoints/2026-07-09-p24-5-governance-calibration-policy-drift-intelligence-checkpoint.md
git commit -m "docs(P24.5): governance calibration checkpoint — boundary verification

Verifies: no execution, no mutation, no ranking, no auto-adoption,
no policy recommendations, P9.0d/P22/P23 unchanged,
PolicyDriftSignal ≠ DriftFinding signal model integrity.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Summary

| Slice | Files Created | Tests | Commit |
|-------|--------------|-------|--------|
| P24.1 | 2 | 10 | `feat(P24.1): calibration signal model — types, directions, thresholds` |
| P24.2 | 2 | 10 | `feat(P24.2): policy drift detector — 4-layer aggregation` |
| P24.3 | 2 | 6 | `feat(P24.3): governance confidence bands — evidence certainty classification` |
| P24.4 (report) | 2 | 4 | `feat(P24.4): calibration report builder — text + JSON output` |
| P24.4 (adapter) | 2 | 6 | `feat(P24.4): drift-finding adapter — PolicyDriftSignal → DriftFinding` |
| P24.4 (CLI) | 2+1 touch | 7 | `feat(P24.4): calibration CLI — detect|report|bands subcommands` |
| P24.5 | 1 | — | `docs(P24.5): governance calibration checkpoint` |
| **Total** | **14 files** | **47 tests** | **7 commits** |
