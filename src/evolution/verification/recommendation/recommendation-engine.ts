// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.5 — Governance Recommendation Engine.
 *
 * Translates verification evidence into structured governance recommendations.
 *
 * BOUNDARY: This engine is advisory only.
 *   - It MUST NOT transition EvolutionState.
 *   - It MUST NOT invoke deployment.
 *   - It MUST NOT bypass A3 validation.
 *
 * Governance (A3) owns the decision. This engine produces inputs.
 *
 * @module recommendation-engine
 */

import type { VerificationEvidence } from "../contracts/verification-contract.js";
import type { GovernanceRecommendation, GovernanceRecommendationKind } from "../contracts/recommendation-contract.js";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// RecommendationConfig
// ---------------------------------------------------------------------------

export interface RecommendationConfig {
  /** Confidence at or above which APPROVE is considered (default 0.8). */
  approveConfidenceThreshold: number;
  /** Confidence at or above which MONITOR is considered (default 0.5). */
  monitorConfidenceThreshold: number;
  /** Confidence below which REQUEST_ADDITIONAL_EVIDENCE is recommended (default 0.3). */
  insufficientEvidenceThreshold: number;
  /** Fraction of metrics classified 'insufficient' that triggers REQUEST_ADDITIONAL_EVIDENCE (default 0.5). */
  insufficientMetricFraction: number;
}

export const DEFAULT_RECOMMENDATION_CONFIG: RecommendationConfig = {
  approveConfidenceThreshold: 0.8,
  monitorConfidenceThreshold: 0.5,
  insufficientEvidenceThreshold: 0.3,
  insufficientMetricFraction: 0.5,
};

// ---------------------------------------------------------------------------
// RecommendationEngine
// ---------------------------------------------------------------------------

/**
 * Advisory recommendation engine.
 *
 * @invariant Advisory only — never transitions state, invokes deployment,
 *            or bypasses A3 validation.
 * @invariant Deterministic — same evidence + same config = same recommendation.
 * @invariant Every recommendation carries numeric confidence and references evidence.
 * @invariant No recommendation without supporting evidence.
 */
export class RecommendationEngine {
  private readonly config: RecommendationConfig;

  constructor(config?: Partial<RecommendationConfig>) {
    this.config = { ...DEFAULT_RECOMMENDATION_CONFIG, ...config };
  }

  /**
   * Generate a governance recommendation from verification evidence.
   *
   * Pure — no side effects.
   *
   * @param evidence - The verification evidence to evaluate.
   * @param metricsByClassification - Optional pre-computed classification counts.
   *        If omitted, the engine infers risk from confidence and behavioral changes.
   * @returns A governance recommendation.
   */
  generate(
    evidence: VerificationEvidence,
    metricsByClassification?: {
      improvement: number;
      neutral: number;
      regression: number;
      insufficient: number;
      total: number;
    },
  ): GovernanceRecommendation {
    const confidence = evidence.confidenceProfile.overallConfidence;
    const { kind, reasoning, risks } = this.classify(
      evidence,
      confidence,
      metricsByClassification,
    );

    const supportingEvidence = this.collectSupportingEvidence(evidence);

    return {
      recommendationId: `rec-${randomUUID()}`,
      evidenceId: evidence.evidenceId,
      proposalId: evidence.proposalId,
      kind,
      confidence,
      reasoning,
      supportingEvidence,
      risks,
      createdAt: new Date().toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // Classification logic
  // -----------------------------------------------------------------------

  private classify(
    evidence: VerificationEvidence,
    confidence: number,
    metricsByClassification?: {
      improvement: number;
      neutral: number;
      regression: number;
      insufficient: number;
      total: number;
    },
  ): { kind: GovernanceRecommendationKind; reasoning: string; risks: string[] } {
    const risks: string[] = [];
    const regressions = metricsByClassification?.regression ?? this.inferRegressions(evidence);
    const improvements = metricsByClassification?.improvement ?? 0;
    const insufficient = metricsByClassification?.insufficient ?? 0;
    const total = metricsByClassification?.total ?? Math.max(1, improvements + regressions + insufficient);

    // Track risks
    if (regressions > 0) {
      risks.push(`${regressions} metric regression(s) detected`);
    }
    if (insufficient > 0) {
      risks.push(`${insufficient} metric(s) with insufficient evidence`);
    }

    // Insufficient evidence check
    if (confidence < this.config.insufficientEvidenceThreshold) {
      return {
        kind: "REQUEST_ADDITIONAL_EVIDENCE",
        reasoning: `Confidence ${confidence.toFixed(3)} below threshold ${this.config.insufficientEvidenceThreshold}; insufficient evidence for decision`,
        risks,
      };
    }

    const insufficientFraction = total > 0 ? insufficient / total : 0;
    if (insufficientFraction >= this.config.insufficientMetricFraction) {
      return {
        kind: "REQUEST_ADDITIONAL_EVIDENCE",
        reasoning: `${(insufficientFraction * 100).toFixed(1)}% of metrics have insufficient evidence; cannot make reliable recommendation`,
        risks,
      };
    }

    // Critical regressions → REJECT
    if (regressions > 0 && confidence < this.config.monitorConfidenceThreshold) {
      return {
        kind: "REJECT",
        reasoning: `${regressions} metric regression(s) with low confidence ${confidence.toFixed(3)}`,
        risks,
      };
    }

    // APPROVE: high confidence, no regressions
    if (confidence >= this.config.approveConfidenceThreshold && regressions === 0) {
      return {
        kind: "APPROVE",
        reasoning: `Confidence ${confidence.toFixed(3)} meets threshold with no regressions detected`,
        risks,
      };
    }

    // MONITOR: acceptable but with caveats
    if (confidence >= this.config.monitorConfidenceThreshold) {
      return {
        kind: "MONITOR",
        reasoning: `Confidence ${confidence.toFixed(3)} acceptable but with ${regressions} regression(s); recommend monitoring during rollout`,
        risks,
      };
    }

    // ESCALATE: cannot determine
    return {
      kind: "ESCALATE",
      reasoning: `Confidence ${confidence.toFixed(3)} and classification signals do not meet any clear threshold; human review required`,
      risks,
    };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Infer regression count from behavioral changes when explicit
   * classification counts are not provided.
   */
  private inferRegressions(evidence: VerificationEvidence): number {
    return evidence.behavioralChanges.filter((c) => c.includes("regression")).length;
  }

  /**
   * Collect evidence references supporting the recommendation.
   */
  private collectSupportingEvidence(evidence: VerificationEvidence): string[] {
    const refs = [evidence.evidenceId];
    for (const record of evidence.lineage) {
      refs.push(`${record.sourceType}:${record.sourceId}`);
    }
    return refs;
  }
}
