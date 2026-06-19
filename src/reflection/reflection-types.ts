/**
 * P5.0a — ReflectionReport schema and Analyzer interface.
 *
 * Core type definitions for the ReflectionAgent phase of the autonomous
 * execution pipeline.  These types are shared by every Analyzer implementation
 * (Tasks 2–6) and by the ReflectionAgent orchestrator (Task 7).
 */

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

export type ObservationSeverity = "high" | "medium" | "low";

export type ObservationType =
  | "workflow_stall" | "workflow_failure"
  | "capability_gap" | "routing_inefficiency"
  | "quality_decline" | "test_coverage_gap";

export interface Observation {
  type: ObservationType;
  severity: ObservationSeverity;
  title: string;
  detail: string;
  source: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

export type RecommendationType =
  | "capability_gap" | "routing_adjustment"
  | "skill_revision" | "agent_card_update" | "process_change";

export interface Recommendation {
  type: RecommendationType;
  confidence: number;
  title: string;
  evidence: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface ReflectionMetrics {
  workflowsCompleted: number;
  workflowsBlocked: number;
  workflowsAborted: number;
  capabilitiesRequested: number;
  unresolvedCapabilities: number;
  reviewApprovalRate: number;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface ReflectionReport {
  generatedAt: string;
  observations: Observation[];
  recommendations: Recommendation[];
  metrics: ReflectionMetrics;
  summary: {
    totalObservations: number;
    totalRecommendations: number;
    highSeverityCount: number;
  };
}

// ---------------------------------------------------------------------------
// Analyzer
// ---------------------------------------------------------------------------

export interface AnalysisResult {
  observations: Observation[];
  recommendations: Recommendation[];
}

export interface Analyzer {
  name: string;
  analyze(): Promise<AnalysisResult>;
}
