/**
 * P6.1 — RecommendationEngine.
 *
 * Pure, deterministic, read-only recommendation engine.
 * Receives DecisionContext + optional RiskScore and returns a single
 * ApprovalRecommendation with one of four outcomes.
 *
 * Rules (priority order, first match wins):
 *   1. reject    — lineage broken + insufficient data + critical warning
 *   2. defer     — stale or insufficient context
 *   3. investigate — high risk, or strong evidence + material risk
 *   4. approve   — otherwise (default)
 *
 * Never reads stores or constructs context.
 *
 * @module
 */

import type { DecisionContext } from "./decision-types.js";
import type { RiskScore, RiskItem } from "./risk-score-types.js";
import type { ApprovalRecommendation, Recommendation } from "./recommendation-types.js";
import { riskOutcomeFromScore } from "./risk-score-types.js";

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

/**
 * Determine if the proposal should be rejected.
 * Reject is a trust/integrity circuit breaker, NOT a quality judgment.
 * Requires ALL THREE conditions: broken lineage + insufficient data + critical warning.
 */
function shouldReject(ctx: DecisionContext): boolean {
  if (ctx.lineageCompleteness !== "broken") return false;
  if (ctx.contextStatus !== "insufficient_data") return false;
  return (ctx.warnings ?? []).some((w) => w.severity === "critical");
}

/**
 * Determine if the proposal should be deferred due to insufficient evidence.
 */
function shouldDefer(ctx: DecisionContext): boolean {
  return ctx.contextStatus === "stale_context" || ctx.contextStatus === "insufficient_data";
}

/**
 * Determine if the proposal should be investigated.
 * Investigate when:
 *   1. High risk exists (overallRisk >= 0.6)
 *   OR
 *   2. Strong evidence exists (confidence >= 0.8) AND material risk exists (overallRisk >= 0.4)
 *      — signals conflict: the data says "do it" but the risk says "be careful"
 */
function shouldInvestigate(ctx: DecisionContext, riskScore?: RiskScore): boolean {
  // High risk alone is enough to flag for investigation
  if (riskScore && riskScore.overallRisk >= 0.6) return true;
  // Strong evidence + material risk = signals conflict
  if (ctx.confidence >= 0.8 && riskScore && riskScore.overallRisk >= 0.4) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Signal coherence
// ---------------------------------------------------------------------------

/**
 * Compute recommendation confidence from signal coherence.
 *
 * Measures how clearly the available evidence supports the selected recommendation.
 * Bounded by evidence ceiling — recommendation cannot be more certain
 * than the available evidence.
 *
 * Returns a value in [0, 1] with 2 decimal places.
 */
export function computeSignalCoherence(
  recommendation: Recommendation,
  ctx: DecisionContext,
  riskScore?: RiskScore,
): number {
  let support = 0;
  let contradict = 0;

  // Evidence completeness supports when high
  if (ctx.confidence >= 0.7) support++;
  else if (ctx.confidence < 0.4) contradict++;

  // Risk assessment support depends on recommendation
  if (riskScore) {
    if (recommendation === "investigate" && riskScore.overallRisk >= 0.6) support++;
    else if (recommendation !== "investigate" && riskScore.overallRisk < 0.4) support++;
    else contradict++;
  }

  // Lineage completeness supports confident recommendations
  if (ctx.lineageCompleteness === "complete") support++;
  else if (ctx.lineageCompleteness === "broken") contradict++;

  // Effectiveness trend alignment
  if (ctx.effectivenessTrend.sampleSize > 0) {
    const trendSupports =
      (recommendation === "approve" && ctx.effectivenessTrend.keepRate > 0.7) ||
      (recommendation === "investigate" && ctx.effectivenessTrend.revertRate > 0.3);
    if (trendSupports) support++;
    else contradict++;
  }

  const total = support + contradict;
  if (total === 0) return 0.5; // neutral — no signals to judge

  // Raw coherence: what proportion of signals support the recommendation
  const rawCoherence = support / total;

  // Evidence ceiling: recommendation cannot be more certain than the available evidence
  // Floor of 0.5 so low evidence doesn't collapse confidence to zero
  const evidenceCeiling = Math.max(0.5, ctx.confidence);
  const clamped = Math.min(rawCoherence, evidenceCeiling);

  return Math.round(clamped * 100) / 100;
}

// ---------------------------------------------------------------------------
// RecommendationEngine
// ---------------------------------------------------------------------------

export class RecommendationEngine {
  /**
   * Produce a single ApprovalRecommendation from DecisionContext + optional RiskScore.
   *
   * @param ctx - Assembled DecisionContext
   * @param riskScore - Optional RiskScore from RiskScoreBuilder
   * @param generatedAt - ISO 8601 timestamp (injected for deterministic testing)
   */
  recommend(
    ctx: DecisionContext,
    riskScore?: RiskScore,
    generatedAt?: string,
  ): ApprovalRecommendation {
    const genAt = generatedAt ?? new Date().toISOString();
    const reasons: string[] = [];
    let recommendation: Recommendation;

    // Rule 1: reject (trust circuit breaker)
    if (shouldReject(ctx)) {
      recommendation = "reject";
      reasons.push("Lineage is broken, data insufficient, and critical warnings present");
      reasons.push("Proposal cannot be trusted — requires manual governance review");
    }
    // Rule 2: defer (insufficient evidence)
    else if (shouldDefer(ctx)) {
      recommendation = "defer";
      if (ctx.contextStatus === "stale_context") reasons.push("Context is stale — refresh evidence before evaluating");
      if (ctx.contextStatus === "insufficient_data") reasons.push("Insufficient data to form a recommendation");
    }
    // Rule 3: investigate (high risk or conflicting signals)
    else if (shouldInvestigate(ctx, riskScore)) {
      recommendation = "investigate";
      if (riskScore && riskScore.overallRisk >= 0.6) {
        reasons.push(`Risk score is ${riskScore.outcome} (${riskScore.overallRisk.toFixed(2)})`);
      }
      if (ctx.confidence >= 0.8 && riskScore && riskScore.overallRisk >= 0.4) {
        reasons.push("Strong evidence with material risk — signals conflict");
      }
    }
    // Rule 4: approve (default)
    else {
      recommendation = "approve";
      reasons.push("Context is sufficient and risk is moderate or low");
    }

    const coherence = computeSignalCoherence(recommendation, ctx, riskScore);

    return {
      id: `rec-${ctx.proposalId}-${genAt}`,
      subject: `Recommendation for ${ctx.proposalId}`,
      outcome: recommendation,
      recommendation,
      confidence: coherence,
      reasons,
      proposalId: ctx.proposalId,
      evidenceRefs: [...(ctx.evidenceRefs ?? [])],
      warnings: ctx.warnings?.length ? [...ctx.warnings] : undefined,
      sourceArtifacts: [...ctx.sourceArtifacts],
      generatedAt: genAt,
    };
  }
}
