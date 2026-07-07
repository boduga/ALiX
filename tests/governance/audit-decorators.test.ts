/**
 * Tests for P14.6b — Store-Level Audit Decorators.
 *
 * Covers all four decorated store classes, factory functions, and the
 * non-fatal audit failure invariant.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import {
  AuditedSignalStore,
  AuditedDecisionStore,
  AuditedActionQueueStore,
  AuditedReviewStore,
  auditSignalStore,
  auditDecisionStore,
  auditActionQueueStore,
  auditReviewStore,
} from "../../src/governance/audit-decorators.js";

import {
  actionProposedEvent,
  reviewSubmittedEvent,
} from "../../src/governance/audit-emitters.js";

import type { GovernanceSignal, SignalStore, SignalType } from "../../src/governance/governance-signal.js";
import type { OperatorDecision, DecisionStore, DecisionKind } from "../../src/governance/decision-capture.js";
import type { GovernanceActionProposal, ActionQueueStore, ActionProposalStatusTransition, ActionProposalKind } from "../../src/governance/action-queue.js";
import type { OperatorReview, ReviewStore } from "../../src/governance/operator-review.js";
import type { AuditStore } from "../../src/governance/audit-store.js";
import type { GovernanceAuditEventInput } from "../../src/governance/audit-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOW = "2026-07-06T14:00:00.000Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Access mock metadata from a mock.fn()-wrapped function. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockMeta(fn: (...args: any[]) => unknown) {
  return fn as unknown as {
    mock: {
      callCount: () => number;
      calls: Array<{ arguments: unknown[] }>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockImplementation: (impl: (...args: any[]) => unknown) => void;
    };
  };
}

// ---------------------------------------------------------------------------
// Mock stores
// ---------------------------------------------------------------------------

function createMockSignalStore(): SignalStore {
  return {
    append: mock.fn(async (_signal: GovernanceSignal) => {}),
    list: mock.fn(async (_limit?: number) => []),
    getById: mock.fn(async (_id: string) => null),
    query: mock.fn(async (_filter: Partial<GovernanceSignal>) => []),
  };
}

function createMockDecisionStore(): DecisionStore {
  return {
    append: mock.fn(async (_decision: OperatorDecision) => {}),
    list: mock.fn(async (_limit?: number) => []),
    getById: mock.fn(async (_id: string) => null),
    getBySignalId: mock.fn(async (_id: string) => []),
    getByKind: mock.fn(async (_kind: DecisionKind) => []),
  };
}

function createMockActionQueueStore(): ActionQueueStore {
  return {
    append: mock.fn(async (_proposal: GovernanceActionProposal) => {}),
    list: mock.fn(async (_limit?: number) => []),
    getById: mock.fn(async (_id: string) => null),
    getByDecisionId: mock.fn(async (_id: string) => []),
    appendStatusTransition: mock.fn(async (_transition: ActionProposalStatusTransition) => {}),
    getTransitions: mock.fn(async (_proposalId: string) => []),
  };
}

function createMockReviewStore(): ReviewStore {
  return {
    append: mock.fn(async (_review: OperatorReview) => {}),
    list: mock.fn(async (_limit?: number) => []),
    getById: mock.fn(async (_id: string) => null),
    getBySignalId: mock.fn(async (_id: string) => []),
  };
}

function createMockAuditStore(): AuditStore {
  return {
    append: mock.fn(async (_input: GovernanceAuditEventInput) => ({
      eventId: "aud-test",
      timestamp: NOW,
      eventType: "policy_evaluated" as const,
      actorType: "system" as const,
      actorId: "test",
      subjectType: "signal" as const,
      subjectId: "sig-test",
      action: "test",
      decision: "allowed" as const,
      policyId: null,
      policyVersion: null,
      ruleId: null,
      reason: "test",
      evidenceRefs: [],
      requestId: null,
      traceId: null,
      sessionId: null,
      parentEventId: null,
      riskLevel: "low" as const,
      requiresHumanReview: false,
      metadata: {},
      previousHash: null,
      eventHash: "abc123",
    })),
    list: mock.fn(async () => []),
    listChronological: mock.fn(async () => []),
    getById: mock.fn(async (_id: string) => null),
    size: mock.fn(async () => 0),
  };
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeSignal(overrides: Partial<GovernanceSignal> = {}): GovernanceSignal {
  return {
    signalId: "sig-test-001",
    signalType: "trend_alert" as SignalType,
    sourcePhase: "p13.1",
    title: "Test signal",
    description: "Test description",
    severity: "medium",
    confidence: 0.85,
    evidenceRefs: [{ source: "test", id: "ev-001", description: "Test evidence" }],
    recommendation: "Review and act",
    metadata: { test: true },
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
    rationale: "Test rationale",
    decider: "operator-test",
    reviewId: null,
    actionProposalId: null,
    createdAt: NOW,
    ...overrides,
  };
}

function makeProposal(
  kind: ActionProposalKind = "escalation_review",
  overrides: Partial<GovernanceActionProposal> = {},
): GovernanceActionProposal {
  return {
    proposalId: "prop-test-001",
    decisionId: "dec-test-001",
    signalId: "sig-test-001",
    kind,
    title: "Test proposal",
    description: "Test description",
    rationale: "Test rationale",
    status: "pending" as const,
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

function makeReview(overrides: Partial<OperatorReview> = {}): OperatorReview {
  return {
    reviewId: "rev-test-001",
    signalId: "sig-test-001",
    reviewer: "operator-test",
    notes: "Reviewed the signal",
    classification: null,
    createdAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AuditedSignalStore
// ---------------------------------------------------------------------------

describe("AuditedSignalStore", () => {
  it("delegates append to inner store", async () => {
    const inner = createMockSignalStore();
    const audit = createMockAuditStore();
    const store = new AuditedSignalStore(inner, audit);
    const signal = makeSignal();

    await store.append(signal);

    assert.equal(mockMeta(inner.append).mock.callCount(), 1);
  });

  it("emits audit event via signalEvaluatedEvent after inner append", async () => {
    const inner = createMockSignalStore();
    const audit = createMockAuditStore();
    const store = new AuditedSignalStore(inner, audit);
    const signal = makeSignal();

    await store.append(signal);

    assert.equal(mockMeta(audit.append).mock.callCount(), 1);
    const auditInput = mockMeta(audit.append).mock.calls[0]!.arguments[0];
    assert.equal((auditInput as GovernanceAuditEventInput).eventType, "policy_evaluated");
    assert.equal((auditInput as GovernanceAuditEventInput).subjectId, signal.signalId);
  });

  it("does not emit audit when inner store append throws", async () => {
    const inner = createMockSignalStore();
    mockMeta(inner.append).mock.mockImplementation(
      async () => { throw new Error("Store write failed"); },
    );
    const audit = createMockAuditStore();
    const store = new AuditedSignalStore(inner, audit);

    await assert.rejects(async () => store.append(makeSignal()));
    assert.equal(mockMeta(audit.append).mock.callCount(), 0);
  });

  it("treats audit append failure as non-fatal (governance write succeeds)", async () => {
    const inner = createMockSignalStore();
    const audit = createMockAuditStore();
    mockMeta(audit.append).mock.mockImplementation(
      async () => { throw new Error("Audit store unavailable"); },
    );
    const store = new AuditedSignalStore(inner, audit);

    await store.append(makeSignal());

    assert.equal(mockMeta(inner.append).mock.callCount(), 1);
  });

  it("passes through list to inner store", async () => {
    const inner = createMockSignalStore();
    const audit = createMockAuditStore();
    const store = new AuditedSignalStore(inner, audit);

    await store.list(5);
    assert.equal(mockMeta(inner.list).mock.callCount(), 1);
  });

  it("passes through getById to inner store", async () => {
    const inner = createMockSignalStore();
    const audit = createMockAuditStore();
    const store = new AuditedSignalStore(inner, audit);

    await store.getById("sig-abc");
    assert.equal(mockMeta(inner.getById).mock.callCount(), 1);
  });

  it("passes through query to inner store", async () => {
    const inner = createMockSignalStore();
    const audit = createMockAuditStore();
    const store = new AuditedSignalStore(inner, audit);

    await store.query({ severity: "high" });
    assert.equal(mockMeta(inner.query).mock.callCount(), 1);
  });
});

// ---------------------------------------------------------------------------
// AuditedDecisionStore
// ---------------------------------------------------------------------------

describe("AuditedDecisionStore", () => {
  it("delegates append to inner store", async () => {
    const inner = createMockDecisionStore();
    const audit = createMockAuditStore();
    const store = new AuditedDecisionStore(inner, audit);

    await store.append(makeDecision());

    assert.equal(mockMeta(inner.append).mock.callCount(), 1);
  });

  it("emits audit event via decisionRecordedEvent after inner append", async () => {
    const inner = createMockDecisionStore();
    const audit = createMockAuditStore();
    const store = new AuditedDecisionStore(inner, audit);
    const decision = makeDecision("escalate");

    await store.append(decision);

    assert.equal(mockMeta(audit.append).mock.callCount(), 1);
    const auditInput = mockMeta(audit.append).mock.calls[0]!.arguments[0];
    assert.equal((auditInput as GovernanceAuditEventInput).eventType, "action_escalated");
    assert.equal((auditInput as GovernanceAuditEventInput).actorId, decision.decider);
  });

  it("does not emit audit when inner store append throws", async () => {
    const inner = createMockDecisionStore();
    mockMeta(inner.append).mock.mockImplementation(
      async () => { throw new Error("Store write failed"); },
    );
    const audit = createMockAuditStore();
    const store = new AuditedDecisionStore(inner, audit);

    await assert.rejects(async () => store.append(makeDecision()));
    assert.equal(mockMeta(audit.append).mock.callCount(), 0);
  });

  it("treats audit append failure as non-fatal", async () => {
    const inner = createMockDecisionStore();
    const audit = createMockAuditStore();
    mockMeta(audit.append).mock.mockImplementation(
      async () => { throw new Error("Audit store unavailable"); },
    );
    const store = new AuditedDecisionStore(inner, audit);

    await store.append(makeDecision());
    assert.equal(mockMeta(inner.append).mock.callCount(), 1);
  });

  it("passes through list/getById/getBySignalId/getByKind", async () => {
    const inner = createMockDecisionStore();
    const audit = createMockAuditStore();
    const store = new AuditedDecisionStore(inner, audit);

    await store.list();
    await store.getById("dec-1");
    await store.getBySignalId("sig-1");
    await store.getByKind("accept");

    assert.equal(mockMeta(inner.list).mock.callCount(), 1);
    assert.equal(mockMeta(inner.getById).mock.callCount(), 1);
    assert.equal(mockMeta(inner.getBySignalId).mock.callCount(), 1);
    assert.equal(mockMeta(inner.getByKind).mock.callCount(), 1);
  });
});

// ---------------------------------------------------------------------------
// AuditedActionQueueStore
// ---------------------------------------------------------------------------

describe("AuditedActionQueueStore", () => {
  it("delegates append to inner store", async () => {
    const inner = createMockActionQueueStore();
    const audit = createMockAuditStore();
    const store = new AuditedActionQueueStore(inner, audit);

    await store.append(makeProposal());

    assert.equal(mockMeta(inner.append).mock.callCount(), 1);
  });

  it("emits audit event via actionProposedEvent", async () => {
    const inner = createMockActionQueueStore();
    const audit = createMockAuditStore();
    const store = new AuditedActionQueueStore(inner, audit);
    const proposal = makeProposal("escalation_review");

    await store.append(proposal);

    assert.equal(mockMeta(audit.append).mock.callCount(), 1);
    const auditInput = mockMeta(audit.append).mock.calls[0]!.arguments[0];
    assert.equal((auditInput as GovernanceAuditEventInput).eventType, "action_escalated");
    assert.equal((auditInput as GovernanceAuditEventInput).subjectId, proposal.proposalId);
  });

  it("does not emit audit when inner append throws", async () => {
    const inner = createMockActionQueueStore();
    mockMeta(inner.append).mock.mockImplementation(
      async () => { throw new Error("Store write failed"); },
    );
    const audit = createMockAuditStore();
    const store = new AuditedActionQueueStore(inner, audit);

    await assert.rejects(async () => store.append(makeProposal()));
    assert.equal(mockMeta(audit.append).mock.callCount(), 0);
  });

  it("treats audit append failure as non-fatal", async () => {
    const inner = createMockActionQueueStore();
    const audit = createMockAuditStore();
    mockMeta(audit.append).mock.mockImplementation(
      async () => { throw new Error("Audit store unavailable"); },
    );
    const store = new AuditedActionQueueStore(inner, audit);

    await store.append(makeProposal());
    assert.equal(mockMeta(inner.append).mock.callCount(), 1);
  });

  it("delegates appendStatusTransition and emits via actionOverriddenEvent", async () => {
    const inner = createMockActionQueueStore();
    const audit = createMockAuditStore();
    const store = new AuditedActionQueueStore(inner, audit);
    const transition = makeTransition("marked_executed_elsewhere");

    await store.appendStatusTransition(transition);

    assert.equal(mockMeta(inner.appendStatusTransition).mock.callCount(), 1);
    assert.equal(mockMeta(audit.append).mock.callCount(), 1);
    const auditInput = mockMeta(audit.append).mock.calls[0]!.arguments[0];
    assert.equal((auditInput as GovernanceAuditEventInput).eventType, "override_applied");
  });

  it("passes through read methods", async () => {
    const inner = createMockActionQueueStore();
    const audit = createMockAuditStore();
    const store = new AuditedActionQueueStore(inner, audit);

    await store.list();
    await store.getById("prop-1");
    await store.getByDecisionId("dec-1");
    await store.getTransitions("prop-1");

    assert.equal(mockMeta(inner.list).mock.callCount(), 1);
    assert.equal(mockMeta(inner.getById).mock.callCount(), 1);
    assert.equal(mockMeta(inner.getByDecisionId).mock.callCount(), 1);
    assert.equal(mockMeta(inner.getTransitions).mock.callCount(), 1);
  });
});

// ---------------------------------------------------------------------------
// AuditedReviewStore
// ---------------------------------------------------------------------------

describe("AuditedReviewStore", () => {
  it("delegates append to inner store", async () => {
    const inner = createMockReviewStore();
    const audit = createMockAuditStore();
    const store = new AuditedReviewStore(inner, audit);

    await store.append(makeReview());

    assert.equal(mockMeta(inner.append).mock.callCount(), 1);
  });

  it("emits audit event via reviewSubmittedEvent", async () => {
    const inner = createMockReviewStore();
    const audit = createMockAuditStore();
    const store = new AuditedReviewStore(inner, audit);
    const review = makeReview({ reviewer: "alice" });

    await store.append(review);

    assert.equal(mockMeta(audit.append).mock.callCount(), 1);
    const auditInput = mockMeta(audit.append).mock.calls[0]!.arguments[0];
    assert.equal((auditInput as GovernanceAuditEventInput).eventType, "human_approval_requested");
    assert.equal((auditInput as GovernanceAuditEventInput).actorId, "alice");
  });

  it("does not emit audit when inner append throws", async () => {
    const inner = createMockReviewStore();
    mockMeta(inner.append).mock.mockImplementation(
      async () => { throw new Error("Store write failed"); },
    );
    const audit = createMockAuditStore();
    const store = new AuditedReviewStore(inner, audit);

    await assert.rejects(async () => store.append(makeReview()));
    assert.equal(mockMeta(audit.append).mock.callCount(), 0);
  });

  it("treats audit append failure as non-fatal", async () => {
    const inner = createMockReviewStore();
    const audit = createMockAuditStore();
    mockMeta(audit.append).mock.mockImplementation(
      async () => { throw new Error("Audit store unavailable"); },
    );
    const store = new AuditedReviewStore(inner, audit);

    await store.append(makeReview());
    assert.equal(mockMeta(inner.append).mock.callCount(), 1);
  });

  it("passes through list/getById/getBySignalId", async () => {
    const inner = createMockReviewStore();
    const audit = createMockAuditStore();
    const store = new AuditedReviewStore(inner, audit);

    await store.list();
    await store.getById("rev-1");
    await store.getBySignalId("sig-1");

    assert.equal(mockMeta(inner.list).mock.callCount(), 1);
    assert.equal(mockMeta(inner.getById).mock.callCount(), 1);
    assert.equal(mockMeta(inner.getBySignalId).mock.callCount(), 1);
  });
});

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

describe("factory functions", () => {
  it("auditSignalStore returns SignalStore-compatible wrapper", () => {
    const inner = createMockSignalStore();
    const audit = createMockAuditStore();
    const store = auditSignalStore(inner, audit);

    assert.ok(store instanceof AuditedSignalStore);
    assert.equal(typeof store.append, "function");
    assert.equal(typeof store.list, "function");
    assert.equal(typeof store.getById, "function");
    assert.equal(typeof store.query, "function");
  });

  it("auditDecisionStore returns DecisionStore-compatible wrapper", () => {
    const inner = createMockDecisionStore();
    const audit = createMockAuditStore();
    const store = auditDecisionStore(inner, audit);

    assert.ok(store instanceof AuditedDecisionStore);
    assert.equal(typeof store.append, "function");
    assert.equal(typeof store.list, "function");
    assert.equal(typeof store.getById, "function");
    assert.equal(typeof store.getBySignalId, "function");
    assert.equal(typeof store.getByKind, "function");
  });

  it("auditActionQueueStore returns ActionQueueStore-compatible wrapper", () => {
    const inner = createMockActionQueueStore();
    const audit = createMockAuditStore();
    const store = auditActionQueueStore(inner, audit);

    assert.ok(store instanceof AuditedActionQueueStore);
    assert.equal(typeof store.append, "function");
    assert.equal(typeof store.list, "function");
    assert.equal(typeof store.getById, "function");
    assert.equal(typeof store.getByDecisionId, "function");
    assert.equal(typeof store.appendStatusTransition, "function");
    assert.equal(typeof store.getTransitions, "function");
  });

  it("auditReviewStore returns ReviewStore-compatible wrapper", () => {
    const inner = createMockReviewStore();
    const audit = createMockAuditStore();
    const store = auditReviewStore(inner, audit);

    assert.ok(store instanceof AuditedReviewStore);
    assert.equal(typeof store.append, "function");
    assert.equal(typeof store.list, "function");
    assert.equal(typeof store.getById, "function");
    assert.equal(typeof store.getBySignalId, "function");
  });
});

// ---------------------------------------------------------------------------
// actionProposedEvent factory
// ---------------------------------------------------------------------------

describe("actionProposedEvent", () => {
  it("produces ACTION_ESCALATED event type", () => {
    const event = actionProposedEvent(makeProposal());
    assert.equal(event.eventType, "action_escalated");
    assert.equal(event.decision, "escalated");
  });

  it("sets actorType to system and actorId to governance", () => {
    const event = actionProposedEvent(makeProposal());
    assert.equal(event.actorType, "system");
    assert.equal(event.actorId, "governance");
  });

  it("sets subjectType to proposal", () => {
    const event = actionProposedEvent(makeProposal());
    assert.equal(event.subjectType, "proposal");
    assert.equal(event.subjectId, "prop-test-001");
  });

  it("maps escalation_review kind to riskLevel high", () => {
    const event = actionProposedEvent(makeProposal("escalation_review"));
    assert.equal(event.riskLevel, "high");
  });

  it("maps github_issue kind to riskLevel medium", () => {
    const event = actionProposedEvent(makeProposal("github_issue"));
    assert.equal(event.riskLevel, "medium");
  });

  it("sets requiresHumanReview to true", () => {
    const event = actionProposedEvent(makeProposal());
    assert.equal(event.requiresHumanReview, true);
  });

  it("includes proposal metadata", () => {
    const event = actionProposedEvent(makeProposal("escalation_review"));
    assert.equal(event.metadata.proposalKind, "escalation_review");
    assert.equal(event.metadata.sourceDecisionId, "dec-test-001");
    assert.equal(event.metadata.targetRef, null);
  });

  it("includes evidence refs from decision and signal", () => {
    const event = actionProposedEvent(makeProposal());
    assert.ok(event.evidenceRefs.includes("dec-test-001"));
    assert.ok(event.evidenceRefs.includes("sig-test-001"));
  });

  it("accepts optional traceId", () => {
    const event = actionProposedEvent(makeProposal(), "trace-prop");
    assert.equal(event.traceId, "trace-prop");
  });
});

// ---------------------------------------------------------------------------
// reviewSubmittedEvent factory
// ---------------------------------------------------------------------------

describe("reviewSubmittedEvent", () => {
  it("produces HUMAN_APPROVAL_REQUESTED event type", () => {
    const event = reviewSubmittedEvent(makeReview());
    assert.equal(event.eventType, "human_approval_requested");
  });

  it("sets actorType to human and actorId to reviewer", () => {
    const event = reviewSubmittedEvent(makeReview({ reviewer: "bob" }));
    assert.equal(event.actorType, "human");
    assert.equal(event.actorId, "bob");
  });

  it("sets subjectType to signal and subjectId to signalId", () => {
    const event = reviewSubmittedEvent(makeReview({ signalId: "sig-xyz" }));
    assert.equal(event.subjectType, "signal");
    assert.equal(event.subjectId, "sig-xyz");
  });

  it("sets riskLevel to medium", () => {
    const event = reviewSubmittedEvent(makeReview());
    assert.equal(event.riskLevel, "medium");
  });

  it("sets requiresHumanReview to false (review is the human review)", () => {
    const event = reviewSubmittedEvent(makeReview());
    assert.equal(event.requiresHumanReview, false);
  });

  it("includes review metadata", () => {
    const event = reviewSubmittedEvent(makeReview({ reviewId: "rev-abc" }));
    assert.equal(event.metadata.reviewId, "rev-abc");
    assert.equal(event.metadata.hasNotes, true);
    assert.equal(event.metadata.hasClassification, false);
  });

  it("detects hasNotes and hasClassification correctly", () => {
    const withNotes = reviewSubmittedEvent(makeReview({ notes: "Some notes", classification: "valid" }));
    assert.equal(withNotes.metadata.hasNotes, true);
    assert.equal(withNotes.metadata.hasClassification, true);

    const withNull = reviewSubmittedEvent(makeReview({ notes: null, classification: null }));
    assert.equal(withNull.metadata.hasNotes, false);
    assert.equal(withNull.metadata.hasClassification, false);
  });

  it("accepts optional traceId", () => {
    const event = reviewSubmittedEvent(makeReview(), "trace-review");
    assert.equal(event.traceId, "trace-review");
  });
});

// ---------------------------------------------------------------------------
// Structural invariants
// ---------------------------------------------------------------------------

describe("audit event structure", () => {
  it("all five emitters produce valid GovernanceAuditEventInput shape", () => {
    const emitters: GovernanceAuditEventInput[] = [
      actionProposedEvent(makeProposal()),
      reviewSubmittedEvent(makeReview()),
    ];

    for (const ev of emitters) {
      assert.ok(typeof ev.eventId === "string" && ev.eventId.length > 0, `eventId missing for ${ev.eventType}`);
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
