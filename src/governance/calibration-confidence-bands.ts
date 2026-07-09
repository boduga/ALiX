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
