/**
 * P6.0b — RiskScoreBuilder.
 *
 * Pure, deterministic, read-only risk scoring over a DecisionContext.
 * Never reads from stores or constructs context — receives DecisionContext directly.
 * Scoring functions are independently testable and side-effect free.
 *
 * @module
 */

import type { DecisionContext } from "./decision-types.js";
import type {
  RiskScore,
  RiskItem,
  RiskDimension,
  RiskOutcome,
} from "./risk-score-types.js";
import { RISK_DIMENSIONS, riskOutcomeFromScore } from "./risk-score-types.js";

// ---------------------------------------------------------------------------
// Pure scoring functions
// Each receives a DecisionContext and returns a number in [0, 1].
// ---------------------------------------------------------------------------

export function scoreGovernance(ctx: DecisionContext): number {
  let score = 0;
  if (ctx.lineageCompleteness === "broken") score += 0.4;
  else if (ctx.lineageCompleteness === "partial") score += 0.2;
  score += Math.min((ctx.warnings?.length ?? 0) * 0.15, 0.3);
  if (ctx.contextStatus === "insufficient_data") score += 0.5;
  return Math.min(score, 1);
}

export function scoreOperational(ctx: DecisionContext): number {
  let score = 0;
  if (ctx.proposalStatus === "failed") score += 0.4;
  const badOutcomes = ctx.similarProposals.filter(
    (s) => s.outcome === "revert" || s.outcome === "investigate",
  ).length;
  score += Math.min(badOutcomes * 0.1, 0.3);
  if (ctx.effectivenessTrend.revertRate > 0.5) score += 0.3;
  return Math.min(score, 1);
}

export function scoreCapability(ctx: DecisionContext): number {
  let score = 0;
  if (ctx.effectivenessTrend.sampleSize === 0) score += 0.3;
  if (ctx.effectivenessTrend.sampleSize > 0) {
    score += (1 - ctx.effectivenessTrend.keepRate) * 0.5;
  }
  const revertCount = ctx.similarProposals.filter(
    (s) => s.outcome === "revert",
  ).length;
  score += Math.min(revertCount * 0.1, 0.2);
  return Math.min(score, 1);
}

export function scoreRevertability(ctx: DecisionContext): number {
  // Use reversibility characteristics, not action-name matching.
  // This avoids coupling RiskScore to every future ProposalAction value.
  if (ctx.proposalStatus === "pending" || ctx.proposalStatus === "approved") return 0.5;
  if (ctx.lineageCompleteness === "broken") return 0.7;
  if (ctx.proposalStatus === "failed") return 0.4;
  if (ctx.proposalStatus === "applied") return 0.3;
  if (ctx.proposalStatus === "rejected") return 0.1;
  return 0.5;
}

export function scoreEvidenceQuality(ctx: DecisionContext): number {
  let score = 0;
  if ((ctx.evidenceRefs ?? []).length === 0) score += 0.4;
  if (ctx.dataFreshness.oldestArtifactAgeDays > 30) score += 0.2;
  if (ctx.lineageCompleteness === "broken") score += 0.3;
  else if (ctx.lineageCompleteness === "partial") score += 0.15;
  if (ctx.contextStatus === "stale_context") score += 0.3;
  return Math.min(score, 1);
}

// ---------------------------------------------------------------------------
// RiskScoreBuilder
// ---------------------------------------------------------------------------

export class RiskScoreBuilder {
  /**
   * Build a RiskScore from a DecisionContext.
   *
   * Pure computation — receives DecisionContext directly, never reads
   * from stores or constructs context. Deterministic: same input always
   * produces the same output.
   *
   * @param ctx - DecisionContext to score
   * @param generatedAt - ISO 8601 timestamp (injected for determinism in tests)
   */
  build(ctx: DecisionContext, generatedAt?: string): RiskScore {
    const genAt = generatedAt ?? new Date().toISOString();
    const reasons: string[] = [];
    const warnings: string[] = [];
    const evidenceRefs: string[] = [...(ctx.evidenceRefs ?? [])];
    const dimensions: Record<RiskDimension, number> = {
      governance: scoreGovernance(ctx),
      operational: scoreOperational(ctx),
      capability: scoreCapability(ctx),
      revertability: scoreRevertability(ctx),
      evidence_quality: scoreEvidenceQuality(ctx),
    };

    const risks: RiskItem[] = [];
    for (const dim of RISK_DIMENSIONS) {
      const score = dimensions[dim];
      const dimReasons: string[] = [];
      if (dim === "governance" && ctx.lineageCompleteness !== "complete") {
        dimReasons.push(`Lineage is ${ctx.lineageCompleteness}`);
      }
      if (dim === "capability" && ctx.effectivenessTrend.sampleSize === 0) {
        dimReasons.push("No effectiveness history available");
      }
      if (dim === "operational") {
        if (ctx.proposalStatus === "failed") dimReasons.push("Proposal previously failed");
        const badCount = ctx.similarProposals.filter(
          (s) => s.outcome === "revert" || s.outcome === "investigate",
        ).length;
        if (badCount > 0) dimReasons.push(`${badCount} similar proposal(s) had revert/investigate outcomes`);
        if (ctx.effectivenessTrend.revertRate > 0.5) dimReasons.push("Revert rate exceeds 50%");
      }
      if (dim === "revertability") {
        if (ctx.proposalStatus === "pending" || ctx.proposalStatus === "approved") {
          dimReasons.push("Pending/approved proposal has not mutated state yet");
        }
        if (ctx.lineageCompleteness === "broken") dimReasons.push("Mutating proposal has broken lineage");
        if (ctx.proposalStatus === "applied") dimReasons.push("Applied proposal appears revertable via snapshot lineage");
      }
      if (dim === "evidence_quality") {
        if ((ctx.evidenceRefs ?? []).length === 0) dimReasons.push("No evidence references available");
        if (ctx.dataFreshness.oldestArtifactAgeDays > 30) dimReasons.push("Oldest source artifact is older than 30 days");
        if (ctx.lineageCompleteness === "partial") dimReasons.push("Lineage is partial");
        else if (ctx.lineageCompleteness === "broken") dimReasons.push("Lineage is broken");
        if (ctx.contextStatus === "stale_context") dimReasons.push("Context is stale");
      }
      if (dimReasons.length === 0) {
        dimReasons.push(`Score ${score.toFixed(2)} based on available evidence`);
      }
      risks.push({
        dimension: dim,
        score,
        confidence: ctx.confidence,
        reasons: dimReasons,
      });
    }
    // Collect unique human-readable reasons across all dimensions
    const uniqueReasons = new Set<string>();
    for (const r of risks) {
      for (const reason of r.reasons) {
        uniqueReasons.add(reason);
      }
    }
    reasons.push(...uniqueReasons);

    const overallRisk = Math.round(
      RISK_DIMENSIONS.reduce((sum, d) => sum + dimensions[d], 0) /
        RISK_DIMENSIONS.length *
        100,
    ) / 100;

    const outcome: RiskOutcome = riskOutcomeFromScore(overallRisk);

    if (ctx.warnings) {
      warnings.push(...ctx.warnings);
    }

    return {
      id: `risk-${ctx.proposalId}`,
      subject: `Risk assessment for ${ctx.proposalAction}: ${ctx.subject}`,
      outcome,
      confidence: ctx.confidence,
      reasons,
      warnings: warnings.length > 0 ? warnings : undefined,
      evidenceRefs,
      generatedAt: genAt,
      overallRisk,
      risks,
      dimensions,
      // Preserve provenance chain from DecisionContext
      sourceArtifacts: ctx.sourceArtifacts,
    };
  }
}
