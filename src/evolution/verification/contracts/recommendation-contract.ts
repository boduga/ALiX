// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.5 — Governance Recommendation Contract.
 *
 * Defines the recommendation types produced by the verification
 * framework. Recommendations are advisory inputs to governance (A3),
 * not binding decisions.
 *
 * @module recommendation-contract
 */

import type { ValidationResult } from "../../contracts/evolution-contract.js";

// ---------------------------------------------------------------------------
// GovernanceRecommendationKind (Section 15)
// ---------------------------------------------------------------------------

/**
 * Recommendation kind produced by the verification framework.
 *
 * - `APPROVE`: Confidence high, no regressions — proceed to adaptation.
 * - `MONITOR`: Acceptable with enhanced observation — mixed outcomes.
 * - `REQUEST_ADDITIONAL_EVIDENCE`: Coverage insufficient for decision.
 * - `REJECT`: Critical regressions or confidence below minimum.
 * - `ESCALATE`: Cannot determine — human review required.
 *
 * @invariant Recommendations are advisory. Governance (A3) owns the decision.
 */
export type GovernanceRecommendationKind =
  | "APPROVE"
  | "MONITOR"
  | "REQUEST_ADDITIONAL_EVIDENCE"
  | "REJECT"
  | "ESCALATE";

export const GOVERNANCE_RECOMMENDATION_KINDS: readonly GovernanceRecommendationKind[] = [
  "APPROVE",
  "MONITOR",
  "REQUEST_ADDITIONAL_EVIDENCE",
  "REJECT",
  "ESCALATE",
];

// ---------------------------------------------------------------------------
// GovernanceRecommendation
// ---------------------------------------------------------------------------

/**
 * A governance recommendation distilled from verification evidence.
 *
 * @invariant Every recommendation carries numeric confidence.
 * @invariant Every recommendation references its source evidence.
 * @invariant Recommendations are deterministic — same evidence + same
 *            config = same recommendation.
 */
export interface GovernanceRecommendation {
  /** Unique recommendation identifier. */
  recommendationId: string;
  /** The verification evidence this recommendation is based on. */
  evidenceId: string;
  /** The evolution proposal being recommended on. */
  proposalId: string;
  /** The recommendation kind. */
  kind: GovernanceRecommendationKind;
  /** Numeric confidence in the recommendation (0–1, epistemic). */
  confidence: number;
  /** Human-readable reasoning for the recommendation. */
  reasoning: string;
  /** Evidence references supporting the recommendation. */
  supportingEvidence: string[];
  /** Risks identified during verification. */
  risks: string[];
  /** When the recommendation was generated. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isInRange(v: number, min: number, max: number): boolean {
  return !Number.isNaN(v) && v >= min && v <= max;
}

export function isValidGovernanceRecommendationKind(
  v: string,
): v is GovernanceRecommendationKind {
  return (GOVERNANCE_RECOMMENDATION_KINDS as readonly string[]).includes(v);
}

/**
 * Validate a GovernanceRecommendation structure.
 * Pure — no side effects, no I/O, no store access.
 */
export function validateGovernanceRecommendation(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["GovernanceRecommendation must be an object"] };
  }

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.recommendationId)) errors.push("recommendationId required and must be non-empty");
  if (!isNonEmptyString(v.evidenceId)) errors.push("evidenceId required and must be non-empty");
  if (!isNonEmptyString(v.proposalId)) errors.push("proposalId required and must be non-empty");

  if (typeof v.kind !== "string" || !isValidGovernanceRecommendationKind(v.kind as string)) {
    errors.push(`kind must be one of: ${GOVERNANCE_RECOMMENDATION_KINDS.join(", ")}`);
  }

  if (typeof v.confidence !== "number" || !isInRange(v.confidence as number, 0, 1)) {
    errors.push("confidence required and must be between 0 and 1");
  }

  if (!isNonEmptyString(v.reasoning)) errors.push("reasoning required and must be non-empty");
  if (!Array.isArray(v.supportingEvidence)) errors.push("supportingEvidence required and must be an array");
  if (!Array.isArray(v.risks)) errors.push("risks required and must be an array");
  if (!isNonEmptyString(v.createdAt)) errors.push("createdAt required and must be non-empty");

  return { valid: errors.length === 0, errors };
}
