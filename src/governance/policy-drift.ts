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

  // ---- Layer 1 -> calibration_skew signal ----
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
          basis: `Calibration: ${c.calibration} (readiness ${c.readinessLevel} -> ${c.closureDecision})`,
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

  // ---- Layer 1 -> replay_divergence signal ----
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
          basis: `Diff: ${d.category} (${d.field}: ${String(d.originalValue)} -> ${String(d.counterfactualValue)})`,
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
