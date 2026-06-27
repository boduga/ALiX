/**
 * P10.7c — Executive Recommendation Governance Bridge (pure layer).
 *
 * Converts eligible ExecutiveRecommendations from a persisted
 * RecommendationReport into draft AdaptationProposals. The pure function
 * answers only "which proposals should exist?" — it does NOT assign
 * canonical ids (the effectful handler does via nextProposalId()), does NOT
 * persist anything, and does NOT construct the report-update records.
 *
 * Eligibility:
 *   - signal ∈ {"degrading_trend", "persistent_instability"} (actionable)
 *   - proposalId === undefined (not already bridged — idempotent re-runs)
 *
 * @module
 */

import type { AdaptationProposal } from "../adaptation/adaptation-types.js";
import type {
  RecommendationReport,
  ExecutiveRecommendation,
} from "./recommendation-report-store.js";

export interface ExecutiveDraftProposal {
  /** Index of the source recommendation within report.report.recommendations. */
  recIndex: number;
  /**
   * Draft proposal with id="" — the effectful handler assigns the canonical
   * id via nextProposalId() immediately before the store persists the proposal.
   */
  proposal: AdaptationProposal;
}

export interface ExecutiveBridgeResult {
  drafts: ExecutiveDraftProposal[];
  /** Recommendations skipped due to eligibility (non-actionable signal or already-proposed). */
  skippedCount: number;
}

export function computeExecutiveProposals(
  report: RecommendationReport,
  generatedAt: string,
): ExecutiveBridgeResult {
  const recs = report.report.recommendations;
  const drafts: ExecutiveDraftProposal[] = [];
  let skippedCount = 0;

  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    if (!isEligible(rec)) {
      skippedCount++;
      continue;
    }
    drafts.push({
      recIndex: i,
      proposal: buildDraftProposal(rec, report, generatedAt),
    });
  }

  return { drafts, skippedCount };
}

function isEligible(rec: ExecutiveRecommendation): boolean {
  return (
    (rec.signal === "degrading_trend" || rec.signal === "persistent_instability") &&
    rec.proposalId === undefined
  );
}

function buildDraftProposal(
  rec: ExecutiveRecommendation,
  report: RecommendationReport,
  generatedAt: string,
): AdaptationProposal {
  return {
    id: "",
    createdAt: generatedAt,
    status: "pending",
    action: "create_improvement_issue",
    target: { kind: "issue", title: rec.recommendation },
    payload: {
      source: "executive_learning",
      subsystem: rec.subsystem,
      signal: rec.signal,
      severity: rec.severity,
      signalConfidence: rec.signalConfidence,
      occurrenceCount: rec.occurrenceCount,
      averageDelta: rec.averageDelta,
      evidenceReportIds: report.report.evidenceReportIds,
      recommendationText: rec.recommendation,
    },
    sourceRecommendationType: "executive_learning",
    sourceConfidence: rec.signalConfidence,
    evidenceFingerprints: [...report.report.evidenceReportIds],
    reason: `${rec.subsystem} — ${rec.recommendation}`,
    provenance: "manual",
  };
}
