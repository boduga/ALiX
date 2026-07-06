/**
 * Tests P14.6a — Governance Audit Emitters.
 *
 * Covers all pure event factory functions and their type mappings.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import {
  signalEvaluatedEvent,
  decisionRecordedEvent,
  actionOverriddenEvent,
} from "../../src/governance/audit-emitters.js";

import type { GovernanceSignal, SignalType } from "../../src/governance/governance-signal.js";
import type { OperatorDecision, DecisionKind } from "../../src/governance/decision-capture.js";
import type { GovernanceActionProposal, ActionProposalStatusTransition, ActionProposalKind } from "../../src/governance/action-queue.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOW = "2026-07-06T14:00:00.000Z";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeSignal(overrides: Partial<GovernanceSignal> = {}): GovernanceSignal {
  return {
    signalId: "sig-test-001",
    signalType: "trend_alert" as SignalType,
    sourcePhase: "p13.1",
    title: "Approval rate decreasing",
    description: "Approval rate dropping below threshold",
    severity: "medium",
    confidence: 0.85,
    evidenceRefs: [{ source: "ledger-analytics", id: "la-001", description: "Ledger analytics trend" }],
    recommendation: "Review approval gates",
    metadata: { trend: "decreasing" },
    status: "new",
    requestedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeDecision(
  kind: DecisionKind = "accept",
  overrides: Partial<OperatorDecision> = {},
): OperatorDecision {
  return {
    decisionId: "dec-test-001",
    signalId: "sig-test-001",
    decision: kind,
    rationale: "Operator approved the signal",
    decider: "operator-alice",
    reviewId: null,
    actionProposalId: null,
    createdAt: NOW,
    ...overrides,
  };
}

function makeProposal(overrides: Partial<GovernanceActionProposal> = {}): GovernanceActionProposal {
  return {
    proposalId: "prop-test-001",
    decisionId: "dec-test-001",
    signalId: "sig-test-001",
    kind: "escalation_review",
    title: "Escalate for review",
    description: "Escalation needed due to high risk",
    rationale: "Requires human decision",
    status: "pending",
    executionRef: null,
    createdAt: NOW,
    ...overrides,
  };
}

function makeTransition(
  status: "marked_executed_elsewhere" | "dismissed" = "marked_executed_elsewhere",
  overrides: Partial<ActionProposalStatusTransition> = {},
): ActionProposalStatusTransition {
  return {
    transitionId: "trans-test-001",
    proposalId: "prop-test-001",
    status,
    reason: status === "dismissed" ? "No longer relevant" : null,
    executionRef: status === "marked_executed_elsewhere" ? "manual/gh#456" : null,
    createdAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// signalEvaluatedEvent
// ---------------------------------------------------------------------------

describe("signalEvaluatedEvent", () => {
  it("produces POLICY_EVALUATED event type", () => {
    const event = signalEvaluatedEvent(makeSignal());
    assert.equal(event.eventType, "policy_evaluated");
  });

  it("preserves signal ID in subjectId", () => {
    const event = signalEvaluatedEvent(makeSignal({ signalId: "sig-abc" }));
    assert.equal(event.subjectId, "sig-abc");
  });

  it("includes signal title in reason", () => {
    const event = signalEvaluatedEvent(makeSignal({ title: "Test alert" }));
    assert.ok(event.reason.includes("Test alert"));
  });

  it("maps severity to risk level", () => {
    const low = signalEvaluatedEvent(makeSignal({ severity: "low" }));
    assert.equal(low.riskLevel, "low");

    const medium = signalEvaluatedEvent(makeSignal({ severity: "medium" }));
    assert.equal(medium.riskLevel, "medium");

    const high = signalEvaluatedEvent(makeSignal({ severity: "high" }));
    assert.equal(high.riskLevel, "high");

    const critical = signalEvaluatedEvent(makeSignal({ severity: "critical" }));
    assert.equal(critical.riskLevel, "critical");
  });

  it("sets requiresHumanReview for high/critical severity", () => {
    assert.equal(signalEvaluatedEvent(makeSignal({ severity: "low" })).requiresHumanReview, false);
    assert.equal(signalEvaluatedEvent(makeSignal({ severity: "critical" })).requiresHumanReview, true);
    assert.equal(signalEvaluatedEvent(makeSignal({ severity: "high" })).requiresHumanReview, true);
  });

  it("includes signal type in metadata", () => {
    const event = signalEvaluatedEvent(makeSignal({ signalType: "friction_alert" }));
    assert.equal(event.metadata.signalType, "friction_alert");
  });

  it("accepts optional traceId", () => {
    const event = signalEvaluatedEvent(makeSignal(), "trace-001");
    assert.equal(event.traceId, "trace-001");
  });
});

// ---------------------------------------------------------------------------
// decisionRecordedEvent
// ---------------------------------------------------------------------------

describe("decisionRecordedEvent", () => {
  it("maps accept → action_allowed", () => {
    const event = decisionRecordedEvent(makeDecision("accept"));
    assert.equal(event.eventType, "action_allowed");
    assert.equal(event.decision, "allowed");
  });

  it("maps dismiss → action_denied", () => {
    const event = decisionRecordedEvent(makeDecision("dismiss"));
    assert.equal(event.eventType, "action_denied");
    assert.equal(event.decision, "denied");
  });

  it("maps escalate → action_escalated", () => {
    const event = decisionRecordedEvent(makeDecision("escalate"));
    assert.equal(event.eventType, "action_escalated");
    assert.equal(event.decision, "escalated");
  });

  it("maps convert_to_issue → action_escalated", () => {
    const event = decisionRecordedEvent(makeDecision("convert_to_issue"));
    assert.equal(event.eventType, "action_escalated");
    assert.equal(event.decision, "escalated");
  });

  it("maps defer → action_allowed with decision deferred", () => {
    const event = decisionRecordedEvent(makeDecision("defer"));
    assert.equal(event.eventType, "action_allowed");
    assert.equal(event.decision, "deferred");
  });

  it("uses decider as actorId", () => {
    const event = decisionRecordedEvent(makeDecision("accept", { decider: "bob" }));
    assert.equal(event.actorId, "bob");
  });

  it("includes decision kind in metadata", () => {
    const event = decisionRecordedEvent(makeDecision("escalate"));
    assert.equal(event.metadata.decisionKind, "escalate");
  });

  it("includes rationale as reason", () => {
    const event = decisionRecordedEvent(makeDecision("accept", { rationale: "Looks good" }));
    assert.equal(event.reason, "Looks good");
  });

  it("includes signal evidence in evidenceRefs", () => {
    const signal = makeSignal({ evidenceRefs: [{ source: "test-source", id: "ref-1", description: "Test evidence" }] });
    const event = decisionRecordedEvent(makeDecision("accept"), signal);
    assert.ok(event.evidenceRefs.includes("sig-test-001"));
    assert.ok(event.evidenceRefs.some((r) => r.includes("test-source")));
  });

  it("accepts optional traceId", () => {
    const event = decisionRecordedEvent(makeDecision("accept"), undefined, "trace-decision");
    assert.equal(event.traceId, "trace-decision");
  });
});

// ---------------------------------------------------------------------------
// actionOverriddenEvent
// ---------------------------------------------------------------------------

describe("actionOverriddenEvent", () => {
  it("produces OVERRIDE_APPLIED for mark-executed", () => {
    const transition = makeTransition("marked_executed_elsewhere");
    const event = actionOverriddenEvent(transition);
    assert.equal(event.eventType, "override_applied");
    assert.equal(event.decision, "overridden");
  });

  it("produces OVERRIDE_APPLIED for dismiss", () => {
    const transition = makeTransition("dismissed", { reason: "Not needed" });
    const event = actionOverriddenEvent(transition);
    assert.equal(event.eventType, "override_applied");
    assert.equal(event.decision, "overridden");
  });

  it("includes transition reason in event", () => {
    const transition = makeTransition("dismissed", { reason: "Duplicate proposal" });
    const event = actionOverriddenEvent(transition);
    assert.ok(event.reason.includes("Duplicate proposal"));
  });

  it("includes proposal kind in metadata when proposal is provided", () => {
    const transition = makeTransition("marked_executed_elsewhere");
    const proposal = makeProposal({ kind: "github_issue" });
    const event = actionOverriddenEvent(transition, proposal);
    assert.equal(event.metadata.proposalKind, "github_issue");
  });

  it("defaults actorId to operator", () => {
    const event = actionOverriddenEvent(makeTransition());
    assert.equal(event.actorId, "operator");
  });

  it("accepts optional traceId", () => {
    const event = actionOverriddenEvent(makeTransition(), undefined, "trace-override");
    assert.equal(event.traceId, "trace-override");
  });

  it("includes transition status in metadata", () => {
    const event = actionOverriddenEvent(makeTransition("dismissed", { reason: "Done" }));
    assert.equal(event.metadata.transitionStatus, "dismissed");
  });
});

// ---------------------------------------------------------------------------
// Structural invariants
// ---------------------------------------------------------------------------

describe("audit event structure", () => {
  it("all emitters produce valid GovernanceAuditEventInput shape", () => {
    const signalEv = signalEvaluatedEvent(makeSignal());
    const decisionEv = decisionRecordedEvent(makeDecision());
    const overrideEv = actionOverriddenEvent(makeTransition());

    for (const ev of [signalEv, decisionEv, overrideEv]) {
      assert.ok(typeof ev.eventId === "string" && ev.eventId.length > 0, `eventId missing for type ${ev.eventType}`);
      assert.ok(typeof ev.timestamp === "string" && ev.timestamp.length > 0, "timestamp missing");
      assert.ok(typeof ev.eventType === "string", "eventType missing");
      assert.ok(typeof ev.actorType === "string", "actorType missing");
      assert.ok(typeof ev.actorId === "string" && ev.actorId.length > 0, "actorId missing");
      assert.ok(typeof ev.subjectType === "string", "subjectType missing");
      assert.ok(typeof ev.action === "string" && ev.action.length > 0, "action missing");
      assert.ok(typeof ev.decision === "string", "decision missing");
      assert.ok(typeof ev.reason === "string", "reason missing");
      assert.equal(Array.isArray(ev.evidenceRefs), true, "evidenceRefs must be array");
      assert.ok(typeof ev.riskLevel === "string", "riskLevel missing");
      assert.equal(typeof ev.requiresHumanReview, "boolean", "requiresHumanReview missing");
      assert.ok(ev.metadata !== null && typeof ev.metadata === "object" && !Array.isArray(ev.metadata), "metadata must be object");
    }
  });
});
