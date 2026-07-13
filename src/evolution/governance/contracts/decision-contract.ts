// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A3 — Governance Decision Contract.
 *
 * Defines the core decision types for the A3 governance module.
 * A GovernanceDecision represents a binding outcome of governance
 * review — approved, rejected, monitored, or requiring more evidence.
 *
 * @module decision-contract
 */

import type { ValidationResult } from "../../contracts/evolution-contract.js";

// ---------------------------------------------------------------------------
// GovernanceDecisionKind (Section A3.1)
// ---------------------------------------------------------------------------

/**
 * The four governance decision kinds.
 *
 * - `APPROVE`: Evolution is approved for adaptation.
 * - `REJECT`: Evolution is rejected.
 * - `MONITOR`: Evolution proceeds under enhanced observation.
 * - `REQUEST_MORE_EVIDENCE`: Insufficient evidence for a binding decision.
 *
 * @invariant Only four kinds exist (unlike A2.5 which has five
 *            recommendation kinds — ESCALATE is a decision path, not
 *            a decision kind in A3).
 */
export type GovernanceDecisionKind =
  | "APPROVE"
  | "REJECT"
  | "MONITOR"
  | "REQUEST_MORE_EVIDENCE";

export const VALID_GOVERNANCE_DECISION_KINDS: readonly GovernanceDecisionKind[] = [
  "APPROVE",
  "REJECT",
  "MONITOR",
  "REQUEST_MORE_EVIDENCE",
];

// ---------------------------------------------------------------------------
// GovernancePolicyConfig
// ---------------------------------------------------------------------------

/**
 * Policy-dependent parameterization for governance decisions.
 *
 * All numeric thresholds are epistemic confidence values in [0, 1].
 * The config is captured as a snapshot at decision time so that
 * decisions remain interpretable even when policy changes later.
 */
export interface GovernancePolicyConfig {
  /** Human-readable policy name. */
  policyName: string;
  /** Minimum confidence to approve (default 0.8). */
  minApproveConfidence: number;
  /** Minimum confidence to allow monitor (default 0.5). */
  minMonitorConfidence: number;
  /** Below this confidence, reject automatically (default 0.3). */
  rejectConfidenceThreshold: number;
  /** Maximum allowed regression count (default 0). */
  maxAllowedRegressions: number;
  /** Behavior when evidence is insufficient: "reject" or "request_evidence". */
  escalateBehavior: "reject" | "request_evidence";
  /** Whether to fail closed when evidence has expired (default true). */
  failClosedOnExpiredEvidence: boolean;
  /** Minimum reproducibility level required (default 2). */
  minReproducibilityLevel: number;
  /** Optional per-risk-class overrides of policy parameters. */
  riskClassOverrides?: Record<string, Partial<GovernancePolicyConfig>>;
}

// ---------------------------------------------------------------------------
// DEFAULT_GOVERNANCE_POLICY
// ---------------------------------------------------------------------------

/**
 * Conservative default governance policy.
 *
 * - Requires confidence >= 0.8 for approval.
 * - Rejects below confidence 0.3.
 * - Zero regressions tolerated by default.
 * - Fail-closed on expired evidence.
 *
 * @invariant All thresholds satisfy 0 <= reject < monitor < approve <= 1.
 */
export const DEFAULT_GOVERNANCE_POLICY: GovernancePolicyConfig = {
  policyName: "default",
  minApproveConfidence: 0.8,
  minMonitorConfidence: 0.5,
  rejectConfidenceThreshold: 0.3,
  maxAllowedRegressions: 0,
  escalateBehavior: "request_evidence",
  failClosedOnExpiredEvidence: true,
  minReproducibilityLevel: 2,
};

// ---------------------------------------------------------------------------
// GovernanceDecision
// ---------------------------------------------------------------------------

/**
 * A binding governance decision produced by the A3 governance module.
 *
 * Every decision records its policy snapshot so the decision remains
 * interpretable regardless of future policy changes.
 *
 * @invariant decisionId must have the "govd-" prefix.
 * @invariant confidence is epistemic, in [0, 1].
 * @invariant policySnapshot is immutable within a decision (captured at
 *            decision time).
 */
export interface GovernanceDecision {
  /** Unique decision identifier (prefix "govd-"). */
  decisionId: string;
  /** The evolution proposal this decision applies to. */
  proposalId: string;
  /** The evolution this decision applies to. */
  evolutionId: string;
  /** The governance decision kind. */
  kind: GovernanceDecisionKind;
  /** Epistemic confidence in the decision (0–1). */
  confidence: number;
  /** Human-readable reasoning for the decision. */
  reasoning: string;
  /** Risks identified that informed the decision. */
  risks: readonly string[];
  /** Source A2 verification evidence ID. */
  evidenceId: string;
  /** Optional A2.5 recommendation that informed this decision. */
  recommendationId?: string;
  /** Whether a recommendation was available when the decision was made. */
  recommendationAvailable: boolean;
  /** Whether the decision followed the available recommendation. */
  followedRecommendation: boolean;
  /** Reason for overriding the recommendation (if applicable). */
  overrideReason?: string;
  /** Policy configuration at the time the decision was made. */
  policySnapshot: GovernancePolicyConfig;
  /** The target evolution state resulting from this decision. */
  targetState: "APPROVED" | "REJECTED" | "UNDER_REVIEW";
  /** When the decision was made (ISO 8601). */
  decidedAt: string;
  /** Who or what made the decision. */
  decidedBy: "operator" | "governance_policy" | "auto_escalation";
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isValidConfidence(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}

// ---------------------------------------------------------------------------
// GovernanceDecisionKind validation
// ---------------------------------------------------------------------------

/**
 * Check if a string is a valid GovernanceDecisionKind.
 */
export function isValidGovernanceDecisionKind(
  v: string,
): v is GovernanceDecisionKind {
  return (VALID_GOVERNANCE_DECISION_KINDS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Target state validation
// ---------------------------------------------------------------------------

const VALID_TARGET_STATES = ["APPROVED", "REJECTED", "UNDER_REVIEW"] as const;

function isValidTargetState(
  v: string,
): v is "APPROVED" | "REJECTED" | "UNDER_REVIEW" {
  return (VALID_TARGET_STATES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Decided-by validation
// ---------------------------------------------------------------------------

const VALID_DECIDED_BY = [
  "operator",
  "governance_policy",
  "auto_escalation",
] as const;

function isValidDecidedBy(
  v: string,
): v is "operator" | "governance_policy" | "auto_escalation" {
  return (VALID_DECIDED_BY as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Escalate behavior validation
// ---------------------------------------------------------------------------

const VALID_ESCALATE_BEHAVIORS = ["reject", "request_evidence"] as const;

function isValidEscalateBehavior(
  v: string,
): v is "reject" | "request_evidence" {
  return (VALID_ESCALATE_BEHAVIORS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// validateGovernanceDecision
// ---------------------------------------------------------------------------

/**
 * Validate a GovernanceDecision structure.
 *
 * Pure — no side effects, no I/O, no store access.
 */
export function validateGovernanceDecision(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["GovernanceDecision must be an object"] };
  }

  const v = value as Record<string, unknown>;

  // -- Identifiers
  if (typeof v.decisionId !== "string" || !v.decisionId.startsWith("govd-")) {
    errors.push("decisionId must start with 'govd-' prefix");
  }
  if (!isNonEmptyString(v.proposalId)) {
    errors.push("proposalId required and must be non-empty");
  }
  if (!isNonEmptyString(v.evolutionId)) {
    errors.push("evolutionId required and must be non-empty");
  }

  // -- Decision kind
  if (
    typeof v.kind !== "string" ||
    !isValidGovernanceDecisionKind(v.kind as string)
  ) {
    errors.push(
      `kind must be one of: ${VALID_GOVERNANCE_DECISION_KINDS.join(", ")}`,
    );
  }

  // -- Confidence
  if (!isValidConfidence(v.confidence)) {
    errors.push("confidence required and must be a number between 0 and 1");
  }

  // -- Reasoning
  if (!isNonEmptyString(v.reasoning)) {
    errors.push("reasoning required and must be non-empty");
  }

  // -- Risks
  if (!Array.isArray(v.risks)) {
    errors.push("risks required and must be an array");
  }

  // -- Evidence
  if (!isNonEmptyString(v.evidenceId)) {
    errors.push("evidenceId required and must be non-empty");
  }

  // -- Recommendation flags
  if (typeof v.recommendationAvailable !== "boolean") {
    errors.push("recommendationAvailable required and must be a boolean");
  }
  if (typeof v.followedRecommendation !== "boolean") {
    errors.push("followedRecommendation required and must be a boolean");
  }

  // -- Policy snapshot
  if (!v.policySnapshot || typeof v.policySnapshot !== "object") {
    errors.push("policySnapshot required and must be a GovernancePolicyConfig object");
  } else {
    const ps = v.policySnapshot as Record<string, unknown>;
    if (!isNonEmptyString(ps.policyName)) {
      errors.push("policySnapshot.policyName required and must be non-empty");
    }
    if (!isValidConfidence(ps.minApproveConfidence)) {
      errors.push("policySnapshot.minApproveConfidence required and must be 0-1");
    }
    if (
      typeof ps.escalateBehavior !== "string" ||
      !isValidEscalateBehavior(ps.escalateBehavior as string)
    ) {
      errors.push(
        "policySnapshot.escalateBehavior must be 'reject' or 'request_evidence'",
      );
    }
  }

  // -- Target state
  if (
    typeof v.targetState !== "string" ||
    !isValidTargetState(v.targetState as string)
  ) {
    errors.push("targetState must be one of: APPROVED, REJECTED, UNDER_REVIEW");
  }

  // -- Timestamp
  if (!isNonEmptyString(v.decidedAt)) {
    errors.push("decidedAt required and must be non-empty");
  }

  // -- Decided by
  if (
    typeof v.decidedBy !== "string" ||
    !isValidDecidedBy(v.decidedBy as string)
  ) {
    errors.push(
      "decidedBy must be one of: operator, governance_policy, auto_escalation",
    );
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// validateGovernancePolicyConfig
// ---------------------------------------------------------------------------

/**
 * Validate a GovernancePolicyConfig structure.
 *
 * Pure — no side effects, no I/O, no store access.
 */
export function validateGovernancePolicyConfig(
  value: unknown,
): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return {
      valid: false,
      errors: ["GovernancePolicyConfig must be an object"],
    };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.policyName)) {
    errors.push("policyName required and must be non-empty");
  }

  if (!isValidConfidence(v.minApproveConfidence)) {
    errors.push("minApproveConfidence required and must be 0-1");
  }

  if (!isValidConfidence(v.minMonitorConfidence)) {
    errors.push("minMonitorConfidence required and must be 0-1");
  }

  if (!isValidConfidence(v.rejectConfidenceThreshold)) {
    errors.push("rejectConfidenceThreshold required and must be 0-1");
  }

  if (
    typeof v.maxAllowedRegressions !== "number" ||
    !Number.isInteger(v.maxAllowedRegressions) ||
    (v.maxAllowedRegressions as number) < 0
  ) {
    errors.push("maxAllowedRegressions required and must be a non-negative integer");
  }

  if (
    typeof v.escalateBehavior !== "string" ||
    !isValidEscalateBehavior(v.escalateBehavior as string)
  ) {
    errors.push("escalateBehavior must be 'reject' or 'request_evidence'");
  }

  if (typeof v.failClosedOnExpiredEvidence !== "boolean") {
    errors.push("failClosedOnExpiredEvidence required and must be a boolean");
  }

  if (
    typeof v.minReproducibilityLevel !== "number" ||
    !Number.isInteger(v.minReproducibilityLevel) ||
    (v.minReproducibilityLevel as number) < 1
  ) {
    errors.push("minReproducibilityLevel required and must be a positive integer");
  }

  // Threshold ordering validate: rejectConfidenceThreshold < minMonitorConfidence < minApproveConfidence
  const thresholds = [v.minApproveConfidence, v.minMonitorConfidence, v.rejectConfidenceThreshold].filter((t) => t !== undefined);
  if (thresholds.length === 3) {
    if (!(v.rejectConfidenceThreshold! < v.minMonitorConfidence! && v.minMonitorConfidence! < v.minApproveConfidence!)) {
      errors.push("Thresholds must satisfy: rejectConfidenceThreshold < minMonitorConfidence < minApproveConfidence");
    }
  }

  return { valid: errors.length === 0, errors };
}
