/**
 * Tests for P14.4 — Action Queue.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import {
  validateActionProposal,
  validateActionProposalStatusTransition,
  FileActionQueueStore,
  createActionProposal,
  refreshProposals,
  deriveEffectiveStatus,
  type GovernanceActionProposal,
  type ActionProposalKind,
  type ActionProposalStatus,
  type ActionProposalStatusTransition,
} from "../../src/governance/action-queue.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = "2026-07-06T14:00:00.000Z";

function validProposal(overrides: Partial<GovernanceActionProposal> = {}): GovernanceActionProposal {
  return {
    proposalId: "prop-test-1",
    decisionId: "dec-test-1",
    signalId: "sig-test-1",
    kind: "escalation_review",
    title: "Test escalation",
    description: "An escalation review derived from test decision",
    rationale: "Needs higher-level review",
    status: "pending",
    executionRef: null,
    createdAt: NOW,
    ...overrides,
  };
}

function validTransition(overrides: Partial<ActionProposalStatusTransition> = {}): ActionProposalStatusTransition {
  return {
    transitionId: "trans-test-1",
    proposalId: "prop-test-1",
    status: "marked_executed_elsewhere",
    reason: null,
    executionRef: "manual/gh#123",
    createdAt: NOW,
    ...overrides,
  };
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "gov-aq-test-"));
}

function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function setupStore(): { store: FileActionQueueStore; cleanup: () => void } {
  const dir = makeTempDir();
  return { store: new FileActionQueueStore(dir), cleanup: () => cleanupTempDir(dir) };
}

// ---------------------------------------------------------------------------
// Proposal Validation
// ---------------------------------------------------------------------------

describe("validateActionProposal", () => {
  it("accepts a valid escalation_review proposal", () => {
    const result = validateActionProposal(validProposal());
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("accepts a valid github_issue proposal", () => {
    const result = validateActionProposal(validProposal({ kind: "github_issue" }));
    assert.equal(result.valid, true);
  });

  it("rejects non-object", () => {
    const result = validateActionProposal("not-an-object");
    assert.equal(result.valid, false);
  });

  it("rejects empty object", () => {
    const result = validateActionProposal({});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("proposalId")));
  });

  it("rejects missing proposalId", () => {
    const result = validateActionProposal(validProposal({ proposalId: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("proposalId")));
  });

  it("rejects missing decisionId", () => {
    const result = validateActionProposal(validProposal({ decisionId: "" }));
    assert.equal(result.valid, false);
  });

  it("rejects missing signalId", () => {
    const result = validateActionProposal(validProposal({ signalId: "" }));
    assert.equal(result.valid, false);
  });

  it("rejects invalid kind", () => {
    const result = validateActionProposal(validProposal({ kind: "invalid" as ActionProposalKind }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("kind")));
  });

  it("rejects non-pending status", () => {
    const result = validateActionProposal(validProposal({ status: "dismissed" as "pending" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("status")));
  });

  it("rejects empty title", () => {
    const result = validateActionProposal(validProposal({ title: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("title")));
  });

  it("rejects empty description", () => {
    const result = validateActionProposal(validProposal({ description: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("description")));
  });

  it("rejects empty rationale", () => {
    const result = validateActionProposal(validProposal({ rationale: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("rationale")));
  });

  it("rejects empty executionRef when non-null", () => {
    const result = validateActionProposal(validProposal({ executionRef: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("executionRef")));
  });

  it("accepts null executionRef", () => {
    const result = validateActionProposal(validProposal({ executionRef: null }));
    assert.equal(result.valid, true);
  });

  it("accepts non-null executionRef", () => {
    const result = validateActionProposal(validProposal({ executionRef: "manual/gh#456" }));
    assert.equal(result.valid, true);
  });

  it("rejects missing createdAt", () => {
    const result = validateActionProposal(validProposal({ createdAt: "" }));
    assert.equal(result.valid, false);
  });
});

// ---------------------------------------------------------------------------
// Transition Validation
// ---------------------------------------------------------------------------

describe("validateActionProposalStatusTransition", () => {
  it("accepts a valid marked_executed_elsewhere transition", () => {
    const result = validateActionProposalStatusTransition(validTransition());
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("accepts a valid dismissed transition with reason and null executionRef", () => {
    const result = validateActionProposalStatusTransition(
      validTransition({ status: "dismissed", reason: "Not needed", executionRef: null }),
    );
    assert.equal(result.valid, true);
  });

  it("rejects non-object", () => {
    const result = validateActionProposalStatusTransition("not-an-object");
    assert.equal(result.valid, false);
  });

  it("rejects missing transitionId", () => {
    const result = validateActionProposalStatusTransition(validTransition({ transitionId: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("transitionId")));
  });

  it("rejects missing proposalId", () => {
    const result = validateActionProposalStatusTransition(validTransition({ proposalId: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("proposalId")));
  });

  it("rejects status pending", () => {
    const result = validateActionProposalStatusTransition(
      validTransition({ status: "pending" as "dismissed" }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("status")));
  });

  it("requires executionRef for marked_executed_elsewhere", () => {
    const result = validateActionProposalStatusTransition(
      validTransition({ executionRef: null }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("executionRef")));
  });

  it("requires executionRef to be non-empty for marked_executed_elsewhere", () => {
    const result = validateActionProposalStatusTransition(
      validTransition({ executionRef: "" }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("executionRef")));
  });

  it("requires reason for dismissed", () => {
    const result = validateActionProposalStatusTransition(
      validTransition({ status: "dismissed", reason: null, executionRef: null }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("reason")));
  });

  it("requires reason to be non-empty for dismissed", () => {
    const result = validateActionProposalStatusTransition(
      validTransition({ status: "dismissed", reason: "", executionRef: null }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("reason")));
  });

  it("rejects executionRef non-null for dismissed", () => {
    const result = validateActionProposalStatusTransition(
      validTransition({ status: "dismissed", reason: "Not needed", executionRef: "manual/gh#123" }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("executionRef")));
  });

  it("rejects missing createdAt", () => {
    const result = validateActionProposalStatusTransition(validTransition({ createdAt: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("createdAt")));
  });

  it("rejects invalid status string", () => {
    const result = validateActionProposalStatusTransition(
      validTransition({ status: "invalid_terminal" as "dismissed" }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("status")));
  });
});

// ---------------------------------------------------------------------------
// Store — Proposals
// ---------------------------------------------------------------------------

describe("FileActionQueueStore (proposals)", () => {
  it("returns empty list from non-existent file", async () => {
    const { store } = setupStore();
    assert.deepEqual(await store.list(), []);
  });

  it("appends and lists newest-first", async () => {
    const { store } = setupStore();
    await store.append(validProposal({ proposalId: "p1", createdAt: "2026-01-01T00:00:00Z" }));
    await store.append(validProposal({ proposalId: "p2", createdAt: "2026-06-01T00:00:00Z" }));

    const all = await store.list();
    assert.equal(all.length, 2);
    assert.equal(all[0]!.proposalId, "p2");
    assert.equal(all[1]!.proposalId, "p1");
  });

  it("lists with limit", async () => {
    const { store } = setupStore();
    await store.append(validProposal({ proposalId: "p1" }));
    await store.append(validProposal({ proposalId: "p2" }));
    await store.append(validProposal({ proposalId: "p3" }));

    assert.equal((await store.list(2)).length, 2);
  });

  it("getById returns matching proposal", async () => {
    const { store } = setupStore();
    await store.append(validProposal({ proposalId: "find-me" }));
    await store.append(validProposal({ proposalId: "other" }));

    const found = await store.getById("find-me");
    assert.notEqual(found, null);
    assert.equal(found!.proposalId, "find-me");
  });

  it("getById returns null for missing", async () => {
    const { store } = setupStore();
    assert.equal(await store.getById("nonexistent"), null);
  });

  it("getByDecisionId filters correctly", async () => {
    const { store } = setupStore();
    await store.append(validProposal({ proposalId: "p1", decisionId: "dec-a" }));
    await store.append(validProposal({ proposalId: "p2", decisionId: "dec-b" }));
    await store.append(validProposal({ proposalId: "p3", decisionId: "dec-a" }));

    const forDecA = await store.getByDecisionId("dec-a");
    assert.equal(forDecA.length, 2);
    assert.ok(forDecA.every((p) => p.decisionId === "dec-a"));
  });

  it("rejects invalid proposal on append", async () => {
    const { store } = setupStore();
    await assert.rejects(
      () => store.append({} as unknown as GovernanceActionProposal),
      /Invalid action proposal/,
    );
  });

  it("creates directory on first append", async () => {
    const nestedDir = join(makeTempDir(), "deep", "nested");
    const nestedStore = new FileActionQueueStore(nestedDir);
    await nestedStore.append(validProposal({ proposalId: "p1" }));
    assert.ok(existsSync(join(nestedDir, "governance-action-queue.jsonl")));
    cleanupTempDir(nestedDir);
  });

  it("skips malformed JSON lines on read", async () => {
    const dir = makeTempDir();
    const store = new FileActionQueueStore(dir);
    const filePath = join(dir, "governance-action-queue.jsonl");
    writeFileSync(filePath, "{invalid}\n" + JSON.stringify(validProposal({ proposalId: "p1" })) + "\n", "utf8");

    const all = await store.list();
    assert.equal(all.length, 1);
    assert.equal(all[0]!.proposalId, "p1");
    cleanupTempDir(dir);
  });

  it("skips lines with invalid proposal data on read", async () => {
    const dir = makeTempDir();
    const store = new FileActionQueueStore(dir);
    const filePath = join(dir, "governance-action-queue.jsonl");
    const badProposal = JSON.stringify({ proposalId: "bad", decisionId: "d1" });
    const goodProposal = JSON.stringify(validProposal({ proposalId: "good" }));
    writeFileSync(filePath, badProposal + "\n" + goodProposal + "\n", "utf8");

    const all = await store.list();
    assert.equal(all.length, 1);
    assert.equal(all[0]!.proposalId, "good");
    cleanupTempDir(dir);
  });
});

// ---------------------------------------------------------------------------
// Store — Transitions
// ---------------------------------------------------------------------------

describe("FileActionQueueStore (transitions)", () => {
  it("appendStatusTransition writes to transition file", async () => {
    const { store } = setupStore();
    await store.append(validProposal({ proposalId: "prop-1" }));
    await store.appendStatusTransition(
      validTransition({ transitionId: "t1", proposalId: "prop-1" }),
    );

    const transitions = await store.getTransitions("prop-1");
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0]!.transitionId, "t1");
  });

  it("getTransitions returns transitions newest-first", async () => {
    const { store } = setupStore();
    await store.append(validProposal({ proposalId: "prop-1" }));
    await store.appendStatusTransition(
      validTransition({ transitionId: "t1", proposalId: "prop-1", createdAt: "2026-01-01T00:00:00Z" }),
    );
    await store.appendStatusTransition(
      validTransition({ transitionId: "t2", proposalId: "prop-1", createdAt: "2026-06-01T00:00:00Z" }),
    );

    const transitions = await store.getTransitions("prop-1");
    assert.equal(transitions.length, 2);
    assert.equal(transitions[0]!.transitionId, "t2");
    assert.equal(transitions[1]!.transitionId, "t1");
  });

  it("getTransitions returns empty for unknown proposal", async () => {
    const { store } = setupStore();
    const transitions = await store.getTransitions("nonexistent");
    assert.deepEqual(transitions, []);
  });

  it("getTransitions returns only matching proposal's transitions", async () => {
    const { store } = setupStore();
    await store.append(validProposal({ proposalId: "prop-a" }));
    await store.append(validProposal({ proposalId: "prop-b" }));
    await store.appendStatusTransition(
      validTransition({ transitionId: "t-a", proposalId: "prop-a" }),
    );
    await store.appendStatusTransition(
      validTransition({ transitionId: "t-b", proposalId: "prop-b" }),
    );

    const forA = await store.getTransitions("prop-a");
    assert.equal(forA.length, 1);
    assert.equal(forA[0]!.transitionId, "t-a");
  });

  it("rejects invalid transition on append", async () => {
    const { store } = setupStore();
    await assert.rejects(
      () => store.appendStatusTransition({} as unknown as ActionProposalStatusTransition),
      /Invalid status transition/,
    );
  });

  it("rejects transition for missing proposal", async () => {
    const { store } = setupStore();
    await assert.rejects(
      () => store.appendStatusTransition(
        validTransition({ proposalId: "nonexistent" }),
      ),
      /Proposal not found/,
    );
  });

  it("creates directory on first transition append", async () => {
    const nestedDir = join(makeTempDir(), "deep", "transitions");
    const nestedStore = new FileActionQueueStore(nestedDir);
    await nestedStore.append(validProposal({ proposalId: "p1" }));
    await nestedStore.appendStatusTransition(
      validTransition({ proposalId: "p1" }),
    );
    assert.ok(existsSync(join(nestedDir, "governance-action-queue-transitions.jsonl")));
    cleanupTempDir(nestedDir);
  });
});

// ---------------------------------------------------------------------------
// Effective status derivation
// ---------------------------------------------------------------------------

describe("deriveEffectiveStatus", () => {
  it("returns pending when no transitions", () => {
    const proposal = validProposal();
    assert.equal(deriveEffectiveStatus(proposal, []), "pending");
  });

  it("returns status from newest transition", () => {
    const proposal = validProposal();
    const transitions = [
      validTransition({ transitionId: "t2", status: "dismissed", reason: "Done", executionRef: null, createdAt: "2026-06-01T00:00:00Z" }),
      validTransition({ transitionId: "t1", status: "marked_executed_elsewhere", executionRef: "manual/x", createdAt: "2026-01-01T00:00:00Z" }),
    ];
    assert.equal(deriveEffectiveStatus(proposal, transitions), "dismissed");
  });
});

// ---------------------------------------------------------------------------
// Proposal creation
// ---------------------------------------------------------------------------

describe("createActionProposal", () => {
  it("creates escalation_review from escalate decision", async () => {
    const decision = { decisionId: "dec-1", signalId: "sig-1", decision: "escalate", rationale: "Needs review" };
    const signal = { signalId: "sig-1", title: "High severity alert" };

    const proposal = await createActionProposal("prop-1", decision, signal, NOW);

    assert.equal(proposal.kind, "escalation_review");
    assert.equal(proposal.decisionId, "dec-1");
    assert.equal(proposal.signalId, "sig-1");
    assert.equal(proposal.rationale, "Needs review");
    assert.equal(proposal.title, "High severity alert");
    assert.equal(proposal.status, "pending");
    assert.equal(proposal.executionRef, null);
  });

  it("creates github_issue from convert_to_issue decision", async () => {
    const decision = { decisionId: "dec-2", signalId: "sig-2", decision: "convert_to_issue", rationale: "Track this" };
    const signal = { signalId: "sig-2", title: "Policy suggestion" };

    const proposal = await createActionProposal("prop-2", decision, signal, NOW);

    assert.equal(proposal.kind, "github_issue");
    assert.equal(proposal.decisionId, "dec-2");
    assert.equal(proposal.signalId, "sig-2");
  });

  it("throws for accept decision", async () => {
    const decision = { decisionId: "dec-3", signalId: "sig-3", decision: "accept", rationale: "Agreed" };
    const signal = { signalId: "sig-3", title: "Test" };

    assert.throws(
      () => createActionProposal("prop-3", decision, signal, NOW),
      /not eligible/,
    );
  });

  it("throws for dismiss decision", async () => {
    const decision = { decisionId: "dec-4", signalId: "sig-4", decision: "dismiss", rationale: "False positive" };
    const signal = { signalId: "sig-4", title: "Test" };

    assert.throws(
      () => createActionProposal("prop-4", decision, signal, NOW),
      /not eligible/,
    );
  });

  it("throws for defer decision", async () => {
    const decision = { decisionId: "dec-5", signalId: "sig-5", decision: "defer", rationale: "Need more info" };
    const signal = { signalId: "sig-5", title: "Test" };

    assert.throws(
      () => createActionProposal("prop-5", decision, signal, NOW),
      /not eligible/,
    );
  });

  it("preserves decisionId backlink", async () => {
    const decision = { decisionId: "dec-original", signalId: "sig-1", decision: "escalate", rationale: "Escalate" };
    const signal = { signalId: "sig-1", title: "Test" };

    const proposal = await createActionProposal("prop-6", decision, signal, NOW);
    assert.equal(proposal.decisionId, "dec-original");
  });

  it("preserves signalId backlink", async () => {
    const decision = { decisionId: "dec-7", signalId: "sig-target", decision: "convert_to_issue", rationale: "Issue" };
    const signal = { signalId: "sig-target", title: "Target signal" };

    const proposal = await createActionProposal("prop-7", decision, signal, NOW);
    assert.equal(proposal.signalId, "sig-target");
  });

  it("uses signal description when available", async () => {
    const decision = { decisionId: "dec-8", signalId: "sig-8", decision: "escalate", rationale: "Review" };
    const signal = { signalId: "sig-8", title: "Alert", description: "Detailed description", severity: "high" };

    const proposal = await createActionProposal("prop-8", decision, signal, NOW);
    assert.equal(proposal.description, "Detailed description");
  });

  it("generates fallback description when signal has none", async () => {
    const decision = { decisionId: "dec-9", signalId: "sig-9", decision: "escalate", rationale: "Review" };
    const signal = { signalId: "sig-9", title: "Alert" };

    const proposal = await createActionProposal("prop-9", decision, signal, NOW);
    assert.ok(proposal.description.includes("dec-9"));
    assert.ok(proposal.description.includes("sig-9"));
  });
});

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

describe("refreshProposals", () => {
  it("creates proposals from eligible decisions", async () => {
    const { store } = setupStore();
    const decisionStore = {
      list: async () => [
        { decisionId: "d1", signalId: "s1", decision: "escalate", rationale: "Escalate this" },
        { decisionId: "d2", signalId: "s2", decision: "convert_to_issue", rationale: "Issue this" },
      ],
    };
    const signalStore = {
      getById: async (id: string) =>
        id === "s1" ? { signalId: "s1", title: "Alert 1" }
        : id === "s2" ? { signalId: "s2", title: "Suggestion 1", description: "Make an issue" }
        : null,
    };

    const created = await refreshProposals(signalStore, decisionStore, store, NOW);

    assert.equal(created.length, 2);
    assert.equal(created[0]!.kind, "escalation_review");
    assert.equal(created[0]!.decisionId, "d1");
    assert.equal(created[1]!.kind, "github_issue");
    assert.equal(created[1]!.decisionId, "d2");
  });

  it("skips decisions with existing proposals (dedup regardless of status)", async () => {
    const { store } = setupStore();
    // Pre-create a proposal for d1 (pending)
    await store.append(
      validProposal({ proposalId: "existing", decisionId: "d1", signalId: "s1", kind: "escalation_review" }),
    );

    const decisionStore = {
      list: async () => [
        { decisionId: "d1", signalId: "s1", decision: "escalate", rationale: "Escalate" },
        { decisionId: "d2", signalId: "s2", decision: "convert_to_issue", rationale: "Issue" },
      ],
    };
    const signalStore = {
      getById: async (id: string) =>
        id === "s2" ? { signalId: "s2", title: "Suggestion" } : null,
    };

    const created = await refreshProposals(signalStore, decisionStore, store, NOW);

    // Only d2 should generate a proposal; d1 already has one
    assert.equal(created.length, 1);
    assert.equal(created[0]!.decisionId, "d2");
  });

  it("skips decisions with existing dismissed proposals", async () => {
    const { store } = setupStore();
    // Pre-create a proposal for d1 that has been dismissed
    await store.append(
      validProposal({ proposalId: "dismissed-prop", decisionId: "d1", signalId: "s1", kind: "escalation_review" }),
    );

    const decisionStore = {
      list: async () => [
        { decisionId: "d1", signalId: "s1", decision: "escalate", rationale: "Escalate" },
      ],
    };
    const signalStore = {
      getById: async () => null,
    };

    const created = await refreshProposals(signalStore, decisionStore, store, NOW);

    // d1 already has a proposal (even if later dismissed), so no new proposal
    assert.equal(created.length, 0);
  });

  it("skips decisions with existing executed proposals", async () => {
    const { store } = setupStore();
    // Pre-create a proposal for d1 that has been marked executed
    await store.append(
      validProposal({ proposalId: "executed-prop", decisionId: "d1", signalId: "s1", kind: "escalation_review" }),
    );

    const decisionStore = {
      list: async () => [
        { decisionId: "d1", signalId: "s1", decision: "escalate", rationale: "Escalate" },
      ],
    };
    const signalStore = {
      getById: async () => null,
    };

    const created = await refreshProposals(signalStore, decisionStore, store, NOW);
    assert.equal(created.length, 0);
  });

  it("does nothing when no eligible decisions", async () => {
    const { store } = setupStore();
    const decisionStore = {
      list: async () => [
        { decisionId: "d1", signalId: "s1", decision: "accept", rationale: "OK" },
        { decisionId: "d2", signalId: "s2", decision: "dismiss", rationale: "No" },
      ],
    };
    const signalStore = {
      getById: async () => null,
    };

    const created = await refreshProposals(signalStore, decisionStore, store, NOW);
    assert.equal(created.length, 0);
  });

  it("skips decisions where signal is missing (partial success)", async () => {
    const { store } = setupStore();
    const decisionStore = {
      list: async () => [
        { decisionId: "d1", signalId: "s1", decision: "escalate", rationale: "Escalate" },
        { decisionId: "d2", signalId: "s2", decision: "convert_to_issue", rationale: "Issue" },
      ],
    };
    const signalStore = {
      getById: async (id: string) =>
        id === "s1" ? { signalId: "s1", title: "Alert 1" } : null, // s2 missing
    };

    const created = await refreshProposals(signalStore, decisionStore, store, NOW);

    assert.equal(created.length, 1);
    assert.equal(created[0]!.decisionId, "d1");
  });

  it("returns empty array when no decisions at all", async () => {
    const { store } = setupStore();
    const decisionStore = { list: async () => [] };
    const signalStore = { getById: async () => null };

    const created = await refreshProposals(signalStore, decisionStore, store, NOW);
    assert.deepEqual(created, []);
  });
});
