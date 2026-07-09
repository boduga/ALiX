/**
 * P21.4 — Closure Report.
 *
 * Pure read-only report builder. Derives closure status from handoff refs,
 * evidence refs, and closure reviews. No filesystem, audit, CLI, or
 * execution imports.
 */

import type { HumanExecutionEvidenceRef } from "./human-execution-closure-types.js";
import type { HumanExecutionClosureReview } from "./human-execution-closure-types.js";

export type HumanExecutionClosureReportStatus =
  | "awaiting_evidence"
  | "evidence_submitted"
  | "accepted"
  | "rejected"
  | "incomplete"
  | "needs_follow_up";

export interface HumanExecutionClosureReportItem {
  handoffId: string;
  preparedRecordId: string | null;
  title: string;
  status: HumanExecutionClosureReportStatus;
  evidenceCount: number;
  latestReviewDecision: string | null;
  latestReviewAt: string | null;
  followUpRequired: boolean;
  auditRefCount: number;
}

export interface HumanExecutionClosureReportTotals {
  handoffs: number;
  withEvidence: number;
  accepted: number;
  rejected: number;
  incomplete: number;
  needsFollowUp: number;
  awaitingEvidence: number;
}

export interface HumanExecutionClosureReport {
  windowStart: string;
  windowEnd: string;
  totals: HumanExecutionClosureReportTotals;
  items: HumanExecutionClosureReportItem[];
}

export interface HandoffRef {
  handoffId: string;
  preparedRecordId: string | null;
  title: string;
  createdAt: string;
}

const STATUS_PRIORITY: Record<HumanExecutionClosureReportStatus, number> = {
  needs_follow_up: 0,
  incomplete: 1,
  awaiting_evidence: 2,
  evidence_submitted: 3,
  rejected: 4,
  accepted: 5,
};

function deriveStatus(
  evidenceRefs: HumanExecutionEvidenceRef[],
  reviews: HumanExecutionClosureReview[],
): HumanExecutionClosureReportStatus {
  if (reviews.length === 0) {
    return evidenceRefs.length > 0 ? "evidence_submitted" : "awaiting_evidence";
  }

  // Sort by reviewedAt then closureReviewId to find latest
  const sorted = [...reviews].sort(
    (a, b) =>
      a.reviewedAt.localeCompare(b.reviewedAt) ||
      a.closureReviewId.localeCompare(b.closureReviewId),
  );
  const latest = sorted[sorted.length - 1]!;

  switch (latest.decision) {
    case "accepted":
      return "accepted";
    case "rejected":
      return "rejected";
    case "incomplete":
      return "incomplete";
    case "needs_follow_up":
      return "needs_follow_up";
    default:
      return evidenceRefs.length > 0 ? "evidence_submitted" : "awaiting_evidence";
  }
}

export function buildHumanExecutionClosureReport(
  handoffRefs: HandoffRef[],
  evidenceRefs: HumanExecutionEvidenceRef[],
  closureReviews: HumanExecutionClosureReview[],
  options: { since?: string; until?: string; now?: string } = {},
): HumanExecutionClosureReport {
  const now = options.now ?? new Date().toISOString();
  const windowEnd = options.until ?? now;
  const windowStart =
    options.since ??
    new Date(Date.parse(windowEnd) - 7 * 24 * 60 * 60 * 1000).toISOString();
  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);

  // Index evidence by handoffId
  const evidenceByHandoff = new Map<string, HumanExecutionEvidenceRef[]>();
  for (const ev of evidenceRefs) {
    const list = evidenceByHandoff.get(ev.handoffId) ?? [];
    list.push(ev);
    evidenceByHandoff.set(ev.handoffId, list);
  }

  // Index reviews by handoffId
  const reviewsByHandoff = new Map<string, HumanExecutionClosureReview[]>();
  for (const rev of closureReviews) {
    const list = reviewsByHandoff.get(rev.handoffId) ?? [];
    list.push(rev);
    reviewsByHandoff.set(rev.handoffId, list);
  }

  const items: HumanExecutionClosureReportItem[] = [];

  for (const h of handoffRefs) {
    const createdAtMs = Date.parse(h.createdAt);
    if (createdAtMs < startMs || createdAtMs >= endMs) continue;

    const handoffEvidence = evidenceByHandoff.get(h.handoffId) ?? [];
    const handoffReviews = reviewsByHandoff.get(h.handoffId) ?? [];

    const status = deriveStatus(handoffEvidence, handoffReviews);

    const latestReview =
      handoffReviews.length > 0
        ? [...handoffReviews].sort(
            (a, b) =>
              a.reviewedAt.localeCompare(b.reviewedAt) ||
              a.closureReviewId.localeCompare(b.closureReviewId),
          )[handoffReviews.length - 1]!
        : null;

    items.push({
      handoffId: h.handoffId,
      preparedRecordId: h.preparedRecordId,
      title: h.title,
      status,
      evidenceCount: handoffEvidence.length,
      latestReviewDecision: latestReview?.decision ?? null,
      latestReviewAt: latestReview?.reviewedAt ?? null,
      followUpRequired: status === "needs_follow_up" || status === "incomplete",
      auditRefCount: handoffEvidence.reduce(
        (sum, ev) => sum + ev.auditRefs.length,
        0,
      ),
    });
  }

  items.sort((a, b) => {
    // 1. followUpRequired true first
    if (a.followUpRequired !== b.followUpRequired) {
      return a.followUpRequired ? -1 : 1;
    }
    // 2. status priority
    const sp = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (sp !== 0) return sp;
    // 3. latestReviewAt ascending, nulls first
    if (a.latestReviewAt !== b.latestReviewAt) {
      if (a.latestReviewAt === null) return -1;
      if (b.latestReviewAt === null) return 1;
      const cmp = a.latestReviewAt.localeCompare(b.latestReviewAt);
      if (cmp !== 0) return cmp;
    }
    // 4. handoffId ascending
    return a.handoffId.localeCompare(b.handoffId);
  });

  const countStatus = (s: HumanExecutionClosureReportStatus) =>
    items.filter((i) => i.status === s).length;

  return {
    windowStart,
    windowEnd,
    totals: {
      handoffs: items.length,
      withEvidence: items.filter((i) => i.evidenceCount > 0).length,
      accepted: countStatus("accepted"),
      rejected: countStatus("rejected"),
      incomplete: countStatus("incomplete"),
      needsFollowUp: countStatus("needs_follow_up"),
      awaitingEvidence: countStatus("awaiting_evidence"),
    },
    items,
  };
}
