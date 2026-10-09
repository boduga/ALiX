/**
 * P6.0b — RiskScore types.
 *
 * RiskScore is a deterministic, read-only risk assessment computed from
 * a DecisionContext. It answers "what could go wrong?" without making
 * recommendations.
 *
 * @module
 */

import type { DecisionArtifact, SourceArtifact } from "./decision-types.js";

// ---------------------------------------------------------------------------
// RiskDimension
// ---------------------------------------------------------------------------

export type RiskDimension =
  | "governance"
  | "operational"
  | "capability"
  | "revertability"
  | "evidence_quality";

export const RISK_DIMENSIONS: readonly RiskDimension[] = [
  "governance",
  "operational",
  "capability",
  "revertability",
  "evidence_quality",
];

// ---------------------------------------------------------------------------
// RiskItem
// ---------------------------------------------------------------------------

export interface RiskItem {
  dimension: RiskDimension;
  /** 0-1 where 0 = no risk, 1 = critical risk. */
  score: number;
  /** Confidence in this score (0-1). */
  confidence: number;
  /** Human-readable justifications. Matches DecisionArtifact.reasons pattern. */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// RiskScore
// ---------------------------------------------------------------------------

export type RiskOutcome = "low" | "medium" | "high" | "critical";

/**
 * Convert a numeric overallRisk (0-1) to a RiskOutcome label.
 * Pure function, no side effects.
 */
export function riskOutcomeFromScore(overallRisk: number): RiskOutcome {
  if (overallRisk < 0.3) return "low";
  if (overallRisk < 0.6) return "medium";
  if (overallRisk < 0.85) return "high";
  return "critical";
}

export interface RiskScore extends DecisionArtifact {
  /** Overall risk level (0-1). */
  overallRisk: number;

  /** Per-dimension breakdown. */
  risks: RiskItem[];

  /** Convenience accessor — per-dimension scores. */
  dimensions: Record<RiskDimension, number>;

  /** Provenance — preserves chain from DecisionContext. */
  sourceArtifacts: SourceArtifact[];
}
