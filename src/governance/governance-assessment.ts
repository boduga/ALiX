/**
 * P9.0b — GovernanceAssessment.
 *
 * Pure synchronous function that interprets a GovernanceHealthReport and
 * produces a GovernanceAssessment. Does NOT read any store — preserves the
 * objective → interpretation separation.
 *
 * Core invariant: assessment consumes ONLY the HealthReport. It never accesses
 * OutcomeStore, LearningStore, GovernanceReviewStore, or any other I/O boundary.
 *
 * @module
 */

import type { GovernanceHealthReport, GovernanceAssessment } from "./governance-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function shortId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}:${rand}`;
}

// ---------------------------------------------------------------------------
// Confidence thresholds
// ---------------------------------------------------------------------------

const HIGH_CONFIDENCE = 0.75;
const MEDIUM_CONFIDENCE = 0.5;

// ---------------------------------------------------------------------------
// buildGovernanceAssessment
// ---------------------------------------------------------------------------

/**
 * Interpret a GovernanceHealthReport into a GovernanceAssessment.
 *
 * Pure synchronous function — no async, no store access, no side effects.
 * The same HealthReport always produces the same Assessment (deterministic
 * given the same input).
 */
export function buildGovernanceAssessment(
  report: GovernanceHealthReport,
): GovernanceAssessment {
  const { sourceMetrics, totalReviews, totalProposals, lensEffectiveness, policyCoverage } = report;

  // 1. governanceConfidence — weighted function of sourceMetrics
  //    dashboardIntegrityScore: 40%, explanationCompleteness: 30%, evidenceChainUsage: 30%
  const integrityScore = (sourceMetrics.dashboardIntegrityScore ?? 0) / 100;
  const completeness = (sourceMetrics.explanationCompleteness ?? 0) / 100;
  const evidenceUsage = (sourceMetrics.evidenceChainUsage ?? 0) / 100;
  const governanceConfidence = Math.round(
    (integrityScore * 0.4 + completeness * 0.3 + evidenceUsage * 0.3) * 1000,
  ) / 1000;

  // 2. unresolvedGovernanceIssues
  //    incompleteChainLayers: structural gaps in explanation chains
  //    reviews exceeding proposals: coverage gap where reviews exist without
  //      corresponding operational outcomes
  const reviewsWithoutProposals = Math.max(0, totalReviews - totalProposals);
  const unresolvedGovernanceIssues =
    sourceMetrics.incompleteChainLayers + reviewsWithoutProposals;

  // 3. assessmentNotes — human-readable interpretation
  const assessmentNotes: string[] = [];

  // Confidence level
  if (governanceConfidence >= HIGH_CONFIDENCE) {
    assessmentNotes.push(
      `Governance confidence is high (${(governanceConfidence * 100).toFixed(1)}%). Source metrics indicate strong structural integrity across dashboard, explanation, and evidence chain dimensions.`,
    );
  } else if (governanceConfidence >= MEDIUM_CONFIDENCE) {
    assessmentNotes.push(
      `Governance confidence is moderate (${(governanceConfidence * 100).toFixed(1)}%). Some metrics show gaps that should be addressed to reach the high-confidence threshold of ${HIGH_CONFIDENCE * 100}%.`,
    );
  } else {
    assessmentNotes.push(
      `Governance confidence is low (${(governanceConfidence * 100).toFixed(1)}%). Multiple source metrics are below healthy thresholds; governance surface needs attention.`,
    );
  }

  // Unresolved issues
  if (unresolvedGovernanceIssues > 0) {
    const chainPart = sourceMetrics.incompleteChainLayers > 0
      ? `${sourceMetrics.incompleteChainLayers} incomplete chain layer(s)`
      : "";
    const gapPart = reviewsWithoutProposals > 0
      ? `${reviewsWithoutProposals} review(s) without operational outcomes`
      : "";
    const detail = [chainPart, gapPart].filter(Boolean).join("; ");
    assessmentNotes.push(
      `${unresolvedGovernanceIssues} unresolved governance issue(s) identified: ${detail}.`,
    );
  } else {
    assessmentNotes.push(
      "No unresolved governance issues detected. All evidence chains are complete and reviews are covered by operational outcomes.",
    );
  }

  // Policy coverage
  if (policyCoverage >= 90) {
    assessmentNotes.push(
      `Policy coverage is healthy at ${policyCoverage}%. All governing layers (outcome, recommendation, risk, governance) are well-populated.`,
    );
  } else if (policyCoverage >= 75) {
    assessmentNotes.push(
      `Policy coverage is adequate at ${policyCoverage}%. Consider improving layer availability to reach the 90% healthy threshold.`,
    );
  } else if (policyCoverage > 0) {
    assessmentNotes.push(
      `Policy coverage is low at ${policyCoverage}%. One or more governing layers have low availability.`,
    );
  }

  // Lens effectiveness
  const lensEntries = Object.entries(lensEffectiveness);
  if (lensEntries.length > 0) {
    const lensSummary = lensEntries
      .map(([lens, value]) => `${lens}: ${value}%`)
      .join(", ");
    assessmentNotes.push(
      `Lens effectiveness (${lensEntries.length} lens(es)): ${lensSummary}.`,
    );

    const weakLenses = lensEntries.filter(([, v]) => v < 50);
    if (weakLenses.length > 0) {
      assessmentNotes.push(
        `${weakLenses.length} lens(es) show low predictive value (<50%): ${weakLenses.map(([l]) => l).join(", ")}. Consider review or retirement.`,
      );
    }
  } else {
    assessmentNotes.push(
      "No lens effectiveness data available. Calibration profiles for governance lenses have not yet been populated.",
    );
  }

  return {
    id: shortId("gov_assessment"),
    subject: "Governance Assessment",
    outcome: "computed",
    confidence: governanceConfidence,
    reasons: [
      "Interpreted from GovernanceHealthReport: dashboard integrity, explanation completeness, evidence chain usage, chain layers, reviews, and lens effectiveness",
    ],
    generatedAt: now(),
    reportType: "governance_assessment",
    governanceConfidence,
    unresolvedGovernanceIssues,
    assessmentNotes,
  };
}
