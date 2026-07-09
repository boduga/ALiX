/**
 * P22 — Handoff Intelligence Types.
 *
 * Pure types only — no filesystem, audit, CLI, or execution imports.
 * Readiness level names align with P19's ExecutionReadinessLevel.
 */

import type { ExecutionReadinessLevel } from "./execution-readiness.js";

export type EvidenceCompleteness = "full" | "partial" | "none";

export interface HandoffIntelligenceRef {
  handoffId: string;
  planId: string;
  handoffType: string;
  createdAt: string;
  readinessLevel: ExecutionReadinessLevel;
  requiredEvidenceKinds: string[];
}

export interface HandoffOutcomeAggregate {
  periodStart: string;
  periodEnd: string;
  totalHandoffs: number;
  byStatus: {
    accepted: number;
    rejected: number;
    incomplete: number;
    needsFollowUp: number;
    awaitingEvidence: number;
  };
  byReadinessLevel: Record<ExecutionReadinessLevel, number>;
  byEvidenceCompleteness: {
    full: number;
    partial: number;
    none: number;
  };
}
