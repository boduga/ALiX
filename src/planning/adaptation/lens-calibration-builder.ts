/**
 * P7c — LensCalibrationBuilder.
 *
 * Pure builder that measures reviewer quality — which governance lenses
 * produce useful signals. No I/O, no store access, no side effects.
 * Deterministic — same inputs always produce the same output.
 *
 * @module
 */

import type { LensName, GovernanceVerdict } from "./governance-review-types.js";
import type { OutcomeValue } from "./outcome-types.js";
import type { LensCalibrationReport, LensCalibrationEntry } from "./outcome-types.js";

// ---------------------------------------------------------------------------
// LensObservation — input shape
// ---------------------------------------------------------------------------

export interface LensObservation {
  lens: LensName;
  verdict: GovernanceVerdict;
  outcome: OutcomeValue;
  concernsRaised: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_LENSES: LensName[] = ["red_team", "historian", "policy_auditor", "confidence_critic"];

/**
 * Does this verdict represent a lens that raised a concern?
 * agree_with_concerns and challenge both indicate the lens saw something
 * worth flagging. agree and insufficient_information do not.
 *
 * EXPORTED so callers (governance-calibration-adapter, decision CLI) share
 * the same single rule instead of each redefining it.
 */
export function isWarningVerdict(v: GovernanceVerdict): boolean {
  return v === "agree_with_concerns" || v === "challenge";
}

/**
 * Map predictiveValue to a calibration tier.
 *
 * Thresholds:
 *   >= 0.7 → strong
 *   >= 0.4 → moderate
 *   >= 0.1 → weak
 *    < 0.1 or reviewsAnalyzed === 0 → insufficient_data
 */
function calibrationTier(predictiveValue: number, reviewsAnalyzed: number): LensCalibrationEntry["calibration"] {
  if (reviewsAnalyzed === 0) return "insufficient_data";
  if (predictiveValue >= 0.7) return "strong";
  if (predictiveValue >= 0.4) return "moderate";
  if (predictiveValue >= 0.1) return "weak";
  return "insufficient_data";
}

/**
 * Create a zeroed-out entry for a lens with no observations.
 */
function emptyEntry(): LensCalibrationEntry {
  return {
    reviewsAnalyzed: 0,
    concernsRaised: 0,
    concernsValidated: 0,
    falseAlarms: 0,
    missedFailures: 0,
    predictiveValue: 0,
    calibration: "insufficient_data",
  };
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export class LensCalibrationBuilder {
  /**
   * Build a lens calibration report from structured observations.
   *
   * Rules (per-lens aggregation):
   * - concernsRaised         = sum of concernsRaised where lens warned (agree_with_concerns or challenge)
   * - concernsValidated      = sum of concernsRaised where lens warned AND outcome is "failure"
   * - falseAlarms            = count where lens warned AND outcome is "success" or "partial_success"
   * - missedFailures         = count where lens did NOT warn AND outcome is "failure"
   * - reviewsAnalyzed        = count of observations for this lens
   * - predictiveValue        = concernsValidated / concernsRaised, or 0 if concernsRaised === 0
   *
   * @param observations  Lens observations from reviews with known outcomes.
   * @param options       Optional windowDays override and generatedAt timestamp.
   */
  build(
    observations: LensObservation[],
    options?: { windowDays?: number; generatedAt?: string },
  ): LensCalibrationReport {
    const windowDays = options?.windowDays ?? 30;
    const generatedAt = options?.generatedAt ?? new Date().toISOString();

    // Initialize per-lens accumulators
    const lenses: Record<LensName, LensCalibrationEntry> = {
      red_team: emptyEntry(),
      historian: emptyEntry(),
      policy_auditor: emptyEntry(),
      confidence_critic: emptyEntry(),
    };

    // Aggregate observations by lens
    for (const obs of observations) {
      const entry = lenses[obs.lens];
      entry.reviewsAnalyzed += 1;

      if (isWarningVerdict(obs.verdict)) {
        // Lens warned — accumulate concerns
        entry.concernsRaised += obs.concernsRaised;

        if (obs.outcome === "failure") {
          entry.concernsValidated += obs.concernsRaised;
        } else if (obs.outcome === "success" || obs.outcome === "partial_success") {
          entry.falseAlarms += 1;
        }
        // neutral / unknown — lens warned but outcome ambiguous; no credit/blame
      } else {
        // Lens did NOT warn (agree or insufficient_information)
        if (obs.outcome === "failure") {
          entry.missedFailures += 1;
        }
      }
    }

    // Compute predictiveValue and calibration for each lens
    const totalReviews = observations.length;
    let lensesWithData = 0;

    for (const lens of ALL_LENSES) {
      const entry = lenses[lens];
      entry.predictiveValue =
        entry.concernsRaised > 0
          ? entry.concernsValidated / entry.concernsRaised
          : 0;
      entry.calibration = calibrationTier(entry.predictiveValue, entry.reviewsAnalyzed);

      if (entry.reviewsAnalyzed > 0) lensesWithData += 1;
    }

    // Overall confidence: based on data sufficiency across lenses
    const confidence =
      totalReviews === 0
        ? 0
        : Math.min(1, lensesWithData / ALL_LENSES.length);

    const reasons: string[] = [];
    if (totalReviews === 0) {
      reasons.push("No observations available — all lenses have insufficient data.");
    } else {
      reasons.push(`${totalReviews} observation(s) across ${lensesWithData}/${ALL_LENSES.length} lens(es).`);
    }

    for (const lens of ALL_LENSES) {
      const e = lenses[lens];
      if (e.reviewsAnalyzed > 0) {
        const validated = e.concernsValidated;
        const raised = e.concernsRaised;
        reasons.push(
          `${lens}: ${e.reviewsAnalyzed} review(s), ${raised} concern(s) raised, ${validated} validated, ${e.falseAlarms} false alarm(s), ${e.missedFailures} missed — predictive value ${(e.predictiveValue * 100).toFixed(0)}% (${e.calibration})`,
        );
      }
    }

    return {
      id: `lens-calibration-${Date.now()}`,
      subject: "Lens Calibration Report",
      outcome: "computed",
      confidence,
      reasons,
      generatedAt,
      windowDays,
      lenses,
    };
  }
}
