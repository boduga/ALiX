/**
 * Tests for P14.6c — CLI Migration to Store-Level Audit Decorators.
 *
 * Proves each governance CLI mutation emits exactly one audit event through
 * store-level decorators, with no duplicate or missing emissions.
 *
 * Sentinel tests (9-10) scan governance.ts as text to verify:
 * - No direct P14.6a emitter calls remain
 * - Audited decorator factories are wired in
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import {
  auditSignalStore,
  auditDecisionStore,
  auditActionQueueStore,
  auditReviewStore,
} from "../../src/governance/audit-decorators.js";

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

function mockMeta(fn: (...args: any[]) => unknown) {
  return fn as unknown as {
    mock: {
      callCount: () => number;
      calls: Array<{ arguments: unknown[] }>;
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
// auditSignalStore — single emission on write, zero on read, failure invariants
// ---------------------------------------------------------------------------

describe("auditSignalStore migration invariant", () => {
  it("emits exactly one audit event per successful append", async () => {
    const inner = createMockSignalStore();
    const audit = createMockAuditStore();
    const store = auditSignalStore(inner, audit);

    await store.append(makeSignal());

    assert.equal(mockMeta(audit.append).mock.callCount(), 1);
  });

  it("emits zero audit events on list", async () => {
    const inner = createMockSignalStore();
    const audit = createMockAuditStore();
    const store = auditSignalStore(inner, audit);

    await store.list();
    assert.equal(mockMeta(audit.append).mock.callCount(), 0);
  });

  it("emits zero audit events on getById", async () => {
    const inner = createMockSignalStore();
    const audit = createMockAuditStore();
    const store = auditSignalStore(inner, audit);

    await store.getById("sig-001");
    assert.equal(mockMeta(audit.append).mock.callCount(), 0);
  });

  it("emits zero audit events when inner append fails", async () => {
    const inner = createMockSignalStore();
    mockMeta(inner.append).mock.mockImplementation(async () => {
      throw new Error("Store failure");
    });
    const audit = createMockAuditStore();
    const store = auditSignalStore(inner, audit);

    await assert.rejects(() => store.append(makeSignal()));
    assert.equal(mockMeta(audit.append).mock.callCount(), 0);
  });

  it("does not block governance when audit append fails", async () => {
    const inner = createMockSignalStore();
    const audit = createMockAuditStore();
    mockMeta(audit.append).mock.mockImplementation(async () => {
      throw new Error("Audit failure");
    });
    const store = auditSignalStore(inner, audit);

    await store.append(makeSignal());
    assert.equal(mockMeta(inner.append).mock.callCount(), 1);
  });
});

// ---------------------------------------------------------------------------
// auditDecisionStore — same invariants
// ---------------------------------------------------------------------------

describe("auditDecisionStore migration invariant", () => {
  it("emits exactly one audit event per successful append", async () => {
    const inner = createMockDecisionStore();
    const audit = createMockAuditStore();
    const store = auditDecisionStore(inner, audit);

    await store.append(makeDecision());

    assert.equal(mockMeta(audit.append).mock.callCount(), 1);
  });

  it("emits zero audit events on read methods", async () => {
    const inner = createMockDecisionStore();
    const audit = createMockAuditStore();
    const store = auditDecisionStore(inner, audit);

    await store.list();
    await store.getById("dec-1");
    await store.getBySignalId("sig-1");
    await store.getByKind("accept");

    assert.equal(mockMeta(audit.append).mock.callCount(), 0);
  });

  it("emits zero audit events when inner append fails", async () => {
    const inner = createMockDecisionStore();
    mockMeta(inner.append).mock.mockImplementation(async () => {
      throw new Error("Store failure");
    });
    const audit = createMockAuditStore();
    const store = auditDecisionStore(inner, audit);

    await assert.rejects(() => store.append(makeDecision()));
    assert.equal(mockMeta(audit.append).mock.callCount(), 0);
  });

  it("does not block governance when audit append fails", async () => {
    const inner = createMockDecisionStore();
    const audit = createMockAuditStore();
    mockMeta(audit.append).mock.mockImplementation(async () => {
      throw new Error("Audit failure");
    });
    const store = auditDecisionStore(inner, audit);

    await store.append(makeDecision());
    assert.equal(mockMeta(inner.append).mock.callCount(), 1);
  });
});

// ---------------------------------------------------------------------------
// auditActionQueueStore — single emission on append + appendStatusTransition
// ---------------------------------------------------------------------------

describe("auditActionQueueStore migration invariant", () => {
  it("emits exactly one audit event per successful append", async () => {
    const inner = createMockActionQueueStore();
    const audit = createMockAuditStore();
    const store = auditActionQueueStore(inner, audit);

    await store.append(makeProposal());

    assert.equal(mockMeta(audit.append).mock.callCount(), 1);
  });

  it("emits exactly one audit event per successful appendStatusTransition", async () => {
    const inner = createMockActionQueueStore();
    const audit = createMockAuditStore();
    const store = auditActionQueueStore(inner, audit);

    await store.appendStatusTransition(makeTransition());

    assert.equal(mockMeta(audit.append).mock.callCount(), 1);
  });

  it("emits zero audit events on read methods", async () => {
    const inner = createMockActionQueueStore();
    const audit = createMockAuditStore();
    const store = auditActionQueueStore(inner, audit);

    await store.list();
    await store.getById("prop-1");
    await store.getByDecisionId("dec-1");
    await store.getTransitions("prop-1");

    assert.equal(mockMeta(audit.append).mock.callCount(), 0);
  });

  it("emits zero audit events when inner append fails", async () => {
    const inner = createMockActionQueueStore();
    mockMeta(inner.append).mock.mockImplementation(async () => {
      throw new Error("Store failure");
    });
    const audit = createMockAuditStore();
    const store = auditActionQueueStore(inner, audit);

    await assert.rejects(() => store.append(makeProposal()));
    assert.equal(mockMeta(audit.append).mock.callCount(), 0);
  });

  it("does not block governance when audit append fails", async () => {
    const inner = createMockActionQueueStore();
    const audit = createMockAuditStore();
    mockMeta(audit.append).mock.mockImplementation(async () => {
      throw new Error("Audit failure");
    });
    const store = auditActionQueueStore(inner, audit);

    await store.append(makeProposal());
    assert.equal(mockMeta(inner.append).mock.callCount(), 1);
  });
});

// ---------------------------------------------------------------------------
// auditReviewStore — same invariants
// ---------------------------------------------------------------------------

describe("auditReviewStore migration invariant", () => {
  it("emits exactly one audit event per successful append", async () => {
    const inner = createMockReviewStore();
    const audit = createMockAuditStore();
    const store = auditReviewStore(inner, audit);

    await store.append(makeReview());

    assert.equal(mockMeta(audit.append).mock.callCount(), 1);
  });

  it("emits zero audit events on read methods", async () => {
    const inner = createMockReviewStore();
    const audit = createMockAuditStore();
    const store = auditReviewStore(inner, audit);

    await store.list();
    await store.getById("rev-1");
    await store.getBySignalId("sig-1");

    assert.equal(mockMeta(audit.append).mock.callCount(), 0);
  });

  it("emits zero audit events when inner append fails", async () => {
    const inner = createMockReviewStore();
    mockMeta(inner.append).mock.mockImplementation(async () => {
      throw new Error("Store failure");
    });
    const audit = createMockAuditStore();
    const store = auditReviewStore(inner, audit);

    await assert.rejects(() => store.append(makeReview()));
    assert.equal(mockMeta(audit.append).mock.callCount(), 0);
  });

  it("does not block governance when audit append fails", async () => {
    const inner = createMockReviewStore();
    const audit = createMockAuditStore();
    mockMeta(audit.append).mock.mockImplementation(async () => {
      throw new Error("Audit failure");
    });
    const store = auditReviewStore(inner, audit);

    await store.append(makeReview());
    assert.equal(mockMeta(inner.append).mock.callCount(), 1);
  });
});

// ---------------------------------------------------------------------------
// Sentinel: governance.ts contains NO direct P14.6a emitter calls
// ---------------------------------------------------------------------------

describe("governance.ts migration sentinel", () => {
  const CLI_PATH = resolve(__dirname, "../../src/cli/commands/governance.ts");
  const source: string = readFileSync(CLI_PATH, "utf8");

  it("contains no direct signalEvaluatedEvent import", () => {
    // The string should only appear inside audit-decorators.ts imports, not direct emitter imports
    const emitterLines = source
      .split("\n")
      .filter((l) => l.includes("signalEvaluatedEvent"));
    // Allow only if it appears as part of audit-decorators import (not direct audit-emitters import)
    const directImports = emitterLines.filter((l) => l.includes("audit-emitters"));
    assert.equal(directImports.length, 0, `Found direct signalEvaluatedEvent import: ${directImports.join(", ")}`);
  });

  it("contains no direct decisionRecordedEvent import or call", () => {
    const lines = source
      .split("\n")
      .filter((l) => l.includes("decisionRecordedEvent") && !l.includes("audit-decorators"));
    assert.equal(lines.length, 0, `Found direct decisionRecordedEvent usage: ${lines.join(", ")}`);
  });

  it("contains no direct actionOverriddenEvent import or call", () => {
    const lines = source
      .split("\n")
      .filter((l) => l.includes("actionOverriddenEvent") && !l.includes("audit-decorators"));
    assert.equal(lines.length, 0, `Found direct actionOverriddenEvent usage: ${lines.join(", ")}`);
  });

  it("contains no inline auditStore.append(...) pattern", () => {
    // This catches any remaining 'new FileAuditStore(cwd).append(' pattern
    const lines = source
      .split("\n")
      .filter((l) => l.includes(".append(") && (l.includes("FileAuditStore") || l.includes("auditStore")));
    // Allow decorator import lines that mention audit-decorators
    const inlineAppends = lines.filter((l) => !l.includes("audit-decorators"));
    assert.equal(inlineAppends.length, 0, `Found inline audit append: ${inlineAppends.join(", ")}`);
  });
});

// ---------------------------------------------------------------------------
// Sentinel: governance.ts contains audited store factory usage
// ---------------------------------------------------------------------------

describe("governance.ts migration sentinel — audited wrappers present", () => {
  const CLI_PATH = resolve(__dirname, "../../src/cli/commands/governance.ts");
  const source: string = readFileSync(CLI_PATH, "utf8");

  it("contains auditSignalStore", () => {
    assert.ok(source.includes("auditSignalStore"), "auditSignalStore not found in governance.ts");
  });

  it("contains auditReviewStore", () => {
    assert.ok(source.includes("auditReviewStore"), "auditReviewStore not found in governance.ts");
  });

  it("contains auditDecisionStore", () => {
    assert.ok(source.includes("auditDecisionStore"), "auditDecisionStore not found in governance.ts");
  });

  it("contains auditActionQueueStore", () => {
    assert.ok(source.includes("auditActionQueueStore"), "auditActionQueueStore not found in governance.ts");
  });
});
