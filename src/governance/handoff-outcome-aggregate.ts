/**
 * P22.1 — Closure Outcome Metrics.
 *
 * Pure read-only aggregation of P21 closure outcomes.
 * No persistence, no filesystem, no audit, no CLI, no execution imports.
 */

import type { HumanExecutionEvidenceRef } from "./human-execution-closure-types.js";
import type { HumanExecutionClosureReview } from "./human-execution-closure-types.js";
import type {
  HandoffIntelligenceRef,
  HandoffOutcomeAggregate,
  EvidenceCompleteness,
} from "./handoff-intelligence-types.js";
import type { ExecutionReadinessLevel } from "./execution-readiness.js";

export class OutcomeAggregateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutcomeAggregateError";
  }
}

const ALL_LEVELS: ExecutionReadinessLevel[] = [
  "external_side_effecting",
  "irreversible",
  "reversible",
  "dry_run_capable",
  "manual_only",
];

function deriveStatus(
  evidenceRefs: HumanExecutionEvidenceRef[],
  reviews: HumanExecutionClosureReview[],
): string {
  if (reviews.length === 0) {
    return evidenceRefs.length > 0 ? "evidence_submitted" : "awaiting_evidence";
  }
  const sorted = [...reviews].sort(
    (a, b) =>
      a.reviewedAt.localeCompare(b.reviewedAt) ||
      a.closureReviewId.localeCompare(b.closureReviewId),
  );
  const latest = sorted[sorted.length - 1]!;
  switch (latest.decision) {
    case "accepted": return "accepted";
    case "rejected": return "rejected";
    case "incomplete": return "incomplete";
    case "needs_follow_up": return "needs_follow_up";
    default: return evidenceRefs.length > 0 ? "evidence_submitted" : "awaiting_evidence";
  }
}

function deriveEvidenceCompleteness(
  ref: HandoffIntelligenceRef,
  evidenceRefs: HumanExecutionEvidenceRef[],
): EvidenceCompleteness {
  if (ref.requiredEvidenceKinds.length === 0) {
    return evidenceRefs.length > 0 ? "full" : "none";
  }
  const submittedKinds = new Set(evidenceRefs.map((e) => e.kind));
  const matched = ref.requiredEvidenceKinds.filter((k) => submittedKinds.has(k as any));
  if (matched.length === ref.requiredEvidenceKinds.length) return "full";
  if (matched.length > 0) return "partial";
  return "none";
}

export function aggregateClosureOutcomes(
  handoffRefs: HandoffIntelligenceRef[],
  evidenceRefs: HumanExecutionEvidenceRef[],
  closureReviews: HumanExecutionClosureReview[],
  periodStart: string,
  periodEnd: string,
): HandoffOutcomeAggregate {
  const startMs = Date.parse(periodStart);
  const endMs = Date.parse(periodEnd);

  if (!Number.isFinite(startMs)) {
    throw new OutcomeAggregateError(`invalid periodStart "${periodStart}"`);
  }
  if (!Number.isFinite(endMs)) {
    throw new OutcomeAggregateError(`invalid periodEnd "${periodEnd}"`);
  }
  if (startMs >= endMs) {
    throw new OutcomeAggregateError("periodStart must be before periodEnd");
  }

  // Index evidence by handoffId
  const evByHandoff = new Map<string, HumanExecutionEvidenceRef[]>();
  for (const ev of evidenceRefs) {
    const list = evByHandoff.get(ev.handoffId) ?? [];
    list.push(ev);
    evByHandoff.set(ev.handoffId, list);
  }

  // Index reviews by handoffId
  const revByHandoff = new Map<string, HumanExecutionClosureReview[]>();
  for (const rev of closureReviews) {
    const list = revByHandoff.get(rev.handoffId) ?? [];
    list.push(rev);
    revByHandoff.set(rev.handoffId, list);
  }

  // Initialize counts
  const byStatus = { accepted: 0, rejected: 0, incomplete: 0, needsFollowUp: 0, awaitingEvidence: 0 };
  const byReadinessLevel: Record<string, number> = {};
  for (const level of ALL_LEVELS) byReadinessLevel[level] = 0;
  const byEvidenceCompleteness = { full: 0, partial: 0, none: 0 };

  let totalHandoffs = 0;

  for (const ref of handoffRefs) {
    const createdAtMs = Date.parse(ref.createdAt);
    if (createdAtMs < startMs || createdAtMs >= endMs) continue;

    totalHandoffs++;

    // Readiness level
    const level = ref.readinessLevel;
    if (level in byReadinessLevel) {
      byReadinessLevel[level] = (byReadinessLevel[level] ?? 0) + 1;
    }

    // Status
    const handoffEvidence = evByHandoff.get(ref.handoffId) ?? [];
    const handoffReviews = revByHandoff.get(ref.handoffId) ?? [];
    const status = deriveStatus(handoffEvidence, handoffReviews);

    switch (status) {
      case "accepted": byStatus.accepted++; break;
      case "rejected": byStatus.rejected++; break;
      case "incomplete": byStatus.incomplete++; break;
      case "needs_follow_up": byStatus.needsFollowUp++; break;
      default: byStatus.awaitingEvidence++; break;
    }

    // Evidence completeness
    const completeness = deriveEvidenceCompleteness(ref, handoffEvidence);
    byEvidenceCompleteness[completeness]++;
  }

  return {
    periodStart,
    periodEnd,
    totalHandoffs,
    byStatus,
    byReadinessLevel: byReadinessLevel as Record<ExecutionReadinessLevel, number>,
    byEvidenceCompleteness,
  };
}
