/**
 * P5.7b — Lineage types for Proposal Lineage & Explainability.
 *
 * Defines the LineageGraph model consumed by the CLI renderer, JSON exporter,
 * and future Explainability API. No storage dependencies — pure data types.
 *
 * @module
 */

export type LineageCompleteness = "partial" | "complete" | "broken";

export type LineageWarningType =
  | "missing_evidence_fingerprint"
  | "orphan_effectiveness"
  | "missing_revert_snapshot"
  | "orphan_intelligence"
  | "stalled_cycle"
  | "integrity_mismatch";

export interface LineageWarning {
  type: LineageWarningType;
  message: string;
  sourceId: string;
  targetId?: string;
}

export type LineageNodeType =
  | "proposal"
  | "approval"
  | "application"
  | "effectiveness"
  | "revert"
  | "intelligence"
  | "priority"
  | "capability_evolution"
  | "evidence";

export interface LineageNode {
  id: string;
  type: LineageNodeType;
  label: string;
  timestamp: string;
  status?: string;
  detail?: Record<string, unknown>;
}

export type LineageEdgeRelation =
  | "generated_from"
  | "approved_as"
  | "applied_as"
  | "measured_as"
  | "reverted_by"
  | "analyzed_in"
  | "prioritized_in";

export interface LineageEdge {
  sourceId: string;
  targetId: string;
  relation: LineageEdgeRelation;
}

export interface LineageGraph {
  rootId: string;
  generatedAt: string;
  completeness: LineageCompleteness;
  nodes: LineageNode[];
  edges: LineageEdge[];
  warnings: LineageWarning[];
}
