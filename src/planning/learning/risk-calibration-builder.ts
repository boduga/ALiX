/**
 * P8.2 — RiskCalibrationBuilder.
 *
 * Identifies risk dimensions that overfire (high scores but safe outcomes),
 * miss (low scores but failures), or are absent from assessments.
 *
 * Pure computation — no I/O, no store access, no side effects.
 *
 * @module
 */

import type { LearningSignal, CalibrationProfile } from "./learning-types.js";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface DimensionScore {
  /** The risk dimension identifier (e.g., "governance", "revertability"). */
  dimension: string;
  /** The risk score (0–1). */
  score: number;
}

export interface RiskOutcomeObservation {
  /** The proposal this observation belongs to. */
  proposalId: string;
  /** Per-dimension risk scores. */
  dimensions: DimensionScore[];
  /** The observed outcome value. */
  outcome: string;
}

export interface RiskCalibrationResult {
  signals: LearningSignal[];
  profiles: CalibrationProfile[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Score above this threshold is considered "high risk". */
const DEFAULT_HIGH_RISK_THRESHOLD = 0.7;

/** Score below this threshold is considered "low risk". */
const DEFAULT_LOW_RISK_THRESHOLD = 0.3;

/** Minimum observations per dimension before emitting a signal. */
const DEFAULT_MIN_SAMPLES = 3;

/** Minimum overfire/miss rate before emitting a signal. */
const DEFAULT_RATE_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export class RiskCalibrationBuilder {
  private readonly highRiskThreshold: number;
  private readonly lowRiskThreshold: number;
  private readonly minSamples: number;
  private readonly rateThreshold: number;

  constructor(opts?: {
    highRiskThreshold?: number;
    lowRiskThreshold?: number;
    minSamples?: number;
    rateThreshold?: number;
  }) {
    this.highRiskThreshold = opts?.highRiskThreshold ?? DEFAULT_HIGH_RISK_THRESHOLD;
    this.lowRiskThreshold = opts?.lowRiskThreshold ?? DEFAULT_LOW_RISK_THRESHOLD;
    this.minSamples = opts?.minSamples ?? DEFAULT_MIN_SAMPLES;
    this.rateThreshold = opts?.rateThreshold ?? DEFAULT_RATE_THRESHOLD;
  }

  /**
   * Analyze risk-outcome observations and produce calibration signals.
   *
   * @param observations  Risk scores paired with observed outcomes.
   * @param sourceReportId  Source identifier for signal provenance.
   * @param generatedAt    ISO timestamp for output artifacts.
   */
  calibrate(
    observations: RiskOutcomeObservation[],
    sourceReportId: string,
    generatedAt: string,
  ): RiskCalibrationResult {
    const signals: LearningSignal[] = [];
    const profiles: CalibrationProfile[] = [];

    // Collect all dimensions present across observations
    const allDimensions = new Set<string>();
    for (const obs of observations) {
      for (const dim of obs.dimensions) {
        allDimensions.add(dim.dimension);
      }
    }

    const allDimensionNames = [...allDimensions].sort();

    for (const dimName of allDimensionNames) {
      const assessed = observations.filter((o) =>
        o.dimensions.some((d) => d.dimension === dimName),
      );

      if (assessed.length < this.minSamples) continue;

      // Overfire analysis
      const overfired = assessed.filter(
        (o) => {
          const dim = o.dimensions.find((d) => d.dimension === dimName);
          return dim && dim.score >= this.highRiskThreshold && o.outcome === "success";
        },
      );
      const overfireRate = overfired.length / assessed.length;

      if (overfireRate >= this.rateThreshold) {
        const sig = this.buildSignal(
          "risk_dimension_overfire",
          dimName,
          `${dimName} overfiring: ${overfired.length}/${assessed.length} high-risk proposals had safe outcomes (${(overfireRate * 100).toFixed(0)}%)`,
          overfireRate,
          assessed.length,
          sourceReportId,
          generatedAt,
        );
        signals.push(sig);

        const profile = this.buildProfile(
          dimName,
          -overfireRate,
          assessed.length,
          [sig.id],
          generatedAt,
        );
        if (profile) profiles.push(profile);
      }

      // Miss analysis
      const missed = assessed.filter(
        (o) => {
          const dim = o.dimensions.find((d) => d.dimension === dimName);
          return dim && dim.score <= this.lowRiskThreshold && o.outcome === "failure";
        },
      );
      const missRate = missed.length / assessed.length;

      if (missRate >= this.rateThreshold) {
        const sig = this.buildSignal(
          "risk_dimension_miss",
          dimName,
          `${dimName} missing: ${missed.length}/${assessed.length} low-risk proposals had failures (${(missRate * 100).toFixed(0)}%)`,
          missRate,
          assessed.length,
          sourceReportId,
          generatedAt,
        );
        signals.push(sig);

        const profile = this.buildProfile(
          dimName,
          missRate,
          assessed.length,
          [sig.id],
          generatedAt,
        );
        if (profile) profiles.push(profile);
      }
    }

    // Ignored dimension analysis: dimensions expected but never present
    if (observations.length >= this.minSamples) {
      const expectedDimensions = ["governance", "operational", "capability", "revertability", "evidence_quality"];
      for (const expected of expectedDimensions) {
        if (!allDimensions.has(expected)) {
          const present$ = observations.filter((o) =>
            o.dimensions.some((d) => d.dimension === expected),
          );
          if (present$.length === 0) {
            const sig: LearningSignal = {
              id: `ls-risk-ignored-${expected}_${Date.now()}`,
              subject: `Risk dimension "${expected}" is never assessed`,
              outcome: "signal_detected",
              confidence: 0.5,
              reasons: [
                `Dimension "${expected}" is in the standard set but appears in 0/${observations.length} observations`,
              ],
              generatedAt,
              sourceReportId,
              signalType: "risk_dimension_ignored",
              strength: 0.3,
              summary: `Risk dimension "${expected}" is absent from all ${observations.length} assessments`,
              evidenceRefs: [],
            };
            signals.push(sig);
          }
        }
      }
    }

    return { signals, profiles };
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private buildSignal(
    signalType: LearningSignal["signalType"],
    dimName: string,
    summary: string,
    rate: number,
    sampleCount: number,
    sourceReportId: string,
    generatedAt: string,
  ): LearningSignal {
    const confidence = sampleCount >= 50 ? 0.85 : sampleCount >= 20 ? 0.7 : 0.5;
    return {
      id: `ls-risk-${dimName}_${signalType}_${Date.now()}`,
      subject: `Risk dimension "${dimName}" — ${signalType.replace(/_/g, " ")}`,
      outcome: "signal_detected",
      confidence,
      reasons: [
        `Rate: ${(rate * 100).toFixed(0)}% (${Math.round(rate * sampleCount)}/${sampleCount})`,
      ],
      generatedAt,
      sourceReportId,
      signalType,
      strength: rate,
      summary,
      evidenceRefs: [],
    };
  }

  private buildProfile(
    dimName: string,
    rate: number,
    _sampleCount: number,
    sourceSignalIds: string[],
    generatedAt: string,
  ): CalibrationProfile | null {
    // Only produce profiles for significant patterns
    if (Math.abs(rate) < 0.5) return null;

    const adjustment = rate < 0 ? 1.0 + rate : 1.0 - rate;
    const clamped = parseFloat(Math.max(0.3, Math.min(0.9, adjustment)).toFixed(2));

    return {
      id: `cp-risk-${dimName}_${Date.now()}`,
      subject: `Adjust "${dimName}" risk dimension weight`,
      outcome: "suggested",
      confidence: 0.7,
      reasons: [`Pattern strength: ${(Math.abs(rate) * 100).toFixed(0)}%`],
      generatedAt,
      target: "risk_dimension_weight",
      targetName: dimName,
      previousValue: 1.0,
      suggestedValue: clamped,
      reason: `${rate < 0 ? "Overfire" : "Miss"} rate of ${(Math.abs(rate) * 100).toFixed(0)}% suggests weight adjustment`,
      evidenceRefs: sourceSignalIds,
      sourceSignalIds,
    };
  }
}
