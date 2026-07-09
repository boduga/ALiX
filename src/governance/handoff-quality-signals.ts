/**
 * P22.2 — Handoff Quality Signals.
 *
 * Pure read-only detection of quality problems in handoff packages and
 * evidence submissions. No persistence, no filesystem, no audit, no CLI,
 * no execution imports. Readiness_mismatch is kept conservative here —
 * full calibration lands in P22.3.
 */

import type { HandoffIntelligenceRef } from "./handoff-intelligence-types.js";
import type { HumanExecutionEvidenceRef } from "./human-execution-closure-types.js";
import type { HumanExecutionClosureReview } from "./human-execution-closure-types.js";

export type HandoffQualitySignalCode =
  | "evidence_gap"
  | "follow_up_needed"
  | "incomplete_submission"
  | "readiness_mismatch"
  | "slow_closure"
  | "repeated_follow_up";

export type SignalSeverity = "info" | "warning" | "critical";

export interface HandoffQualitySignal {
  signalCode: HandoffQualitySignalCode;
  handoffId: string;
  severity: SignalSeverity;
  summary: string;
  details: Record<string, unknown>;
  detectedAt: string;
}

export function detectHandoffQualitySignals(
  handoffRefs: HandoffIntelligenceRef[],
  evidenceRefs: HumanExecutionEvidenceRef[],
  closureReviews: HumanExecutionClosureReview[],
  options: { slowClosureDays?: number; detectedAt?: string } = {},
): HandoffQualitySignal[] {
  const slowClosureDays = options.slowClosureDays ?? 14;
  const detectedAt = options.detectedAt ?? new Date().toISOString();
  const signals: HandoffQualitySignal[] = [];

  // Index evidence by handoffId
  const evByHandoff = new Map<string, HumanExecutionEvidenceRef[]>();
  for (const ev of evidenceRefs) {
    const list = evByHandoff.get(ev.handoffId) ?? [];
    list.push(ev);
    evByHandoff.set(ev.handoffId, list);
  }

  // Index reviews by handoffId (sorted)
  const revByHandoff = new Map<string, HumanExecutionClosureReview[]>();
  for (const rev of closureReviews) {
    const list = revByHandoff.get(rev.handoffId) ?? [];
    list.push(rev);
    revByHandoff.set(rev.handoffId, list);
  }

  for (const ref of handoffRefs) {
    const handoffEvidence = evByHandoff.get(ref.handoffId) ?? [];
    const handoffReviews = (revByHandoff.get(ref.handoffId) ?? []).sort(
      (a, b) =>
        a.reviewedAt.localeCompare(b.reviewedAt) ||
        a.closureReviewId.localeCompare(b.closureReviewId),
    );

    const latestReview = handoffReviews.length > 0 ? handoffReviews[handoffReviews.length - 1]! : null;

    // evidence_gap: required evidence kind missing
    if (ref.requiredEvidenceKinds.length > 0) {
      const submittedKinds = new Set(handoffEvidence.map((e) => e.kind));
      const missingKinds = ref.requiredEvidenceKinds.filter(
        (k) => !submittedKinds.has(k as any),
      );
      if (missingKinds.length > 0) {
        signals.push({
          signalCode: "evidence_gap",
          handoffId: ref.handoffId,
          severity: missingKinds.length === ref.requiredEvidenceKinds.length ? "critical" : "warning",
          summary: `Evidence gap for handoff "${ref.handoffId}": missing ${missingKinds.join(", ")}`,
          details: { missingKinds, requiredCount: ref.requiredEvidenceKinds.length, submittedCount: handoffEvidence.length },
          detectedAt,
        });
      }
    }

    if (!latestReview) continue;

    // incomplete_submission
    if (latestReview.decision === "incomplete") {
      signals.push({
        signalCode: "incomplete_submission",
        handoffId: ref.handoffId,
        severity: "warning",
        summary: `Handoff "${ref.handoffId}" marked incomplete: ${latestReview.followUpSummary ?? "No details"}`,
        details: { decision: "incomplete", followUpSummary: latestReview.followUpSummary },
        detectedAt,
      });
    }

    // follow_up_needed
    if (latestReview.decision === "needs_follow_up") {
      signals.push({
        signalCode: "follow_up_needed",
        handoffId: ref.handoffId,
        severity: "info",
        summary: `Handoff "${ref.handoffId}" needs follow-up: ${latestReview.followUpSummary ?? "No details"}`,
        details: { decision: "needs_follow_up", followUpSummary: latestReview.followUpSummary },
        detectedAt,
      });
    }

    // repeated_follow_up: 2+ needs_follow_up reviews
    const followUpCount = handoffReviews.filter((r) => r.decision === "needs_follow_up").length;
    if (followUpCount >= 2) {
      signals.push({
        signalCode: "repeated_follow_up",
        handoffId: ref.handoffId,
        severity: "critical",
        summary: `Handoff "${ref.handoffId}" required follow-up ${followUpCount} times`,
        details: { followUpCount },
        detectedAt,
      });
    }

    // slow_closure: time between creation and latest review exceeds threshold
    if (latestReview) {
      const createdAtMs = Date.parse(ref.createdAt);
      const reviewedAtMs = Date.parse(latestReview.reviewedAt);
      const elapsedDays = (reviewedAtMs - createdAtMs) / (1000 * 60 * 60 * 24);
      if (elapsedDays > slowClosureDays) {
        signals.push({
          signalCode: "slow_closure",
          handoffId: ref.handoffId,
          severity: "info",
          summary: `Handoff "${ref.handoffId}" took ${Math.round(elapsedDays)} days to close (threshold: ${slowClosureDays})`,
          details: { elapsedDays: Math.round(elapsedDays), thresholdDays: slowClosureDays },
          detectedAt,
        });
      }
    }

    // readiness_mismatch (conservative): only flag clear contradictions
    // dry_run_capable or reversible that ended as rejected
    if (
      (ref.readinessLevel === "dry_run_capable" || ref.readinessLevel === "reversible") &&
      latestReview.decision === "rejected"
    ) {
      signals.push({
        signalCode: "readiness_mismatch",
        handoffId: ref.handoffId,
        severity: "warning",
        summary: `Readiness level "${ref.readinessLevel}" contradicts closure decision "rejected" for handoff "${ref.handoffId}"`,
        details: { readinessLevel: ref.readinessLevel, closureDecision: latestReview.decision },
        detectedAt,
      });
    }
  }

  // Deterministic sort: severity priority → handoffId → signalCode
  const severityOrder: Record<SignalSeverity, number> = { critical: 0, warning: 1, info: 2 };
  signals.sort((a, b) => {
    const sp = severityOrder[a.severity] - severityOrder[b.severity];
    if (sp !== 0) return sp;
    const hp = a.handoffId.localeCompare(b.handoffId);
    if (hp !== 0) return hp;
    return a.signalCode.localeCompare(b.signalCode);
  });

  return signals;
}
