/**
 * P9.6 — InvestigationRecommendation type definitions.
 *
 * Parallel artifact to GovernanceRecommendation/Recommendation (P9.1).
 * An InvestigationRecommendation describes an operator investigation workflow
 * — NOT a mutation-capable advisory. It cannot be applied via
 * GovernanceChangeApplier.
 *
 * @module
 */

export type InvestigationKind =
  | "chain_restoration"
  | "governance_integrity";

export type InvestigationStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "dismissed";

export type InvestigationSource =
  | "drift"
  | "integrity"
  | "health";

export interface InvestigationRecommendation {
  id: string;
  kind: InvestigationKind;
  status: InvestigationStatus;
  severity: "low" | "medium" | "high" | "critical";

  source: InvestigationSource;
  sourceArtifactId: string;
  evidenceRefs: string[];

  title: string;
  description: string;
  operatorGuidance: string;

  createdAt: string;
  updatedAt?: string;
  assignedTo?: string;
  resolvedAt?: string;
  resolution?: string;

  /** Set only for records read from GovernanceStore via compatibility adapter. */
  legacySource?: {
    store: "governance";
    recommendationId: string;
    parentReportId: string;
  };
}

export interface InvestigationFilter {
  kind?: InvestigationKind;
  status?: InvestigationStatus;
  severity?: "low" | "medium" | "high" | "critical";
}
