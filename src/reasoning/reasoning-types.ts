// src/reasoning/reasoning-types.ts
//
// P11.2 — Root Cause Analysis types.
//
// Imports:
//   CorrelationSubsystemId, CorrelationGraph, CorrelationEdge — from correlation-types
//   DriftItem — from baseline-types (comments only, no structural dependency)

import type {
  CorrelationSubsystemId,
  CorrelationGraph,
  CorrelationEdge,
} from "../correlation/correlation-types.js";

// ---------------------------------------------------------------------------
// Causal analysis
// ---------------------------------------------------------------------------

export type CausalMechanism =
  | "temporal_cascade" // A degrades → B degrades later (lag > 0, positive direction)
  | "concurrent_degradation" // A and B degrade together (lag === 0, positive, high co-occurrence)
  | "inverse_correlation" // A improves while B degrades (negative direction)
  | "degradation_chain"; // A→B→C inferred across multiple edges (indirect)

export interface LikelyCause {
  causeSubsystem: CorrelationSubsystemId;
  confidence: number; // 0–1, propagated from CorrelationEdge
  mechanism: CausalMechanism;
  chainPath?: CorrelationSubsystemId[]; // for degradation_chain only, e.g. ["memory","skills","workflow"]
  coOccurrenceRate?: number; // for concurrent_degradation, used in recommendation template
  evidenceIds: string[];
  driftItemIds: string[];
}

export interface CausalFinding {
  primarySubsystem: CorrelationSubsystemId;
  currentScore: number;
  likelyCauses: LikelyCause[];
  drivingMetric: string | null;
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Analysis result
// ---------------------------------------------------------------------------

export type AnalysisStatus =
  | "ok"
  | "no_degradation"
  | "insufficient_history"
  | "insufficient_edges"
  | "stale";

export interface RootCauseAnalysis {
  schemaVersion: "p11.2.0";
  analysisId: string;
  generatedAt: string;
  correlationGraphId: string; // SHA-256 hash of graph content
  status: AnalysisStatus;
  findings: CausalFinding[];
  meta: {
    totalSubsystemsExamined: number;
    degradedSubsystems: number;
    totalEdgesAnalyzed: number;
  };
}

// ---------------------------------------------------------------------------
// Engine configuration
// ---------------------------------------------------------------------------

export interface ReasoningEngineConfig {
  minCauseConfidence: number; // default 0.40
  maxCausesPerSubsystem: number; // default 3
  degradationThreshold: number; // default 40
  /** If set, graphs older than this many ms are treated as stale. */
  staleAfterMs?: number;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class RootCauseAnalysisError extends Error {
  readonly code = "ROOT_CAUSE_ANALYSIS_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "RootCauseAnalysisError";
  }
}
