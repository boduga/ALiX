/**
 * P8.3 — GovernanceCalibrationBuilder.
 *
 * Measures which governance lenses provide predictive value vs. noise,
 * and produces calibration signals and profiles.
 *
 * Pure computation — no I/O, no store access, no side effects.
 *
 * @module
 */

import type { LearningSignal, CalibrationProfile } from "./learning-types.js";
import type {
  LensCalibrationEntry,
  LensCalibrationReport,
} from "../adaptation/outcome-types.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Minimum reviews before a lens signal is meaningful. */
const DEFAULT_MIN_REVIEWS = 5;

/** Predictive value above this is "high" (useful lens). */
const DEFAULT_HIGH_PV_THRESHOLD = 0.7;

/** Predictive value below this is "low" (noisy lens). */
const DEFAULT_LOW_PV_THRESHOLD = 0.5;

/** False positive rate above this is a concern. */
const DEFAULT_FP_THRESHOLD = 0.4;

/** Miss rate above this is a concern. */
const DEFAULT_MISS_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export class GovernanceCalibrationBuilder {
  private readonly minReviews: number;
  private readonly highPvThreshold: number;
  private readonly lowPvThreshold: number;
  private readonly fpThreshold: number;
  private readonly missThreshold: number;

  constructor(opts?: {
    minReviews?: number;
    highPvThreshold?: number;
    lowPvThreshold?: number;
    fpThreshold?: number;
    missThreshold?: number;
  }) {
    this.minReviews = opts?.minReviews ?? DEFAULT_MIN_REVIEWS;
    this.highPvThreshold = opts?.highPvThreshold ?? DEFAULT_HIGH_PV_THRESHOLD;
    this.lowPvThreshold = opts?.lowPvThreshold ?? DEFAULT_LOW_PV_THRESHOLD;
    this.fpThreshold = opts?.fpThreshold ?? DEFAULT_FP_THRESHOLD;
    this.missThreshold = opts?.missThreshold ?? DEFAULT_MISS_THRESHOLD;
  }

  /**
   * Analyze a lens calibration report and produce governance signals.
   *
   * @param report  The lens calibration report from P7c.
   * @param sourceReportId  Source identifier for signal provenance.
   * @param generatedAt    ISO timestamp for output artifacts.
   */
  calibrate(
    report: LensCalibrationReport,
    sourceReportId: string,
    generatedAt: string,
  ): { signals: LearningSignal[]; profiles: CalibrationProfile[] } {
    const signals: LearningSignal[] = [];
    const profiles: CalibrationProfile[] = [];

    for (const [lensName, entry] of Object.entries(report.lenses)) {
      if (entry.reviewsAnalyzed < this.minReviews) continue;

      // ---------------------------------------------------------------
      // High predictive value
      // ---------------------------------------------------------------
      if (entry.predictiveValue >= this.highPvThreshold) {
        const sig = this.makeSignal(
          "lens_high_predictive_value",
          lensName,
          entry,
          sourceReportId,
          generatedAt,
        );
        signals.push(sig);

        const profile = this.makeProfile(
          lensName,
          entry.predictiveValue,
          "increase",
          [sig.id],
          generatedAt,
        );
        if (profile) profiles.push(profile);
      }

      // ---------------------------------------------------------------
      // Low predictive value
      // ---------------------------------------------------------------
      if (entry.predictiveValue <= this.lowPvThreshold && entry.reviewsAnalyzed >= this.minReviews * 2) {
        // Require more samples for a "low value" determination to avoid
        // penalizing lenses with insufficient data.
        const sig = this.makeSignal(
          "lens_low_predictive_value",
          lensName,
          entry,
          sourceReportId,
          generatedAt,
        );
        signals.push(sig);

        const profile = this.makeProfile(
          lensName,
          entry.predictiveValue,
          "decrease",
          [sig.id],
          generatedAt,
        );
        if (profile) profiles.push(profile);
      }

      // ---------------------------------------------------------------
      // High false positive rate
      // ---------------------------------------------------------------
      if (entry.reviewsAnalyzed > 0) {
        const fpRate =
          entry.falseAlarms /
          (entry.concernsRaised > 0 ? entry.concernsRaised : 1);
        if (fpRate >= this.fpThreshold) {
          const sig = this.makeSignal(
            "lens_high_false_positive",
            lensName,
            entry,
            sourceReportId,
            generatedAt,
          );
          signals.push(sig);
        }
      }

      // ---------------------------------------------------------------
      // High miss rate
      // ---------------------------------------------------------------
      if (entry.reviewsAnalyzed > 0) {
        const missRate =
          entry.missedFailures /
          (entry.reviewsAnalyzed > 0 ? entry.reviewsAnalyzed : 1);
        if (missRate >= this.missThreshold) {
          const sig = this.makeSignal(
            "lens_high_miss_rate",
            lensName,
            entry,
            sourceReportId,
            generatedAt,
          );
          signals.push(sig);
        }
      }
    }

    return { signals, profiles };
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private signalConfidence(entry: LensCalibrationEntry): number {
    if (entry.reviewsAnalyzed >= 100) return 0.9;
    if (entry.reviewsAnalyzed >= 30) return 0.75;
    if (entry.reviewsAnalyzed >= 10) return 0.6;
    return 0.5;
  }

  private makeSignal(
    signalType: LearningSignal["signalType"],
    lensName: string,
    entry: LensCalibrationEntry,
    sourceReportId: string,
    generatedAt: string,
  ): LearningSignal {
    const labels: Record<string, string> = {
      lens_high_predictive_value: "high predictive value",
      lens_low_predictive_value: "low predictive value",
      lens_high_false_positive: "high false positive rate",
      lens_high_miss_rate: "high miss rate",
    };

    const label = labels[signalType] ?? signalType;
    const confidence = this.signalConfidence(entry);

    return {
      id: `ls-gov-${lensName}_${signalType}_${Date.now()}`,
      subject: `Lens "${lensName}" — ${label}`,
      outcome: "signal_detected",
      confidence,
      reasons: [
        `Predictive value: ${(entry.predictiveValue * 100).toFixed(0)}%`,
        `Reviews analyzed: ${entry.reviewsAnalyzed}`,
        `False alarms: ${entry.falseAlarms}`,
        `Missed failures: ${entry.missedFailures}`,
      ],
      generatedAt,
      sourceReportId,
      signalType,
      strength: entry.predictiveValue,
      summary: `Lens ${lensName}: PV=${(entry.predictiveValue * 100).toFixed(0)}%, FP=${entry.falseAlarms}, Miss=${entry.missedFailures}`,
      evidenceRefs: [],
    };
  }

  private makeProfile(
    lensName: string,
    predictiveValue: number,
    direction: "increase" | "decrease",
    sourceSignalIds: string[],
    generatedAt: string,
  ): CalibrationProfile | null {
    // Only produce profiles for significant deviations
    const deviation = Math.abs(predictiveValue - 0.5);
    if (deviation < 0.15) return null;

    const factor = direction === "increase"
      ? 1.0 + deviation
      : 1.0 - deviation;
    const clamped = parseFloat(Math.max(0.3, Math.min(1.5, factor)).toFixed(2));

    return {
      id: `cp-gov-${lensName}_${Date.now()}`,
      subject: `${direction === "increase" ? "Increase" : "Decrease"} "${lensName}" governance lens weight`,
      outcome: "suggested",
      confidence: 0.75,
      reasons: [
        `Predictive value: ${(predictiveValue * 100).toFixed(0)}% (deviation: ${(deviation * 100).toFixed(0)}pp)`,
      ],
      generatedAt,
      target: "governance_lens_weight",
      targetName: lensName,
      previousValue: 1.0,
      suggestedValue: clamped,
      reason: `Lens ${lensName} has ${(predictiveValue * 100).toFixed(0)}% predictive value (${direction} weight)`,
      evidenceRefs: sourceSignalIds,
      sourceSignalIds,
    };
  }
}
