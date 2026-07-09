/**
 * Tests for P14.6c — CLI Migration to Store-Level Audit Decorators.
 * Extended by P14.7 — Governance Audit Hardening / Coverage Closure.
 *
 * Proves each governance CLI mutation emits exactly one audit event through
 * store-level decorators, with no duplicate or missing emissions.
 *
 * Coverage blocks:
 *  - Per-store migration invariants (P14.6c): single emission, read silence,
 *    failure propagation, non-fatal audit.
 *  - refreshProposals integration (P14.7 / Issue #241): the indirect write path.
 *  - Full-matrix single emission (P14.7): correct eventType per mutation.
 *  - Read-only silence matrix (P14.7): every read method audit-silent.
 *  - Sentinel tests scan governance.ts as text to verify:
 *      * No direct P14.6a emitter calls remain
 *      * No audit-emitters import at all
 *      * Audited decorator factories are wired into mutation paths
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const GOVERNANCE_CLI_PATH = resolve(
  process.cwd(),
  "src/cli/commands/governance.ts",
);

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import {
  auditSignalStore,
  auditDecisionStore,
  auditActionQueueStore,
  auditReviewStore,
} from "../../src/governance/audit-decorators.js";

import { FileSignalStore } from "../../src/governance/governance-signal.js";
import { FileDecisionStore } from "../../src/governance/decision-capture.js";
import { FileActionQueueStore, refreshProposals } from "../../src/governance/action-queue.js";

import type { GovernanceSignal, SignalStore, SignalType } from "../../src/governance/governance-signal.js";
import type { OperatorDecision, DecisionStore, DecisionKind } from "../../src/governance/decision-capture.js";
import type { GovernanceActionProposal, ActionQueueStore, ActionProposalStatusTransition, ActionProposalKind } from "../../src/governance/action-queue.js";
import type { OperatorReview, ReviewStore } from "../../src/governance/operator-review.js";
import type { AuditStore } from "../../src/governance/audit-store.js";
import type { GovernanceAuditEvent, GovernanceAuditEventInput } from "../../src/governance/audit-types.js";

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

/**
 * In-memory spy audit store — captures every GovernanceAuditEventInput so
 * tests can assert on count AND event type (not just call count).
 */
function createSpyAuditStore(): { store: AuditStore; events: GovernanceAuditEventInput[] } {
  const events: GovernanceAuditEventInput[] = [];
  const store: AuditStore = {
    append: async (input: GovernanceAuditEventInput): Promise<GovernanceAuditEvent> => {
      events.push(input);
      return { ...input, previousHash: null, eventHash: "spy-hash" } as GovernanceAuditEvent;
    },
    list: async () => [],
    listChronological: async () => [],
    getById: async (_id: string) => null,
    size: async () => events.length,
  };
  return { store, events };
}

// ---------------------------------------------------------------------------
// Temp dir helpers (for end-to-end File-store seeding)
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
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
  const source: string = readFileSync(GOVERNANCE_CLI_PATH, "utf8");

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
// P14.7 — Strengthened regression sentinels
// ---------------------------------------------------------------------------

describe("governance.ts strengthened sentinels (P14.7)", () => {
  const source: string = readFileSync(GOVERNANCE_CLI_PATH, "utf8");

  it("does not import the audit-emitters module at all", () => {
    // The CLI must never touch emitters directly — only via decorators.
    // Stronger than per-symbol checks: bans the whole module.
    assert.ok(
      !source.includes("audit-emitters"),
      "governance.ts must not import audit-emitters; audit emission must flow through audited store decorators",
    );
  });

  it("contains no inline new FileAuditStore(...).append(...) construction", () => {
    // Catches a re-introduced P14.6a pattern anywhere in the file, regardless
    // of how the variable is named or whether the constructor arg contains
    // nested parens (e.g. process.cwd() or join(cwd, "x")). Requires the ctor's
    // closing paren to immediately precede .append( so it does not match the
    // valid `auditXStore(new FileXStore(cwd), new FileAuditStore(cwd))` form.
    const inlinePattern = /new\s+FileAuditStore\s*\([\s\S]*?\)\s*\.append\s*\(/;
    assert.ok(
      !inlinePattern.test(source),
      "governance.ts must not construct FileAuditStore and append inline; use an audited store decorator",
    );
  });
});

// ---------------------------------------------------------------------------
// Sentinel: governance.ts contains audited store factory usage
// ---------------------------------------------------------------------------

describe("governance.ts migration sentinel — audited wrappers present", () => {
  const source: string = readFileSync(GOVERNANCE_CLI_PATH, "utf8");

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

// ---------------------------------------------------------------------------
// P14.7 / Issue #241 — refreshProposals integration (indirect write path)
// ---------------------------------------------------------------------------

describe("refreshProposals via audited action queue store", () => {
  it("emits exactly one action_escalated event per created proposal", async () => {
    const dir = makeTempDir("gov-p147-refresh-");
    try {
      const signalStore = new FileSignalStore(dir);
      await signalStore.append(makeSignal({ signalId: "sig-refresh-1" }));

      const decisionStore = new FileDecisionStore(dir);
      await decisionStore.append(makeDecision("escalate", {
        decisionId: "dec-refresh-1",
        signalId: "sig-refresh-1",
      }));

      const { store: auditStore, events } = createSpyAuditStore();
      const actionQueueStore = auditActionQueueStore(new FileActionQueueStore(dir), auditStore);

      const created = await refreshProposals(signalStore, decisionStore, actionQueueStore, NOW);

      assert.equal(created.length, 1);
      assert.equal(events.length, 1);
      assert.equal(events[0]!.eventType, "action_escalated");
      assert.equal(events[0]!.subjectId, created[0]!.proposalId);
    } finally {
      cleanupTempDir(dir);
    }
  });

  it("emits exactly two events for two eligible decisions (escalate + convert_to_issue)", async () => {
    const dir = makeTempDir("gov-p147-refresh-");
    try {
      const signalStore = new FileSignalStore(dir);
      await signalStore.append(makeSignal({ signalId: "sig-a" }));
      await signalStore.append(makeSignal({ signalId: "sig-b" }));

      const decisionStore = new FileDecisionStore(dir);
      await decisionStore.append(makeDecision("escalate", { decisionId: "dec-a", signalId: "sig-a" }));
      await decisionStore.append(makeDecision("convert_to_issue", { decisionId: "dec-b", signalId: "sig-b" }));

      const { store: auditStore, events } = createSpyAuditStore();
      const actionQueueStore = auditActionQueueStore(new FileActionQueueStore(dir), auditStore);

      const created = await refreshProposals(signalStore, decisionStore, actionQueueStore, NOW);

      assert.equal(created.length, 2);
      assert.equal(events.length, 2);
      assert.equal(events[0]!.eventType, "action_escalated");
      assert.equal(events[1]!.eventType, "action_escalated");
    } finally {
      cleanupTempDir(dir);
    }
  });

  it("emits zero new events on re-run (dedup)", async () => {
    const dir = makeTempDir("gov-p147-refresh-");
    try {
      const signalStore = new FileSignalStore(dir);
      await signalStore.append(makeSignal({ signalId: "sig-dedup" }));

      const decisionStore = new FileDecisionStore(dir);
      await decisionStore.append(makeDecision("escalate", { decisionId: "dec-dedup", signalId: "sig-dedup" }));

      const { store: auditStore, events } = createSpyAuditStore();
      const actionQueueStore = auditActionQueueStore(new FileActionQueueStore(dir), auditStore);

      const firstRun = await refreshProposals(signalStore, decisionStore, actionQueueStore, NOW);
      assert.equal(firstRun.length, 1);
      assert.equal(events.length, 1);

      // Re-run over the same data — proposals already exist, so no new writes
      const secondRun = await refreshProposals(signalStore, decisionStore, actionQueueStore, NOW);
      assert.equal(secondRun.length, 0);
      assert.equal(events.length, 1, "re-run must not emit new audit events");
    } finally {
      cleanupTempDir(dir);
    }
  });

  it("emits zero events when the decision's signal is missing", async () => {
    const dir = makeTempDir("gov-p147-refresh-");
    try {
      const signalStore = new FileSignalStore(dir);
      const decisionStore = new FileDecisionStore(dir);
      // Eligible decision, but no matching signal in the store
      await decisionStore.append(makeDecision("escalate", { decisionId: "dec-orphan", signalId: "sig-missing" }));

      const { store: auditStore, events } = createSpyAuditStore();
      const actionQueueStore = auditActionQueueStore(new FileActionQueueStore(dir), auditStore);

      const created = await refreshProposals(signalStore, decisionStore, actionQueueStore, NOW);

      assert.equal(created.length, 0);
      assert.equal(events.length, 0);
    } finally {
      cleanupTempDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// P14.7 — Full-matrix single audit emission (correct eventType per mutation)
// ---------------------------------------------------------------------------

describe("full-matrix single audit emission (correct eventType)", () => {
  it("signal append emits exactly one policy_evaluated event", async () => {
    const { store: audit, events } = createSpyAuditStore();
    const store = auditSignalStore(createMockSignalStore(), audit);

    await store.append(makeSignal());

    assert.equal(events.length, 1);
    assert.equal(events[0]!.eventType, "policy_evaluated");
  });

  it("review append emits exactly one human_approval_requested event", async () => {
    const { store: audit, events } = createSpyAuditStore();
    const store = auditReviewStore(createMockReviewStore(), audit);

    await store.append(makeReview());

    assert.equal(events.length, 1);
    assert.equal(events[0]!.eventType, "human_approval_requested");
  });

  it("decide accept emits exactly one action_allowed event", async () => {
    const { store: audit, events } = createSpyAuditStore();
    const store = auditDecisionStore(createMockDecisionStore(), audit);

    await store.append(makeDecision("accept"));

    assert.equal(events.length, 1);
    assert.equal(events[0]!.eventType, "action_allowed");
  });

  it("decide dismiss emits exactly one action_denied event", async () => {
    const { store: audit, events } = createSpyAuditStore();
    const store = auditDecisionStore(createMockDecisionStore(), audit);

    await store.append(makeDecision("dismiss"));

    assert.equal(events.length, 1);
    assert.equal(events[0]!.eventType, "action_denied");
  });

  it("decide escalate emits exactly one action_escalated event", async () => {
    const { store: audit, events } = createSpyAuditStore();
    const store = auditDecisionStore(createMockDecisionStore(), audit);

    await store.append(makeDecision("escalate"));

    assert.equal(events.length, 1);
    assert.equal(events[0]!.eventType, "action_escalated");
  });

  it("actions mark-executed emits exactly one override_applied event", async () => {
    const { store: audit, events } = createSpyAuditStore();
    const store = auditActionQueueStore(createMockActionQueueStore(), audit);

    await store.appendStatusTransition(makeTransition("marked_executed_elsewhere"));

    assert.equal(events.length, 1);
    assert.equal(events[0]!.eventType, "override_applied");
  });

  it("actions dismiss transition emits exactly one override_applied event", async () => {
    const { store: audit, events } = createSpyAuditStore();
    const store = auditActionQueueStore(createMockActionQueueStore(), audit);

    await store.appendStatusTransition(makeTransition("dismissed"));

    assert.equal(events.length, 1);
    assert.equal(events[0]!.eventType, "override_applied");
  });
});

// ---------------------------------------------------------------------------
// P14.7 — Read-only operations remain audit-silent (consolidated matrix)
// ---------------------------------------------------------------------------

describe("read-only operations remain audit-silent (matrix)", () => {
  it("audited signal store read methods emit zero events", async () => {
    const { store: audit, events } = createSpyAuditStore();
    const store = auditSignalStore(createMockSignalStore(), audit);

    await store.list();
    await store.getById("any");
    await store.query({ severity: "high" });

    assert.equal(events.length, 0);
  });

  it("audited decision store read methods emit zero events", async () => {
    const { store: audit, events } = createSpyAuditStore();
    const store = auditDecisionStore(createMockDecisionStore(), audit);

    await store.list();
    await store.getById("any");
    await store.getBySignalId("any");
    await store.getByKind("accept");

    assert.equal(events.length, 0);
  });

  it("audited action queue store read methods emit zero events", async () => {
    const { store: audit, events } = createSpyAuditStore();
    const store = auditActionQueueStore(createMockActionQueueStore(), audit);

    await store.list();
    await store.getById("any");
    await store.getByDecisionId("any");
    await store.getTransitions("any");

    assert.equal(events.length, 0);
  });

  it("audited review store read methods emit zero events", async () => {
    const { store: audit, events } = createSpyAuditStore();
    const store = auditReviewStore(createMockReviewStore(), audit);

    await store.list();
    await store.getById("any");
    await store.getBySignalId("any");

    assert.equal(events.length, 0);
  });
});
