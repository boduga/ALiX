/**
 * P9.0a — Meta-Governance report type definitions.
 *
 * Defines the 5 analysis artifact types produced by the P9.0 governance
 * analysis layer. All types extend DecisionArtifact for provenance and
 * traceability. Pure data types with no storage dependencies.
 *
 * P9.0 produces reports only — no proposals, no self-mutation.
 *
 * @module
 */

import type { DecisionArtifact } from "../adaptation/decision-types.js";
import type { LensName } from "../adaptation/governance-review-types.js";

// ---------------------------------------------------------------------------
// GovernanceHealthReport
// ---------------------------------------------------------------------------

export interface GovernanceHealthReport extends DecisionArtifact {
  reportType: "governance_health";
  totalReviews: number;
  totalProposals: number;
  lensEffectiveness: Record<string, number>;
  policyCoverage: number;
  sourceMetrics: {
    dashboardIntegrityScore: number | null;
    explanationCompleteness: number | null;
    evidenceChainUsage: number | null;
    incompleteChainLayers: number;
  };
}

// ---------------------------------------------------------------------------
// GovernanceAssessment
// ---------------------------------------------------------------------------

export interface GovernanceAssessment extends DecisionArtifact {
  reportType: "governance_assessment";
  governanceConfidence: number;
  unresolvedGovernanceIssues: number;
  assessmentNotes: string[];
}

// ---------------------------------------------------------------------------
// GovernanceDriftReport
// ---------------------------------------------------------------------------

export interface DriftFinding {
  driftType: "lens_drift" | "policy_drift" | "confidence_drift" | "chain_coverage_drop";
  detectedAt: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  evidenceRefs: string[];
  description: string;
  recommendation: string;
}

export interface GovernanceDriftReport extends DecisionArtifact {
  reportType: "governance_drift";
  findings: DriftFinding[];
}

// ---------------------------------------------------------------------------
// LensLifecycleReview
// ---------------------------------------------------------------------------

export interface LensLifecycleReview extends DecisionArtifact {
  reportType: "lens_lifecycle";
  lensReviews: {
    lens: LensName;
    predictiveValue: number;
    reviewsAnalyzed: number;
    falseAlarms: number;
    missedFailures: number;
    recommendation: "keep" | "promote" | "demote" | "retire";
    reason: string;
  }[];
}

// ---------------------------------------------------------------------------
// GovernanceIntegrityReport
// ---------------------------------------------------------------------------

export interface GovernanceIntegrityReport extends DecisionArtifact {
  reportType: "governance_integrity";
  metrics: {
    totalReviews: number;
    reviewsWithProvenance: number;
    reviewsWithExplanations: number;
    reviewsLinkedToOutcomes: number;
    untraceableFindings: number;
    provenanceRate: number;
    explanationRate: number;
    outcomeLinkRate: number;
  };
}

// ---------------------------------------------------------------------------
// GovernanceRecommendation
// ---------------------------------------------------------------------------

export interface Recommendation {
  id: string;
  source: "health" | "drift" | "lens-review" | "integrity";
  sourceArtifactId: string;
  priority: "low" | "medium" | "high" | "critical";
  confidence: number;
  status: "open" | "acknowledged" | "dismissed";
  category:
    | "lens_adjustment"
    | "chain_restoration"
    | "policy_coverage"
    | "confidence_calibration"
    | "governance_integrity";
  title: string;
  description: string;
  evidenceRefs: string[];
  operatorGuidance: string;
  expectedBenefit: string;
  risks: string[];
}

export interface GovernanceRecommendation extends DecisionArtifact {
  reportType: "governance_recommendation";
  recommendations: Recommendation[];
}
