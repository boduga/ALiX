import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectPolicyDrift, type CalibrationInput, type ReplayDiffInput, type CandidateLessonInput } from "../../src/governance/policy-drift.js";
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
}> = {}): CalibrationInput {
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
  } as CalibrationInput;
}

function diff(overrides: Partial<{
  category: string; sourceId: string; field: string;
  originalValue: unknown; counterfactualValue: unknown;
  lifecycleId: string;
}> = {}): ReplayDiffInput {
  return {
    category: "unchanged",
    sourceId: "src-1",
    field: "readinessLevel",
    originalValue: "dry_run_capable",
    counterfactualValue: "dry_run_capable",
    lifecycleId: "lc-1",
    ...overrides,
  } as ReplayDiffInput;
}

function lesson(overrides: Partial<{
  lessonId: string; summary: string; basis: string[];
  confidence: string; appliesTo: string; lifecycleId: string;
}> = {}): CandidateLessonInput {
  return {
    lessonId: "l-1",
    summary: "Readiness may have been overestimated",
    basis: ["missing evidence"],
    confidence: "medium",
    appliesTo: "readiness",
    lifecycleId: "lc-1",
    ...overrides,
  } as CandidateLessonInput;
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
    // Overconfident dropped from ~100% to 0% -> improvement, no volatility
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
