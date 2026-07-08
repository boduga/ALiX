/**
 * P15.3a — Operator Outcome Signals.
 *
 * Pure module measuring whether operator decisions produce stable, useful
 * governance outcomes — no ranking, no punitive scoring, no ML.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { GovernanceAuditEvent } from "./audit-types.js";
import type { OperatorDecision } from "./decision-capture.js";
import type { OperatorReview } from "./operator-review.js";
import type { GovernanceActionProposal, ActionProposalStatusTransition } from "./action-queue.js";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface OperatorEffectivenessReport {
  windowStart: string;
  windowEnd: string;
  decisionStability: DecisionStability;
  escalationEffectiveness: EscalationEffectiveness;
  reviewCompleteness: ReviewCompleteness;
  staleDecisions: StaleDecisions;
  throughputContext: ThroughputContext;
}

export interface DecisionStability {
  totalDecisions: number;
  reversed: number;
  reversalRate: number;
  decisionCounts: Record<string, number>;
}

export interface EscalationEffectiveness {
  totalEscalations: number;
  producedProposals: number;
  escalationToActionRate: number;
  resolvedProposals: number;
  resolutionRate: number;
  medianResolutionMs: number | null;
  pendingEscalations: number;
}

export interface ReviewCompleteness {
  totalReviews: number;
  withNotes: number;
  withClassification: number;
  withBoth: number;
  completenessRate: number;
}

export interface StaleDecisions {
  totalDeferred: number;
  staleCount: number;
  staleThresholdDays: number;
  averageStaleDays: number | null;
  stale: Array<{
    decisionId: string;
    signalId: string;
    deferredAt: string;
    daysSinceDeferral: number;
  }>;
}

export interface ThroughputContext {
  decisionsByOperator: Array<{ operatorId: string; count: number }>;
  reviewsByOperator: Array<{ operatorId: string; count: number }>;
  totalDecisions: number;
  totalReviews: number;
}

export interface EffectivenessOptions {
  staleThresholdDays?: number;
  /** ISO timestamp for "now" — used in tests to avoid time sensitivity. */
  now?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function epochMs(ts: string): number {
  return new Date(ts).getTime();
}

function daysBetween(a: string, b: string): number {
  return (epochMs(b) - epochMs(a)) / 86_400_000;
}

/** Events that contradict an accept decision. */
const ACCEPT_CONTRADICT = new Set(["action_denied", "override_applied"]);
/** Events that contradict a dismiss decision. */
const DENY_CONTRADICT = new Set(["action_allowed", "override_applied"]);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function computeEffectiveness(
  auditEvents: GovernanceAuditEvent[],
  decisions: OperatorDecision[],
  reviews: OperatorReview[],
  proposals: GovernanceActionProposal[],
  transitions: ActionProposalStatusTransition[],
  options?: EffectivenessOptions,
): OperatorEffectivenessReport {
  const staleThresholdDays = options?.staleThresholdDays ?? 7;
  const now = options?.now ?? new Date().toISOString();

  // Derive boundaries from decision timestamps
  const ts = decisions.map((d) => d.createdAt);
  const windowStart = ts.length > 0 ? ts.reduce((a, b) => (a < b ? a : b)) : now;
  const windowEnd = ts.length > 0 ? ts.reduce((a, b) => (a > b ? a : b)) : now;

  return {
    windowStart,
    windowEnd,
    decisionStability: computeDecisionStability(decisions, auditEvents),
    escalationEffectiveness: computeEscalationEffectiveness(decisions, proposals, transitions),
    reviewCompleteness: computeReviewCompleteness(reviews),
    staleDecisions: computeStaleDecisions(decisions, auditEvents, staleThresholdDays, now),
    throughputContext: computeThroughput(decisions, reviews),
  };
}

// ---------------------------------------------------------------------------
// 1. Decision stability
// ---------------------------------------------------------------------------

function computeDecisionStability(
  decisions: OperatorDecision[],
  auditEvents: GovernanceAuditEvent[],
): DecisionStability {
  const counts: Record<string, number> = {};
  let reversed = 0;

  for (const d of decisions) {
    counts[d.decision] = (counts[d.decision] ?? 0) + 1;

    const contradictSet = d.decision === "accept"
      ? ACCEPT_CONTRADICT
      : d.decision === "dismiss"
        ? DENY_CONTRADICT
        : null;

    if (!contradictSet) continue;

    const hasContradiction = auditEvents.some(
      (e) =>
        e.timestamp > d.createdAt &&
        (e.subjectId === d.signalId || e.traceId === d.signalId) &&
        contradictSet.has(e.eventType),
    );

    if (hasContradiction) reversed++;
  }

  return {
    totalDecisions: decisions.length,
    reversed,
    reversalRate: decisions.length > 0 ? reversed / decisions.length : 0,
    decisionCounts: counts,
  };
}

// ---------------------------------------------------------------------------
// 2. Escalation effectiveness
// ---------------------------------------------------------------------------

function computeEscalationEffectiveness(
  decisions: OperatorDecision[],
  proposals: GovernanceActionProposal[],
  transitions: ActionProposalStatusTransition[],
): EscalationEffectiveness {
  const escalations = decisions.filter(
    (d) => d.decision === "escalate" || d.decision === "convert_to_issue",
  );

  const totalEscalations = escalations.length;
  const escDecisionIds = new Set(escalations.map((d) => d.decisionId));

  const matchingProposals = proposals.filter((p) => escDecisionIds.has(p.decisionId));
  const producedProposals = matchingProposals.length;

  const resolvedProposals = matchingProposals.filter((p) => {
    const pt = transitions.filter((t) => t.proposalId === p.proposalId);
    return pt.some((t) => t.status === "marked_executed_elsewhere" || t.status === "dismissed");
  }).length;

  // Median time-to-resolution (from decision to terminal transition)
  const resolutionTimes: number[] = [];
  for (const p of matchingProposals) {
    const decision = escalations.find((d) => d.decisionId === p.decisionId);
    if (!decision) continue;
    const terminal = transitions.find(
      (t) => t.proposalId === p.proposalId && (t.status === "marked_executed_elsewhere" || t.status === "dismissed"),
    );
    if (terminal) {
      resolutionTimes.push(epochMs(terminal.createdAt) - epochMs(decision.createdAt));
    }
  }
  resolutionTimes.sort((a, b) => a - b);
  const medianResolutionMs =
    resolutionTimes.length > 0
      ? resolutionTimes.length % 2 === 1
        ? resolutionTimes[Math.floor(resolutionTimes.length / 2)]!
        : (resolutionTimes[resolutionTimes.length / 2 - 1]! + resolutionTimes[resolutionTimes.length / 2]!) / 2
      : null;

  return {
    totalEscalations,
    producedProposals,
    escalationToActionRate: totalEscalations > 0 ? producedProposals / totalEscalations : 0,
    resolvedProposals,
    resolutionRate: producedProposals > 0 ? resolvedProposals / producedProposals : 0,
    medianResolutionMs,
    pendingEscalations: totalEscalations - producedProposals,
  };
}

// ---------------------------------------------------------------------------
// 3. Review completeness
// ---------------------------------------------------------------------------

function computeReviewCompleteness(reviews: OperatorReview[]): ReviewCompleteness {
  const withNotes = reviews.filter((r) => r.notes !== null).length;
  const withClassification = reviews.filter((r) => r.classification !== null).length;
  const withBoth = reviews.filter((r) => r.notes !== null && r.classification !== null).length;

  return {
    totalReviews: reviews.length,
    withNotes,
    withClassification,
    withBoth,
    completenessRate: reviews.length > 0 ? withBoth / reviews.length : 0,
  };
}

// ---------------------------------------------------------------------------
// 4. Stale decisions
// ---------------------------------------------------------------------------

function computeStaleDecisions(
  decisions: OperatorDecision[],
  auditEvents: GovernanceAuditEvent[],
  staleThresholdDays: number,
  now: string,
): StaleDecisions {
  const deferred = decisions.filter((d) => d.decision === "defer");

  const stale: StaleDecisions["stale"] = [];

  for (const d of deferred) {
    const hasTerminal = auditEvents.some(
      (e) =>
        e.timestamp > d.createdAt &&
        (e.subjectId === d.signalId) &&
        (e.eventType === "action_allowed" || e.eventType === "action_denied"),
    );

    if (hasTerminal) continue;

    const ageDays = daysBetween(d.createdAt, now);
    if (ageDays >= staleThresholdDays) {
      stale.push({
        decisionId: d.decisionId,
        signalId: d.signalId,
        deferredAt: d.createdAt,
        daysSinceDeferral: ageDays,
      });
    }
  }

  stale.sort((a, b) => {
    const byTime = a.deferredAt.localeCompare(b.deferredAt);
    return byTime !== 0 ? byTime : a.decisionId.localeCompare(b.decisionId);
  });

  const avgDays =
    stale.length > 0
      ? stale.reduce((s, x) => s + x.daysSinceDeferral, 0) / stale.length
      : null;

  return {
    totalDeferred: deferred.length,
    staleCount: stale.length,
    staleThresholdDays,
    averageStaleDays: avgDays,
    stale,
  };
}

// ---------------------------------------------------------------------------
// 5. Throughput (descriptive only — no ranking)
// ---------------------------------------------------------------------------

function computeThroughput(
  decisions: OperatorDecision[],
  reviews: OperatorReview[],
): ThroughputContext {
  const decMap = new Map<string, number>();
  for (const d of decisions) {
    decMap.set(d.decider, (decMap.get(d.decider) ?? 0) + 1);
  }
  const revMap = new Map<string, number>();
  for (const r of reviews) {
    revMap.set(r.reviewer, (revMap.get(r.reviewer) ?? 0) + 1);
  }

  const sortAlpha = (a: { operatorId: string }, b: { operatorId: string }) =>
    a.operatorId.localeCompare(b.operatorId);

  return {
    decisionsByOperator: Array.from(decMap.entries())
      .map(([operatorId, count]) => ({ operatorId, count }))
      .sort(sortAlpha),
    reviewsByOperator: Array.from(revMap.entries())
      .map(([operatorId, count]) => ({ operatorId, count }))
      .sort(sortAlpha),
    totalDecisions: decisions.length,
    totalReviews: reviews.length,
  };
}
