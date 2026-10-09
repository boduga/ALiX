/**
 * P6.0a — Decision confidence computation.
 *
 * Confidence reflects evidence completeness, not recommendation certainty.
 * Extracted into its own module so P6.1 (RiskScore) and P6.3 (Recommendation)
 * can reuse the same computation without depending on DecisionContextBuilder.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Factors
// ---------------------------------------------------------------------------

const CONFIDENCE_PROPOSAL_FOUND = 0.30;
const CONFIDENCE_LINEAGE_COMPLETE = 0.20;
const CONFIDENCE_LINEAGE_PARTIAL = 0.10;
const CONFIDENCE_LINEAGE_BROKEN = -0.10;
const CONFIDENCE_EVIDENCE_FP = 0.15;
const CONFIDENCE_EFFECTIVENESS = 0.15;
const CONFIDENCE_SIMILAR_PROPOSALS = 0.10;
const CONFIDENCE_PER_WARNING = -0.05;
const CONFIDENCE_STALE_PENALTY = -0.10;

/** Staleness threshold in days. */
export const STALE_THRESHOLD_DAYS = 30;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ConfidenceInputs {
  lineageCompleteness: "partial" | "complete" | "broken";
  hasEvidenceFingerprints: boolean;
  hasEffectiveness: boolean;
  similarProposalsCount: number;
  warningsCount: number;
  ageDays: number;
}

export interface ConfidenceResult {
  confidence: number;
  reasons: string[];
}

/**
 * Compute evidence-completeness confidence from a DecisionContext snapshot.
 * Returns [0, 1] clamped and rounded to 2 decimal places.
 *
 * When contextStatus is "insufficient_data" the caller should force confidence
 * to 0 regardless of this computation — this function assumes a proposal exists.
 */
export function computeDecisionConfidence(inputs: ConfidenceInputs): ConfidenceResult {
  const reasons: string[] = [];
  let confidence = 0;

  confidence += CONFIDENCE_PROPOSAL_FOUND;

  if (inputs.lineageCompleteness === "complete") {
    confidence += CONFIDENCE_LINEAGE_COMPLETE;
    reasons.push("Full lineage trace available");
  } else if (inputs.lineageCompleteness === "partial") {
    confidence += CONFIDENCE_LINEAGE_PARTIAL;
    reasons.push("Partial lineage trace available");
  } else {
    confidence += CONFIDENCE_LINEAGE_BROKEN;
  }

  if (inputs.hasEvidenceFingerprints) {
    confidence += CONFIDENCE_EVIDENCE_FP;
  }

  if (inputs.hasEffectiveness) {
    confidence += CONFIDENCE_EFFECTIVENESS;
    reasons.push("Effectiveness report available");
  }

  if (inputs.similarProposalsCount > 0) {
    confidence += CONFIDENCE_SIMILAR_PROPOSALS;
    reasons.push(`${inputs.similarProposalsCount} similar proposals identified`);
  }

  confidence += inputs.warningsCount * CONFIDENCE_PER_WARNING;

  if (inputs.ageDays > STALE_THRESHOLD_DAYS) {
    confidence += CONFIDENCE_STALE_PENALTY;
  }

  confidence = Math.max(0, Math.min(1, confidence));
  confidence = Math.round(confidence * 100) / 100;

  if (reasons.length === 0) {
    reasons.push("Basic proposal context available");
  }

  return { confidence, reasons };
}
