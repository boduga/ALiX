// src/correlation/correlation-types.ts

import type { DriftItem } from "../baseline/baseline-types.js";

export type CorrelationSubsystemId =
  | "memory" | "workflow" | "skills" | "agents"
  | "tools" | "security" | "governance" | "adaptation";

export type BaselineSubsystemId = CorrelationSubsystemId | "demo";

export type CorrelationDirection = "positive" | "negative" | "none";

export type CorrelationGraphStatus = "ok" | "insufficient_history" | "stale";

export type CorrelationNodeStatus =
  | "excellent" | "healthy" | "warning" | "critical" | "unknown";

export interface CorrelationEdge {
  source: CorrelationSubsystemId;
  target: CorrelationSubsystemId;
  coOccurrenceRate: number;
  temporalLag: number;
  correlationDirection: CorrelationDirection;
  correlationConfidence: number;
  evidenceIds: string[];
}

export interface CorrelationNode {
  subsystem: CorrelationSubsystemId;
  score: number;
  status: CorrelationNodeStatus;
  drift: DriftItem[];
  evidenceIds: string[];
}

export interface CorrelationGraph {
  schemaVersion: "p11.1.0";
  generatedAt: string;
  windowSize: number;
  status: CorrelationGraphStatus;
  nodes: CorrelationNode[];
  edges: CorrelationEdge[];
  meta: {
    totalSnapshotsExamined: number;
    minConfidenceThreshold: number;
    maxLagExamined: number;
    degradationThreshold: number;
    canonicalSubsystems: CorrelationSubsystemId[];
    excludedSubsystems: string[];
  };
}

export interface CorrelationEngineConfig {
  windowSize: number;
  minSamples: number;
  maxTemporalLag: number;
  degradationDeltaThreshold: number;
  minEdgeConfidence: number;
  staleAfterWindows: number;
  canonicalSubsystems: CorrelationSubsystemId[];
  excludedSubsystems: string[];
}

export class CorrelationGraphLoadError extends Error {
  readonly code = "CORRELATION_GRAPH_LOAD_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "CorrelationGraphLoadError";
  }
}
