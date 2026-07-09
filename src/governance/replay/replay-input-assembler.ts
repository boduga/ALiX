/**
 * P23.1 — Governance Replay Input Assembler.
 *
 * Assembles read-only replay datasets from P17–P22 source records.
 *
 * Pure function: no filesystem, audit, CLI, execution, or store imports.
 * Deterministic: same inputs → same dataset every time.
 * Immutable: input arrays are never mutated (readonly access only).
 */

import { createHash } from "node:crypto";

import type { GovernanceExecutionApproval } from "../execution-approval.js";
import type { WorkbenchLifecycleTrace } from "../governance-workbench.js";
import type { ExecutionReadinessAssessment } from "../execution-readiness.js";
import type { HandoffPackage } from "../handoff-builder.js";
import type { HumanExecutionEvidenceRef, HumanExecutionClosureReview } from "../human-execution-closure-types.js";
import type { HandoffIntelligenceRef } from "../handoff-intelligence-types.js";
import type { HandoffQualitySignal } from "../handoff-quality-signals.js";
import type { ReadinessCalibrationSignal } from "../handoff-readiness-calibration.js";

import type {
  GovernanceReplayDataset,
  ReplayApprovalRecord,
  ReplayLifecycleTraceRecord,
  ReplayReadinessProjectionRecord,
  ReplayReadinessFact,
  ReplayHandoffRecord,
  ReplayClosureReviewRecord,
  ReplayClosureIntelligenceRecord,
  ReplaySignalSummary,
  ReplaySourceSummary,
} from "./types.js";

// ---------------------------------------------------------------------------
// Public input interface
// ---------------------------------------------------------------------------

export interface ReplayInputSources {
  approvals?: readonly GovernanceExecutionApproval[];
  lifecycleTraces?: readonly WorkbenchLifecycleTrace[];
  readinessAssessments?: readonly ExecutionReadinessAssessment[];
  handoffs?: readonly HandoffPackage[];
  evidenceRefs?: readonly HumanExecutionEvidenceRef[];
  closureReviews?: readonly HumanExecutionClosureReview[];
  closureIntelligenceRefs?: readonly HandoffIntelligenceRef[];
  qualitySignals?: readonly HandoffQualitySignal[];
  calibrationSignals?: readonly ReadinessCalibrationSignal[];
}

// ---------------------------------------------------------------------------
// Build replay ID
// ---------------------------------------------------------------------------

function buildReplayId(sourceLifecycleId: string, assembledAt: string): string {
  return createHash("sha256")
    .update(["p23.1", sourceLifecycleId, assembledAt].join("|"))
    .digest("hex")
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// Normalizers — copy source fields into replay read models
// ---------------------------------------------------------------------------

function normalizeApproval(
  source: GovernanceExecutionApproval,
): ReplayApprovalRecord {
  return {
    approvalId: source.approvalId,
    planId: source.planId,
    remediationId: source.remediationId,
    decision: source.decision,
    rationale: source.rationale,
    operatorId: source.operatorId,
    createdAt: source.createdAt,
    approvedActionIds: Object.freeze([...source.approvedActionIds]),
  };
}

function normalizeLifecycleTrace(
  source: WorkbenchLifecycleTrace,
): ReplayLifecycleTraceRecord {
  return {
    remediationId: source.remediationId,
    hops: Object.freeze(
      source.hops.map((h) => ({
        kind: h.kind,
        id: h.id,
        status: h.status,
        summary: h.summary,
        timestamp: h.timestamp,
        gap: h.gap,
      })),
    ),
  };
}

function normalizeReadinessFact(
  source: ExecutionReadinessAssessment,
): ReplayReadinessFact {
  return {
    mutationRequired: source.facts.mutationRequired,
    reversible: source.facts.reversible,
    externalSideEffect: source.facts.externalSideEffect,
    rollbackPlanPresent: source.facts.rollbackPlanPresent,
  };
}

function normalizeReadinessProjection(
  source: ExecutionReadinessAssessment,
): ReplayReadinessProjectionRecord {
  return {
    assessmentId: source.assessmentId,
    planId: source.planId,
    remediationId: source.remediationId,
    approvalId: source.approvalId,
    readinessLevel: source.readinessLevel,
    facts: normalizeReadinessFact(source),
    reasonCodes: Object.freeze(source.reasons.map((r) => r.code)),
    assessedAt: source.assessedAt,
  };
}

function normalizeHandoff(source: HandoffPackage): ReplayHandoffRecord {
  return {
    handoffId: source.handoffId,
    planId: source.planId,
    remediationId: source.remediationId,
    approvalId: source.approvalId,
    title: source.title,
    generatedAt: source.generatedAt,
    evidenceRequired: Object.freeze(source.evidence.map((e) => e.ref)),
    evidenceCaptured: source.evidenceCaptured,
    explicitlyManualOnly: source.explicitlyManualOnly,
  };
}

function normalizeClosureReview(
  source: HumanExecutionClosureReview,
): ReplayClosureReviewRecord {
  return {
    closureReviewId: source.closureReviewId,
    handoffId: source.handoffId,
    decision: source.decision,
    rationale: source.rationale,
    reviewedBy: source.reviewedBy,
    reviewedAt: source.reviewedAt,
    evidenceIds: Object.freeze([...source.evidenceIds]),
    followUpRequired: source.followUpRequired,
    followUpSummary: source.followUpSummary,
  };
}

function normalizeSignalSummary(
  signal: HandoffQualitySignal,
): ReplaySignalSummary {
  return {
    code: signal.signalCode,
    severity: signal.severity,
    summary: signal.summary,
  };
}

function findCalibrationForHandoff(
  handoffId: string,
  calibrations: readonly ReadinessCalibrationSignal[],
): ReplayClosureIntelligenceRecord["calibrationSignal"] {
  const match = calibrations.find((c) => c.handoffId === handoffId);
  if (!match) return null;
  return {
    calibration: match.calibration,
    readinessLevel: match.readinessLevel,
    evidenceComplete: match.evidenceComplete,
  };
}

function normalizeClosureIntelligence(
  ref: HandoffIntelligenceRef,
  qualitySignals: readonly HandoffQualitySignal[],
  calibrations: readonly ReadinessCalibrationSignal[],
): ReplayClosureIntelligenceRecord {
  const matchingSignals = qualitySignals.filter(
    (s) => s.handoffId === ref.handoffId,
  );

  return {
    handoffId: ref.handoffId,
    planId: ref.planId,
    qualitySignals: Object.freeze(matchingSignals.map(normalizeSignalSummary)),
    calibrationSignal: findCalibrationForHandoff(ref.handoffId, calibrations),
  };
}

// ---------------------------------------------------------------------------
// Sort comparators (deterministic)
// ---------------------------------------------------------------------------

function compareTimestampAsc(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareIdAsc(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Dataset assembly
// ---------------------------------------------------------------------------

/**
 * Assemble a read-only replay dataset from P17–P22 source records.
 *
 * @param sourceLifecycleId - Identifier for the historical lifecycle being replayed.
 * @param sources - Allowed source records (read-only access, never mutated).
 * @param options - Optional assembly parameters.
 * @returns A deterministic, read-only replay dataset.
 */
export function assembleReplayDataset(
  sourceLifecycleId: string,
  sources: ReplayInputSources,
  options: { now?: string } = {},
): GovernanceReplayDataset {
  const assembledAt = options.now ?? new Date().toISOString();

  // ---- Normalize approvals (P17) ----
  const approvals: ReplayApprovalRecord[] = (sources.approvals ?? [])
    .map(normalizeApproval)
    .sort((a, b) => {
      const ts = compareTimestampAsc(a.createdAt, b.createdAt);
      return ts !== 0 ? ts : compareIdAsc(a.approvalId, b.approvalId);
    });

  // ---- Normalize lifecycle traces (P18) ----
  const lifecycleTraces: ReplayLifecycleTraceRecord[] = (sources.lifecycleTraces ?? [])
    .map(normalizeLifecycleTrace)
    .sort((a, b) => compareIdAsc(a.remediationId, b.remediationId));

  // ---- Normalize readiness projections (P19) ----
  const readinessProjections: ReplayReadinessProjectionRecord[] = (
    sources.readinessAssessments ?? []
  )
    .map(normalizeReadinessProjection)
    .sort((a, b) => {
      const ts = compareTimestampAsc(a.assessedAt, b.assessedAt);
      return ts !== 0 ? ts : compareIdAsc(a.assessmentId, b.assessmentId);
    });

  // ---- Normalize handoffs (P20) ----
  const handoffs: ReplayHandoffRecord[] = (sources.handoffs ?? [])
    .map(normalizeHandoff)
    .sort((a, b) => {
      const ts = compareTimestampAsc(a.generatedAt, b.generatedAt);
      return ts !== 0 ? ts : compareIdAsc(a.handoffId, b.handoffId);
    });

  // ---- Normalize closure reviews (P21) ----
  const closureReviews: ReplayClosureReviewRecord[] = (sources.closureReviews ?? [])
    .map(normalizeClosureReview)
    .sort((a, b) => {
      const ts = compareTimestampAsc(a.reviewedAt, b.reviewedAt);
      return ts !== 0 ? ts : compareIdAsc(a.closureReviewId, b.closureReviewId);
    });

  // ---- Normalize closure intelligence (P22) ----
  const allQualitySignals = sources.qualitySignals ?? [];
  const allCalibrations = sources.calibrationSignals ?? [];
  const closureIntelligence: ReplayClosureIntelligenceRecord[] = (
    sources.closureIntelligenceRefs ?? []
  )
    .map((ref) =>
      normalizeClosureIntelligence(ref, allQualitySignals, allCalibrations),
    )
    .sort((a, b) => compareIdAsc(a.handoffId, b.handoffId));

  // ---- Collect source lifecycle IDs ----
  const idSet = new Set<string>();
  for (const a of approvals) idSet.add(a.planId);
  for (const r of readinessProjections) idSet.add(r.planId);
  for (const h of handoffs) idSet.add(h.planId);
  for (const c of closureReviews) idSet.add(c.handoffId);
  for (const ci of closureIntelligence) idSet.add(ci.handoffId);

  const sourceSummary: ReplaySourceSummary = {
    approvalCount: approvals.length,
    lifecycleTraceCount: lifecycleTraces.length,
    readinessProjectionCount: readinessProjections.length,
    handoffCount: handoffs.length,
    closureReviewCount: closureReviews.length,
    closureIntelligenceCount: closureIntelligence.length,
    sourceLifecycleIds: Object.freeze(
      [...idSet].sort(compareIdAsc),
    ),
  };

  return {
    replayId: buildReplayId(sourceLifecycleId, assembledAt),
    sourceLifecycleId,
    assembledAt,
    approvals: Object.freeze(approvals),
    lifecycleTraces: Object.freeze(lifecycleTraces),
    readinessProjections: Object.freeze(readinessProjections),
    handoffs: Object.freeze(handoffs),
    closureReviews: Object.freeze(closureReviews),
    closureIntelligence: Object.freeze(closureIntelligence),
    sourceSummary,
  };
}
