/**
 * P14.6a — Governance Audit Emitters: pure event factory functions.
 *
 * Produces GovernanceAuditEventInput objects from existing governance
 * domain types (signals, decisions, proposals, transitions). These are
 * pure functions — no store access, no side effects.
 *
 * The actual auditStore.append() call happens at the CLI handler level,
 * not in domain modules.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { GovernanceAuditEventInput, GovernanceEventType, RiskLevel } from "./audit-types.js";
import type { GovernanceSignal } from "./governance-signal.js";
import type { OperatorDecision, DecisionKind } from "./decision-capture.js";
import type { GovernanceActionProposal, ActionProposalStatusTransition } from "./action-queue.js";
import type { OperatorReview } from "./operator-review.js";

// ---------------------------------------------------------------------------
// Decision kind → event type mapping
// ---------------------------------------------------------------------------

const DECISION_EVENT_MAP: Record<DecisionKind, GovernanceEventType> = {
  accept: "action_allowed",
  dismiss: "action_denied",
  defer: "action_allowed",
  escalate: "action_escalated",
  convert_to_issue: "action_escalated",
};

// ---------------------------------------------------------------------------
// Signal evaluated
// ---------------------------------------------------------------------------

/**
 * Create an audit event for a governance signal being evaluated and
 * persisted to the signal inbox.
 *
 * Maps to POLICY_EVALUATED — the signal represents the output of a
 * governance policy analysis pipeline (P13).
 */
export function signalEvaluatedEvent(
  signal: GovernanceSignal,
  traceId?: string,
): GovernanceAuditEventInput {
  return {
    eventId: `aud-${signal.signalId}`,
    timestamp: signal.createdAt,
    eventType: "policy_evaluated",
    actorType: "system",
    actorId: signal.sourcePhase ?? "governance",
    subjectType: "signal",
    subjectId: signal.signalId,
    action: "evaluate_governance_policy",
    decision: "allowed",
    policyId: null,
    policyVersion: null,
    ruleId: null,
    reason: `Signal "${signal.title}" from ${signal.sourcePhase}`,
    evidenceRefs: signal.evidenceRefs.map((r) => {
      if (typeof r === "string") return r;
      return (r as { source?: string; id?: string }).source ?? "unknown";
    }),
    requestId: null,
    traceId: traceId ?? null,
    sessionId: null,
    parentEventId: null,
    riskLevel: signal.severity === "critical" ? "critical"
      : signal.severity === "high" ? "high"
      : signal.severity === "medium" ? "medium"
      : "low",
    requiresHumanReview: signal.severity === "critical" || signal.severity === "high",
    metadata: { signalType: signal.signalType, confidence: signal.confidence },
  };
}

// ---------------------------------------------------------------------------
// Decision recorded
// ---------------------------------------------------------------------------

/**
 * Create an audit event for an operator decision recorded on a signal.
 *
 * Maps DecisionKind to event type:
 *   accept           → action_allowed
 *   dismiss          → action_denied
 *   defer            → action_allowed (with deferred reason)
 *   escalate         → action_escalated
 *   convert_to_issue → action_escalated
 */
export function decisionRecordedEvent(
  decision: OperatorDecision,
  signal?: GovernanceSignal,
  traceId?: string,
): GovernanceAuditEventInput {
  const eventType = DECISION_EVENT_MAP[decision.decision];

  return {
    eventId: `aud-${decision.decisionId}`,
    timestamp: decision.createdAt,
    eventType,
    actorType: "human",
    actorId: decision.decider,
    subjectType: "signal",
    subjectId: decision.signalId,
    action: `operator_${decision.decision}`,
    decision: eventType === "action_denied" ? "denied"
      : eventType === "action_escalated" ? "escalated"
      : decision.decision === "defer" ? "deferred"
      : "allowed",
    policyId: null,
    policyVersion: null,
    ruleId: null,
    reason: decision.rationale,
    evidenceRefs: [decision.signalId, ...(signal?.evidenceRefs?.map((r) => {
      if (typeof r === "string") return r;
      return (r as { source?: string; id?: string }).source ?? "unknown";
    }) ?? [])],
    requestId: null,
    traceId: traceId ?? null,
    sessionId: null,
    parentEventId: null,
    riskLevel: decision.decision === "escalate" ? "high" : "low",
    requiresHumanReview: false,
    metadata: {
      decisionKind: decision.decision,
      reviewId: decision.reviewId,
      actionProposalId: decision.actionProposalId,
    },
  };
}

// ---------------------------------------------------------------------------
// Action overridden
// ---------------------------------------------------------------------------

/**
 * Create an audit event for an action proposal status transition that
 * represents an override (mark-executed or dismiss).
 */
export function actionOverriddenEvent(
  transition: ActionProposalStatusTransition,
  proposal?: GovernanceActionProposal,
  traceId?: string,
): GovernanceAuditEventInput {
  return {
    eventId: `aud-${transition.transitionId}`,
    timestamp: transition.createdAt,
    eventType: "override_applied",
    actorType: "human",
    actorId: "operator",
    subjectType: "proposal",
    subjectId: transition.proposalId,
    action: transition.status === "marked_executed_elsewhere"
      ? "mark_executed" : "dismiss",
    decision: "overridden",
    policyId: null,
    policyVersion: null,
    ruleId: null,
    reason: transition.reason ?? `Proposal ${transition.status}`,
    evidenceRefs: [transition.proposalId],
    requestId: null,
    traceId: traceId ?? null,
    sessionId: null,
    parentEventId: null,
    riskLevel: "medium",
    requiresHumanReview: false,
    metadata: {
      transitionStatus: transition.status,
      executionRef: transition.executionRef,
      proposalKind: proposal?.kind ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Proposal kind → risk level mapping
// ---------------------------------------------------------------------------

const PROPOSAL_RISK_MAP: Record<string, RiskLevel> = {
  escalation_review: "high",
  github_issue: "medium",
};

// ---------------------------------------------------------------------------
// Action proposed
// ---------------------------------------------------------------------------

/**
 * Create an audit event for an action proposal being created in the queue.
 *
 * Maps to ACTION_ESCALATED — a proposal represents an escalated decision
 * that has been converted into an actionable item. This is a distinct
 * factory from decisionRecordedEvent() because proposal action escalation
 * is a separate governance event from operator decision recording.
 */
export function actionProposedEvent(
  proposal: GovernanceActionProposal,
  traceId?: string,
): GovernanceAuditEventInput {
  return {
    eventId: `aud-${proposal.proposalId}`,
    timestamp: proposal.createdAt,
    eventType: "action_escalated",
    actorType: "system",
    actorId: "governance",
    subjectType: "proposal",
    subjectId: proposal.proposalId,
    action: "escalate",
    decision: "escalated",
    policyId: null,
    policyVersion: null,
    ruleId: null,
    reason: `Action proposal "${proposal.title}" (${proposal.kind}) created from decision ${proposal.decisionId}`,
    evidenceRefs: [proposal.decisionId, proposal.signalId],
    requestId: null,
    traceId: traceId ?? null,
    sessionId: null,
    parentEventId: null,
    riskLevel: PROPOSAL_RISK_MAP[proposal.kind] ?? "medium",
    requiresHumanReview: true,
    metadata: {
      proposalKind: proposal.kind,
      sourceDecisionId: proposal.decisionId,
      targetRef: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Review submitted
// ---------------------------------------------------------------------------

/**
 * Create an audit event for an operator review being submitted on a signal.
 *
 * Maps to HUMAN_APPROVAL_REQUESTED — the review represents a human operator
 * examining a governance signal and providing notes/classification.
 */
export function reviewSubmittedEvent(
  review: OperatorReview,
  traceId?: string,
): GovernanceAuditEventInput {
  return {
    eventId: `aud-${review.reviewId}`,
    timestamp: review.createdAt,
    eventType: "human_approval_requested",
    actorType: "human",
    actorId: review.reviewer,
    subjectType: "signal",
    subjectId: review.signalId,
    action: "submit_review",
    decision: "allowed",
    policyId: null,
    policyVersion: null,
    ruleId: null,
    reason: `Review by ${review.reviewer} on signal ${review.signalId}`,
    evidenceRefs: [review.signalId],
    requestId: null,
    traceId: traceId ?? null,
    sessionId: null,
    parentEventId: null,
    riskLevel: "medium",
    requiresHumanReview: false,
    metadata: {
      reviewId: review.reviewId,
      hasNotes: review.notes !== null,
      hasClassification: review.classification !== null,
    },
  };
}
