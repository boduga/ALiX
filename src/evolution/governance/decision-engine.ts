// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A3 — Governance Decision Engine.
 *
 * Pure decision logic for the A3 governance module. Translates A2 verification
 * evidence (and optional A2.5 recommendations) into binding GovernanceDecisions.
 *
 * BOUNDARY: Pure only.
 * - MUST NOT perform I/O (no store access, no filesystem, no network).
 * - MUST NOT produce side effects.
 * - MUST be deterministic given the same evidence, recommendation, and config
 *   (except for the real-time decidedAt timestamp).
 *
 * @module decision-engine
 */

import { createHash } from "node:crypto";
import type { VerificationEvidence } from "../verification/contracts/verification-contract.js";
import type { GovernanceRecommendation } from "../verification/contracts/recommendation-contract.js";
import { isEvidenceExpired } from "../verification/evidence/verification-evidence.js";
import { inferRegressions } from "../verification/shared.js";
import { canonicalStringify } from "../../security/audit/canonical-json.js";
import {
  type GovernanceDecision,
  type GovernanceDecisionKind,
  type GovernancePolicyConfig,
  DEFAULT_GOVERNANCE_POLICY,
} from "./contracts/decision-contract.js";

// ---------------------------------------------------------------------------
// DecisionConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for governance decision generation.
 *
 * @property policyConfig - Override governance policy config.
 *                          Uses DEFAULT_GOVERNANCE_POLICY if omitted.
 * @property evolutionId - The evolution ID (defaults to evidence.proposalId
 *                         for backward compatibility).
 */
export interface DecisionConfig {
  policyConfig?: GovernancePolicyConfig;
  /** The evolution ID (defaults to evidence.proposalId for backward compat). */
  evolutionId?: string;
}

// ---------------------------------------------------------------------------
// Internal: A2.5 → A3 recommendation kind mapping
// ---------------------------------------------------------------------------

/**
 * Maps an A2.5 recommendation kind to the closest A3 decision kind.
 * ESCALATE has no A3 equivalent (returns undefined).
 */
const RECOMMENDATION_KIND_MAP: Record<string, GovernanceDecisionKind | undefined> = {
  APPROVE: "APPROVE",
  MONITOR: "MONITOR",
  REQUEST_ADDITIONAL_EVIDENCE: "REQUEST_MORE_EVIDENCE",
  REJECT: "REJECT",
  // ESCALATE intentionally omitted — no A3 equivalent
};

// ---------------------------------------------------------------------------
// decisionKindToTargetState
// ---------------------------------------------------------------------------

/**
 * Map a GovernanceDecisionKind to its resulting evolution target state.
 *
 * Pure — no side effects.
 *
 * | Decision Kind          | Target State   |
 * |------------------------|----------------|
 * | APPROVE                | APPROVED       |
 * | REJECT                 | REJECTED       |
 * | MONITOR                | UNDER_REVIEW   |
 * | REQUEST_MORE_EVIDENCE  | UNDER_REVIEW   |
 */
export function decisionKindToTargetState(
  kind: GovernanceDecisionKind,
): "APPROVED" | "REJECTED" | "UNDER_REVIEW" {
  switch (kind) {
    case "APPROVE":
      return "APPROVED";
    case "REJECT":
      return "REJECTED";
    case "MONITOR":
      return "UNDER_REVIEW";
    case "REQUEST_MORE_EVIDENCE":
      return "UNDER_REVIEW";
  }
}

// ---------------------------------------------------------------------------
// generateDecision
// ---------------------------------------------------------------------------

/**
 * Generate a binding GovernanceDecision from A2 verification evidence
 * and (optionally) an A2.5 recommendation.
 *
 * Pure — no side effects, no I/O, no store access.
 *
 * Decision flow:
 * 1. Evidence freshness check → fail-closed: expired = REJECT
 * 2. Resolve policy thresholds (with risk-class overrides)
 * 3. Confidence < rejectConfidenceThreshold → REJECT
 * 4. Regressions > maxAllowedRegressions → REJECT
 * 5. reproducibilityLevel < minReproducibilityLevel → REQUEST_MORE_EVIDENCE
 * 6. confidence >= minApproveConfidence + no regressions → APPROVE
 * 7. confidence >= minMonitorConfidence → MONITOR
 * 8. A2.5 ESCALATE → per escalateBehavior: REJECT or REQUEST_MORE_EVIDENCE
 * 9. Fallback → REQUEST_MORE_EVIDENCE
 *
 * @param evidence - A2 verification evidence to base the decision on.
 * @param recommendation - Optional A2.5 recommendation for tracking.
 * @param options - Optional config overrides.
 * @returns A binding GovernanceDecision.
 */
export function generateDecision(
  evidence: VerificationEvidence,
  recommendation?: GovernanceRecommendation,
  options?: DecisionConfig,
): GovernanceDecision {
  // Step 1: Resolve policy config
  const policyConfig = options?.policyConfig ?? DEFAULT_GOVERNANCE_POLICY;

  // TODO(A3): resolve riskClassOverrides when evidence carries a risk class
  // See GovernancePolicyConfig.riskClassOverrides — once the evidence pipeline
  // surfaces risk class, merge matching overrides into policyConfig here.
  void policyConfig.riskClassOverrides;

  // Step 2: Read evidence-level inputs
  const confidence = evidence.confidenceProfile.overallConfidence;
  const regressions = inferRegressions(evidence);

  // Step 1: Evidence freshness check
  if (isEvidenceExpired(evidence)) {
    if (policyConfig.failClosedOnExpiredEvidence) {
      // Fail-closed: reject expired evidence
      return buildDecision(evidence, recommendation, policyConfig, {
        kind: "REJECT",
        confidence,
        reasoning: "Evidence has expired; rejecting per fail-closed policy",
        risks: ["Evidence has expired"],
        decidedBy: "governance_policy",
        evolutionId: options?.evolutionId,
      });
    }
    // Fail-soft: monitor expired evidence
    return buildDecision(evidence, recommendation, policyConfig, {
      kind: "MONITOR",
      confidence,
      reasoning: "Evidence has expired; monitoring due to non-fail-closed policy",
      risks: ["Evidence has expired"],
      decidedBy: "governance_policy",
    });
  }

  // Step 3: Confidence < rejectConfidenceThreshold → REJECT
  if (confidence < policyConfig.rejectConfidenceThreshold) {
    return buildDecision(evidence, recommendation, policyConfig, {
      kind: "REJECT",
      confidence,
      reasoning:
        `Confidence ${confidence.toFixed(3)} is below reject threshold ${policyConfig.rejectConfidenceThreshold}`,
      risks: [`Confidence ${confidence.toFixed(3)} below reject threshold`],
      decidedBy: "governance_policy",
    });
  }

  // Step 4: Regressions > maxAllowedRegressions → REJECT
  if (regressions > policyConfig.maxAllowedRegressions) {
    return buildDecision(evidence, recommendation, policyConfig, {
      kind: "REJECT",
      confidence,
      reasoning:
        `Found ${regressions} regression(s), exceeding max allowed ${policyConfig.maxAllowedRegressions}`,
      risks: [`${regressions} regression(s) detected exceeding limit`],
      decidedBy: "governance_policy",
    });
  }

  // Step 5: reproducibilityLevel < minReproducibilityLevel → REQUEST_MORE_EVIDENCE
  if (evidence.reproducibilityLevel < policyConfig.minReproducibilityLevel) {
    return buildDecision(evidence, recommendation, policyConfig, {
      kind: "REQUEST_MORE_EVIDENCE",
      confidence,
      reasoning:
        `Reproducibility level ${evidence.reproducibilityLevel} is below minimum ${policyConfig.minReproducibilityLevel}`,
      risks: [`Reproducibility level ${evidence.reproducibilityLevel} below threshold`],
      decidedBy: "governance_policy",
    });
  }

  // Step 6: confidence >= minApproveConfidence + regressions within limit → APPROVE
  if (
    confidence >= policyConfig.minApproveConfidence &&
    regressions <= policyConfig.maxAllowedRegressions
  ) {
    return buildDecision(evidence, recommendation, policyConfig, {
      kind: "APPROVE",
      confidence,
      reasoning:
        `Confidence ${confidence.toFixed(3)} meets approve threshold with ${regressions} regression(s) (within limit ${policyConfig.maxAllowedRegressions})`,
      risks: [],
      decidedBy: "governance_policy",
    });
  }

  // Step 7: confidence >= minMonitorConfidence → MONITOR
  if (confidence >= policyConfig.minMonitorConfidence) {
    return buildDecision(evidence, recommendation, policyConfig, {
      kind: "MONITOR",
      confidence,
      reasoning:
        `Confidence ${confidence.toFixed(3)} meets monitor threshold with ${regressions} regression(s)`,
      risks:
        regressions > 0 ? [`${regressions} regression(s) detected`] : [],
      decidedBy: "governance_policy",
    });
  }

  // Step 8: A2.5 ESCALATE → per escalateBehavior: REJECT or REQUEST_MORE_EVIDENCE
  if (recommendation?.kind === "ESCALATE") {
    if (policyConfig.escalateBehavior === "reject") {
      return buildDecision(evidence, recommendation, policyConfig, {
        kind: "REJECT",
        confidence,
        reasoning:
          "A2.5 recommendation is ESCALATE; rejecting per policy escalateBehavior",
        risks: recommendation.risks,
        decidedBy: "auto_escalation",
        evolutionId: options?.evolutionId,
      });
    }
    return buildDecision(evidence, recommendation, policyConfig, {
      kind: "REQUEST_MORE_EVIDENCE",
      confidence,
      reasoning:
        "A2.5 recommendation is ESCALATE; requesting more evidence per policy escalateBehavior",
      risks: recommendation.risks,
      decidedBy: "auto_escalation",
    });
  }

  // Step 9: Fallback → REQUEST_MORE_EVIDENCE
  return buildDecision(evidence, recommendation, policyConfig, {
    kind: "REQUEST_MORE_EVIDENCE",
    confidence,
    reasoning:
      `Confidence ${confidence.toFixed(3)} does not meet any decision threshold; requesting more evidence`,
    risks: [],
    decidedBy: "governance_policy",
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute recommendation-tracking fields for a GovernanceDecision.
 *
 * Pure — no side effects.
 *
 * @param recommendation - Optional A2.5 recommendation.
 * @param decisionKind - The A3 decision kind that was reached.
 * @returns Tracking fields: recommendationAvailable, recommendationId,
 *          followedRecommendation, and overrideReason (if applicable).
 */
function computeRecommendationTracking(
  recommendation: GovernanceRecommendation | undefined,
  decisionKind: GovernanceDecisionKind,
): {
  recommendationAvailable: boolean;
  recommendationId?: string;
  followedRecommendation: boolean;
  overrideReason?: string;
} {
  if (!recommendation) {
    return {
      recommendationAvailable: false,
      followedRecommendation: false,
    };
  }

  // Map A2.5 kind to A3 kind for followed comparison.
  // ESCALATE returns undefined → not followable.
  const mappedKind = RECOMMENDATION_KIND_MAP[recommendation.kind];
  const followed = mappedKind === decisionKind;

  return {
    recommendationAvailable: true,
    recommendationId: recommendation.recommendationId,
    followedRecommendation: followed,
    overrideReason: followed
      ? undefined
      : `A3 decision (${decisionKind}) differs from A2.5 recommendation (${recommendation.kind})`,
  };
}

/**
 * Compute a deterministic decisionId from evidenceId and policy config.
 *
 * Different policy configs produce different decisionIds even for the same
 * evidence, preventing ID collisions.
 */
function computeDecisionId(evidenceId: string, policyConfig: GovernancePolicyConfig): string {
  const hash = createHash("sha256");
  hash.update(`${evidenceId}:${canonicalStringify(policyConfig)}`);
  return `govd-${hash.digest("hex").slice(0, 16)}`;
}

/**
 * Assemble a GovernanceDecision from evidence and decision parameters.
 *
 * Pure — no side effects.
 *
 * @param evidence - Source verification evidence.
 * @param recommendation - Optional A2.5 recommendation.
 * @param policyConfig - The policy config snapshot.
 * @param params - Decision-specific parameters.
 * @returns A fully populated GovernanceDecision.
 */
function buildDecision(
  evidence: VerificationEvidence,
  recommendation: GovernanceRecommendation | undefined,
  policyConfig: GovernancePolicyConfig,
  params: {
    kind: GovernanceDecisionKind;
    confidence: number;
    reasoning: string;
    risks: readonly string[];
    decidedBy: "operator" | "governance_policy" | "auto_escalation";
    /** Override evolution ID (defaults to evidence.proposalId). */
    evolutionId?: string;
  },
): GovernanceDecision {
  const tracking = computeRecommendationTracking(recommendation, params.kind);

  return {
    decisionId: computeDecisionId(evidence.evidenceId, policyConfig),
    proposalId: evidence.proposalId,
    evolutionId: params.evolutionId ?? evidence.proposalId,
    kind: params.kind,
    confidence: params.confidence,
    reasoning: params.reasoning,
    risks: params.risks,
    evidenceId: evidence.evidenceId,
    ...tracking,
    policySnapshot: structuredClone(policyConfig) as GovernancePolicyConfig,
    targetState: decisionKindToTargetState(params.kind),
    decidedAt: new Date().toISOString(),
    decidedBy: params.decidedBy,
  };
}
