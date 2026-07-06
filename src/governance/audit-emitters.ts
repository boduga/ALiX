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

import type { GovernanceAuditEventInput, GovernanceEventType } from "./audit-types.js";
import type { GovernanceSignal } from "./governance-signal.js";
import type { OperatorDecision, DecisionKind } from "./decision-capture.js";
import type { GovernanceActionProposal, ActionProposalStatusTransition } from "./action-queue.js";

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
