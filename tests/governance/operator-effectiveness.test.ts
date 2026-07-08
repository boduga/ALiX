/**
 * Tests for P15.3a — Operator Outcome Signals.
 *
 * @module
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeEffectiveness } from "../../src/governance/operator-effectiveness.js";
import type { GovernanceAuditEvent, GovernanceEventType } from "../../src/governance/audit-types.js";
import type { OperatorDecision } from "../../src/governance/decision-capture.js";
import type { OperatorReview } from "../../src/governance/operator-review.js";
import type { GovernanceActionProposal, ActionProposalStatusTransition } from "../../src/governance/action-queue.js";

const T = "2026-07-07T14:00:00.000Z";
const LATER = "2026-07-07T15:00:00.000Z";
const MUCH_LATER = "2026-07-10T14:00:00.000Z";

function makeDecision(overrides: Partial<OperatorDecision> = {}): OperatorDecision {
  return {
    decisionId: "dec-test",
    signalId: "sig-test",
    decision: "accept",
    rationale: "ok",
    decider: "alice",
    reviewId: null,
    actionProposalId: null,
    createdAt: T,
    ...overrides,
  };
}

function makeReview(overrides: Partial<OperatorReview> = {}): OperatorReview {
  return {
    reviewId: "rev-test",
    signalId: "sig-test",
    reviewer: "alice",
    notes: "looks fine",
    classification: "valid",
    createdAt: T,
    ...overrides,
  };
}

function makeProposal(overrides: Partial<GovernanceActionProposal> = {}): GovernanceActionProposal {
  return {
    proposalId: "prop-test",
    decisionId: "dec-escalate",
    signalId: "sig-escalate",
    kind: "escalation_review",
    title: "Escalate",
    description: "desc",
    rationale: "needs review",
    status: "pending",
    executionRef: null,
    createdAt: T,
    ...overrides,
  };
}

function makeTransition(overrides: Partial<ActionProposalStatusTransition> = {}): ActionProposalStatusTransition {
  return {
    transitionId: "tr-test",
    proposalId: "prop-test",
    status: "marked_executed_elsewhere",
    reason: null,
    executionRef: "gh#123",
    createdAt: LATER,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<GovernanceAuditEvent> = {}): GovernanceAuditEvent {
  return {
    eventId: "evt-test",
    timestamp: T,
    eventType: "action_allowed",
    actorType: "system",
    actorId: "gov",
    subjectType: "signal",
    subjectId: "sig-test",
    action: "allow",
    decision: "allowed",
    policyId: null,
    policyVersion: null,
    ruleId: null,
    reason: "test",
    evidenceRefs: [],
    requestId: null,
    traceId: "trace-test",
    sessionId: null,
    parentEventId: null,
    riskLevel: "low",
    requiresHumanReview: false,
    metadata: {},
    previousHash: null,
    eventHash: "h",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Decision stability
// ---------------------------------------------------------------------------

describe("decision stability", () => {
  it("accept with no contradiction → reversalRate = 0", () => {
    const r = computeEffectiveness([], [makeDecision()], [], [], []);
    assert.equal(r.decisionStability.reversalRate, 0);
  });

  it("accept followed by action_denied → reversalRate > 0", () => {
    const events = [makeEvent({ eventType: "action_denied", timestamp: LATER })];
    const r = computeEffectiveness(events, [makeDecision()], [], [], []);
    assert.equal(r.decisionStability.reversed, 1);
    assert.equal(r.decisionStability.reversalRate, 1);
  });

  it("deny followed by action_allowed → reversal", () => {
    const d = makeDecision({ decision: "dismiss" });
    const events = [makeEvent({ eventType: "action_allowed", timestamp: LATER })];
    const r = computeEffectiveness(events, [d], [], [], []);
    assert.equal(r.decisionStability.reversed, 1);
  });

  it("contradiction before decision → not a reversal", () => {
    const events = [makeEvent({ eventType: "action_denied", timestamp: "2026-07-07T13:00:00.000Z" })];
    const r = computeEffectiveness(events, [makeDecision()], [], [], []);
    assert.equal(r.decisionStability.reversed, 0);
  });
});

// ---------------------------------------------------------------------------
// 2. Escalation effectiveness
// ---------------------------------------------------------------------------

describe("escalation effectiveness", () => {
  it("escalate with proposal + resolved transition → resolutionRate = 1.0", () => {
    const d = makeDecision({ decisionId: "dec-escalate", signalId: "sig-escalate", decision: "escalate" });
    const p = makeProposal({ decisionId: "dec-escalate" });
    const t = makeTransition({ proposalId: "prop-test" });
    const r = computeEffectiveness([], [d], [], [p], [t]);
    assert.equal(r.escalationEffectiveness.escalationToActionRate, 1);
    assert.equal(r.escalationEffectiveness.resolutionRate, 1);
  });

  it("escalate with no proposal → escalationToActionRate = 0", () => {
    const d = makeDecision({ decisionId: "dec-escalate", decision: "escalate" });
    const r = computeEffectiveness([], [d], [], [], []);
    assert.equal(r.escalationEffectiveness.producedProposals, 0);
    assert.equal(r.escalationEffectiveness.escalationToActionRate, 0);
  });
});

// ---------------------------------------------------------------------------
// 3. Review completeness
// ---------------------------------------------------------------------------

describe("review completeness", () => {
  it("review with notes + classification → completenessRate = 1.0", () => {
    const rev = makeReview({ notes: "notes", classification: "valid" });
    const r = computeEffectiveness([], [], [rev], [], []);
    assert.equal(r.reviewCompleteness.completenessRate, 1);
  });

  it("review with null notes → completenessRate < 1.0", () => {
    const rev = makeReview({ notes: null, classification: "valid" });
    const r = computeEffectiveness([], [], [rev], [], []);
    assert.equal(r.reviewCompleteness.withNotes, 0);
    assert.equal(r.reviewCompleteness.completenessRate, 0);
  });

  it("multiple reviews count correctly", () => {
    const r1 = makeReview({ reviewId: "r1", notes: "a", classification: null });
    const r2 = makeReview({ reviewId: "r2", notes: "b", classification: "high" });
    const r3 = makeReview({ reviewId: "r3", notes: null, classification: "low" });
    const r = computeEffectiveness([], [], [r1, r2, r3], [], []);
    assert.equal(r.reviewCompleteness.totalReviews, 3);
    assert.equal(r.reviewCompleteness.withNotes, 2);
    assert.equal(r.reviewCompleteness.withClassification, 2);
    assert.equal(r.reviewCompleteness.withBoth, 1);
  });
});

// ---------------------------------------------------------------------------
// 4. Stale decisions
// ---------------------------------------------------------------------------

describe("stale decisions", () => {
  it("defer older than 7 days with no resolution → stale", () => {
    const d = makeDecision({ decisionId: "dec-stale", signalId: "sig-test", decision: "defer", createdAt: "2026-06-01T00:00:00.000Z" });
    const r = computeEffectiveness([], [d], [], [], [], { staleThresholdDays: 7, now: "2026-07-07T00:00:00.000Z" });
    assert.equal(r.staleDecisions.staleCount, 1);
    assert.ok(r.staleDecisions.averageStaleDays !== null);
  });

  it("defer with later terminal event → not stale", () => {
    const d = makeDecision({ decisionId: "dec-resolved", signalId: "sig-test", decision: "defer", createdAt: "2026-06-01T00:00:00.000Z" });
    const events = [makeEvent({ eventType: "action_allowed", timestamp: "2026-06-05T00:00:00.000Z" })];
    const r = computeEffectiveness(events, [d], [], [], [], { staleThresholdDays: 7, now: "2026-07-07T00:00:00.000Z" });
    assert.equal(r.staleDecisions.staleCount, 0);
  });
});

// ---------------------------------------------------------------------------
// 5. Throughput
// ---------------------------------------------------------------------------

describe("throughput", () => {
  it("groups decisions by decider, alphabetical", () => {
    const d1 = makeDecision({ decider: "bob" });
    const d2 = makeDecision({ decider: "alice" });
    const d3 = makeDecision({ decider: "alice" });
    const r = computeEffectiveness([], [d1, d2, d3], [], [], []);
    assert.equal(r.throughputContext.totalDecisions, 3);
    assert.equal(r.throughputContext.decisionsByOperator.length, 2);
    // alphabetical: alice before bob
    assert.equal(r.throughputContext.decisionsByOperator[0]!.operatorId, "alice");
    assert.equal(r.throughputContext.decisionsByOperator[0]!.count, 2);
    assert.equal(r.throughputContext.decisionsByOperator[1]!.operatorId, "bob");
    assert.equal(r.throughputContext.decisionsByOperator[1]!.count, 1);
  });

  it("groups reviews by reviewer", () => {
    const r1 = makeReview({ reviewer: "carol" });
    const r2 = makeReview({ reviewer: "alice" });
    const r = computeEffectiveness([], [], [r1, r2], [], []);
    assert.equal(r.throughputContext.totalReviews, 2);
    assert.equal(r.throughputContext.reviewsByOperator.length, 2);
  });
});

// ---------------------------------------------------------------------------
// 6. Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("empty input → all zero-valued", () => {
    const r = computeEffectiveness([], [], [], [], []);
    assert.equal(r.decisionStability.totalDecisions, 0);
    assert.equal(r.decisionStability.reversalRate, 0);
    assert.equal(r.escalationEffectiveness.totalEscalations, 0);
    assert.equal(r.reviewCompleteness.totalReviews, 0);
    assert.equal(r.staleDecisions.totalDeferred, 0);
    assert.equal(r.throughputContext.totalDecisions, 0);
  });

  it("correct decision kind counts", () => {
    const d1 = makeDecision({ decisionId: "d1", decision: "accept" });
    const d2 = makeDecision({ decisionId: "d2", decision: "dismiss" });
    const d3 = makeDecision({ decisionId: "d3", decision: "escalate" });
    const r = computeEffectiveness([], [d1, d2, d3], [], [], []);
    assert.equal(r.decisionStability.decisionCounts["accept"], 1);
    assert.equal(r.decisionStability.decisionCounts["dismiss"], 1);
    assert.equal(r.decisionStability.decisionCounts["escalate"], 1);
  });
});
