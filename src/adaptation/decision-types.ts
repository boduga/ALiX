/**
 * P6.0a — DecisionContext type definitions for the Decision Influence framework.
 *
 * Defines the DecisionContext model and supporting types consumed by the
 * recommendation engine, context builder, and strategic brief layer.
 * Pure data types with no storage dependencies.
 *
 * @module
 */

import type { LineageGraph } from "./lineage-types.js";

// ---------------------------------------------------------------------------
// Base artifact pattern
// ---------------------------------------------------------------------------

/**
 * Base shape for all P6 decision artifacts.
 * Specialized forms: DecisionContext, RiskScore, Recommendation, QueueItem, StrategicBrief.
 */
export interface DecisionArtifact {
  id: string;
  subject: string;
  outcome: string;
  confidence: number;
  reasons: string[];
  warnings?: string[];
  evidenceRefs?: string[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// ContextStatus
// ---------------------------------------------------------------------------

export type ContextStatus =
  | "complete_context"    // proposal found, lineage traced, evidence available
  | "partial_context"     // some data missing (e.g., no effectiveness history)
  | "stale_context"       // proposal has had no activity for >30 days
  | "insufficient_data";  // proposal not found or critical data missing

// ---------------------------------------------------------------------------
// SourceArtifact
// ---------------------------------------------------------------------------

export type SourceArtifactType =
  | "proposal"
  | "lineage"
  | "effectiveness"
  | "intelligence"
  | "priority";

export interface SourceArtifact {
  type: SourceArtifactType;
  id: string;
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// DataFreshness
// ---------------------------------------------------------------------------

export interface DataFreshness {
  newestArtifactAgeDays: number;
  oldestArtifactAgeDays: number;
}

// ---------------------------------------------------------------------------
// DecisionContext
// ---------------------------------------------------------------------------

export interface SimilarProposal {
  proposalId: string;
  action: string;
  outcome: string;
  confidence: number;
}

export interface EffectivenessTrend {
  actionType: string;
  keepRate: number;
  revertRate: number;
  sampleSize: number;
}

export interface DecisionContext extends DecisionArtifact {
  contextStatus: ContextStatus;
  /** Evidence completeness — NOT recommendation confidence.
   *  Computed from: proposal found, lineage completeness, evidence refs,
   *  effectiveness history, similar proposals, warnings count. */
  // (confidence, reasons, warnings, evidenceRefs, generatedAt inherited from DecisionArtifact)

  // Proposal state
  proposalId: string;
  proposalStatus: string;
  proposalAction: string;
  createdAt: string;
  ageDays: number;

  // Lifecycle context (consumed from LineageBuilder)
  lineage?: LineageGraph;
  lineageCompleteness: "partial" | "complete" | "broken";

  // Intelligence context — similar proposals by action type
  similarProposals: SimilarProposal[];

  // Effectiveness history for this proposal's action type
  effectivenessTrend: EffectivenessTrend;

  // Provenance — what went into this context
  sourceArtifacts: SourceArtifact[];

  // Data freshness — age range of all consumed artifacts
  dataFreshness: DataFreshness;
}
