/**
 * P8.1 — RecommendationCalibrationBuilder.
 *
 * Detects overconfidence and underconfidence by comparing expected confidence
 * levels against observed outcome success rates per confidence bucket.
 *
 * Pure computation — no I/O, no store access, no side effects.
 *
 * Core invariant: Learning ≠ Mutation. Produces signals and profiles,
 * never applies them.
 *
 * @module
 */

import type { LearningSignal, CalibrationProfile } from "./learning-types.js";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/**
 * Observed accuracy for a single confidence bucket.
 *
 * Each bucket represents a range of recommendation confidence values
 * (e.g., 0.8–1.0) and the observed outcome rate for recommendations
 * that fell in that range.
 */
export interface ConfidenceBucketObservation {
  /** Human-readable label, e.g. "0.8-1.0". */
  bucketLabel: string;
  /** Midpoint of the confidence range, e.g. 0.90 for 0.8-1.0. */
  bucketMidpoint: number;
  /** Total recommendations in this bucket with known outcomes. */
  totalCount: number;
  /** Number of recommendations where outcome was "success". */
  successCount: number;
}

export interface CalibrationResult {
  signals: LearningSignal[];
  profiles: CalibrationProfile[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Minimum observations before a signal is considered meaningful. */
const DEFAULT_MIN_SAMPLES = 5;

/** Minimum absolute delta before a signal is emitted. */
const DEFAULT_DELTA_THRESHOLD = 0.1;

/**
 * Map sample count to signal confidence (simple heuristic).
 * Fewer samples → lower confidence.
 */
function sampleConfidence(n: number): number {
  if (n >= 100) return 0.95;
  if (n >= 50) return 0.85;
  if (n >= 20) return 0.70;
  if (n >= DEFAULT_MIN_SAMPLES) return 0.50;
  return 0;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export class RecommendationCalibrationBuilder {
  private readonly minSamples: number;
  private readonly deltaThreshold: number;

  constructor(opts?: { minSamples?: number; deltaThreshold?: number }) {
    this.minSamples = opts?.minSamples ?? DEFAULT_MIN_SAMPLES;
    this.deltaThreshold = opts?.deltaThreshold ?? DEFAULT_DELTA_THRESHOLD;
  }

  /**
   * Analyze confidence bucket observations and produce calibration signals.
   *
   * @param buckets  Observed accuracy per confidence bucket.
   * @param sourceReportId  The accuracy report ID that sourced this data.
   * @param generatedAt    ISO timestamp for the output artifacts.
   */
  calibrate(
    buckets: ConfidenceBucketObservation[],
    sourceReportId: string,
    generatedAt: string,
  ): CalibrationResult {
    const signals: LearningSignal[] = [];
    const profiles: CalibrationProfile[] = [];

    for (const bucket of buckets) {
      if (bucket.totalCount < this.minSamples) continue;

      const observedRate =
        bucket.totalCount > 0 ? bucket.successCount / bucket.totalCount : 0;
      const delta = observedRate - bucket.bucketMidpoint;

      if (Math.abs(delta) < this.deltaThreshold) continue;

      const confidence = sampleConfidence(bucket.totalCount);
      const isOverconfident = delta < 0;

      const signalType = isOverconfident
        ? ("overconfidence" as const)
        : ("underconfidence" as const);

      const direction = isOverconfident ? "lower than" : "higher than";
      const summary = `Bucket ${bucket.bucketLabel}: observed ${(observedRate * 100).toFixed(0)}% success rate, ${direction} expected ${(bucket.bucketMidpoint * 100).toFixed(0)}% confidence`;

      const signal: LearningSignal = {
        id: `ls-rec-${bucket.bucketLabel.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`,
        subject: `${isOverconfident ? "Over" : "Under"}confidence in bucket ${bucket.bucketLabel}`,
        outcome: "signal_detected",
        confidence,
        reasons: [
          `Expected ${(bucket.bucketMidpoint * 100).toFixed(0)}%, observed ${(observedRate * 100).toFixed(0)}% (delta: ${(delta * 100).toFixed(1)}pp)`,
          `Sample size: ${bucket.totalCount} outcomes`,
        ],
        generatedAt,
        sourceReportId,
        signalType,
        strength: Math.abs(delta),
        summary,
        evidenceRefs: [],
        delta: {
          expected: bucket.bucketMidpoint,
          observed: observedRate,
          unit: "rate",
        },
      };

      signals.push(signal);

      // Generate a calibration profile for significant over/underconfidence
      if (Math.abs(delta) >= this.deltaThreshold * 2) {
        const adjustment = isOverconfident
          ? observedRate / bucket.bucketMidpoint
          : Math.min(observedRate / bucket.bucketMidpoint, 1.5);

        // Clamp to reasonable range [0.5, 1.5]
        const clampedAdjustment = Math.max(0.5, Math.min(1.5, adjustment));

        const profile: CalibrationProfile = {
          id: `cp-rec-${bucket.bucketLabel.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`,
          subject: `${isOverconfident ? "Reduce" : "Increase"} confidence multiplier for bucket ${bucket.bucketLabel}`,
          outcome: "suggested",
          confidence,
          reasons: [
            `Delta: ${(delta * 100).toFixed(1)}pp over ${bucket.totalCount} samples`,
          ],
          generatedAt,
          target: "recommendation_confidence_multiplier",
          targetName: `confidence_multiplier_${bucket.bucketLabel}`,
          previousValue: 1.0,
          suggestedValue: parseFloat(clampedAdjustment.toFixed(2)),
          reason: summary,
          evidenceRefs: [signal.id],
          sourceSignalIds: [signal.id],
        };

        profiles.push(profile);
      }
    }

    return { signals, profiles };
  }
}
