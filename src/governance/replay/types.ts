/**
 * P23 — Governance Replay Types.
 *
 * Read-only replay types for governance lifecycle analysis.
 * No filesystem, audit, CLI, execution, or store imports.
 *
 * P23.1 — Replay Input Assembler types
 * P23.2 — Counterfactual types (reserved for future slice)
 * P23.3 — Diff types (reserved for future slice)
 */

// ---------------------------------------------------------------------------
// Replay record types — normalized read models from P17–P22 source records
// ---------------------------------------------------------------------------

import type { ExecutionReadinessLevel } from "../execution-readiness.js";

// ---- P17: Approval records ------------------------------------------------

export interface ReplayApprovalRecord {
  approvalId: string;
  planId: string;
  remediationId: string;
  decision: "approved" | "rejected";
  rationale: string;
  operatorId: string;
  createdAt: string;
  approvedActionIds: readonly string[];
}

// ---- P18: Workbench lifecycle trace records -------------------------------

export interface ReplayLifecycleHop {
  kind: string;
  id: string;
  status: string;
  summary: string;
  timestamp: string;
  gap: boolean;
}

export interface ReplayLifecycleTraceRecord {
  remediationId: string;
  hops: readonly ReplayLifecycleHop[];
}

// ---- P19: Readiness projection records ------------------------------------

export interface ReplayReadinessFact {
  mutationRequired: boolean;
  reversible: boolean;
  externalSideEffect: boolean;
  rollbackPlanPresent: boolean;
}

export interface ReplayReadinessProjectionRecord {
  assessmentId: string;
  planId: string;
  remediationId: string;
  approvalId: string;
  readinessLevel: ExecutionReadinessLevel;
  facts: ReplayReadinessFact;
  reasonCodes: readonly string[];
  assessedAt: string;
}

// ---- P20: Handoff records -------------------------------------------------

export interface ReplayHandoffRecord {
  handoffId: string;
  planId: string;
  remediationId: string;
  approvalId: string;
  title: string;
  generatedAt: string;
  evidenceRequired: readonly string[];
  evidenceCaptured: boolean;
  explicitlyManualOnly: boolean;
}

// ---- P21: Closure review records ------------------------------------------

export interface ReplayClosureReviewRecord {
  closureReviewId: string;
  handoffId: string;
  decision: string;
  rationale: string;
  reviewedBy: string;
  reviewedAt: string;
  evidenceIds: readonly string[];
  followUpRequired: boolean;
  followUpSummary: string | null;
}

// ---- P22: Closure intelligence records ------------------------------------

export interface ReplaySignalSummary {
  code: string;
  severity: string;
  summary: string;
}

export interface ReplayClosureIntelligenceRecord {
  handoffId: string;
  planId: string;
  qualitySignals: readonly ReplaySignalSummary[];
  calibrationSignal: {
    calibration: string;
    readinessLevel: string;
    evidenceComplete: boolean;
  } | null;
}

// ---- Replay source summary ------------------------------------------------

export interface ReplaySourceSummary {
  approvalCount: number;
  lifecycleTraceCount: number;
  readinessProjectionCount: number;
  handoffCount: number;
  closureReviewCount: number;
  closureIntelligenceCount: number;
  sourceLifecycleIds: readonly string[];
}

// ---- Replay dataset -------------------------------------------------------

export interface GovernanceReplayDataset {
  replayId: string;
  sourceLifecycleId: string;
  assembledAt: string;

  approvals: readonly ReplayApprovalRecord[];
  lifecycleTraces: readonly ReplayLifecycleTraceRecord[];
  readinessProjections: readonly ReplayReadinessProjectionRecord[];
  handoffs: readonly ReplayHandoffRecord[];
  closureReviews: readonly ReplayClosureReviewRecord[];
  closureIntelligence: readonly ReplayClosureIntelligenceRecord[];

  sourceSummary: ReplaySourceSummary;
}

// ---------------------------------------------------------------------------
// Counterfactual scenario types (reserved for P23.2+)
// ---------------------------------------------------------------------------

export interface CounterfactualReadinessAssumptions {
  requireEvidenceCompleteness?: boolean;
  requireStrictHandoffReadiness?: boolean;
  downgradeOnHighClosureRisk?: boolean;
  flagUncertaintyOnMissingEvidence?: boolean;
  treatMissingClosureEvidenceAsUnresolved?: boolean;
  requireHumanReviewBeforeStable?: boolean;
}

export interface CounterfactualEvidenceAssumptions {
  requireFullCompleteness?: boolean;
  treatPartialAsIncomplete?: boolean;
  allowMissingOptionalEvidence?: boolean;
}

export interface CounterfactualHandoffAssumptions {
  requireAllEvidenceCaptured?: boolean;
  requireCompleteOperatorInstructions?: boolean;
  strictRollbackProcedure?: boolean;
}

export interface CounterfactualClosureAssumptions {
  treatNeedsFollowUpAsUnresolved?: boolean;
  requireRationaleMinimumLength?: number;
}

export interface CounterfactualScenario {
  scenarioId: string;
  name: string;
  description: string;

  readinessAssumptions?: CounterfactualReadinessAssumptions;
  evidenceAssumptions?: CounterfactualEvidenceAssumptions;
  handoffAssumptions?: CounterfactualHandoffAssumptions;
  closureAssumptions?: CounterfactualClosureAssumptions;

  readonly createdForReplayOnly: true;
}

// ---------------------------------------------------------------------------
// Replay evaluation output types (reserved for P23.2+)
// ---------------------------------------------------------------------------

export interface ReplayOriginalOutcome {
  readinessLevel: ExecutionReadinessLevel | null;
  evidenceCompleteness: string;
  handoffReadiness: string;
  closureDecision: string | null;
  closureRiskLevel: string | null;
  qualitySignalCount: number;
  requiresAttention: boolean;
}

export interface ReplayCounterfactualOutcome {
  readinessLevel: ExecutionReadinessLevel | null;
  evidenceCompleteness: string;
  handoffReadiness: string;
  closureDecision: string | null;
  closureRiskLevel: string | null;
  qualitySignalCount: number;
  requiresAttention: boolean;
  blocked: boolean;
  blockedReasons: readonly string[];
}

export interface ReplayDiff {
  category: string;
  details: readonly ReplayDiffDetail[];
}

export interface ReplayDiffDetail {
  category: string;
  sourceId: string;
  field: string;
  originalValue: unknown;
  counterfactualValue: unknown;
}

export interface ReplayRiskDelta {
  originalRisk: string;
  counterfactualRisk: string;
  direction: "increased" | "decreased" | "unchanged";
}

export interface ReplayCandidateLesson {
  lessonId: string;
  summary: string;
  basis: readonly string[];
  confidence: "low" | "medium" | "high";
  appliesTo: "readiness" | "handoff" | "closure" | "evidence" | "review";
  readonly requiresHumanReview: true;
}

export interface CounterfactualReplayOutcome {
  replayId: string;
  scenarioId: string;

  originalOutcome: ReplayOriginalOutcome;
  counterfactualOutcome: ReplayCounterfactualOutcome;

  diff: ReplayDiff;
  riskDelta: ReplayRiskDelta;

  candidateLessons: readonly ReplayCandidateLesson[];

  generatedAt: string;
  readonly readOnly: true;
}
