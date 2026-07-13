/**
 * Tests A3 — InMemoryGovernanceDecisionStore.
 *
 * Covers all 6 test cases from the Task 2 brief:
 * - stores and retrieves decision by ID
 * - throws on duplicate decisionId (append-only)
 * - throws on unknown decisionId
 * - listByProposal returns correct decisions
 * - listByEvolution returns correct decisions
 * - deep copy prevents external mutation
 *
 * @module decision-store
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryGovernanceDecisionStore,
  DecisionNotFoundError,
  DuplicateDecisionError,
  DEFAULT_GOVERNANCE_POLICY,
} from "../../../src/evolution/governance/index.js";
import type { GovernanceDecision } from "../../../src/evolution/governance/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDecision(
  overrides: Partial<GovernanceDecision> = {},
): GovernanceDecision {
  return {
    decisionId: "govd-001",
    proposalId: "prop-001",
    evolutionId: "evol-001",
    kind: "APPROVE",
    confidence: 0.9,
    reasoning: "All verification checks passed with high confidence.",
    risks: ["low risk of minor perf regression"],
    evidenceId: "ev-001",
    recommendationAvailable: true,
    followedRecommendation: true,
    policySnapshot: DEFAULT_GOVERNANCE_POLICY,
    targetState: "APPROVED",
    decidedAt: "2026-07-12T10:00:00.000Z",
    decidedBy: "governance_policy",
    integrityHash: "test-hash",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InMemoryGovernanceDecisionStore", () => {
  it("stores and retrieves decision by ID", async () => {
    const store = new InMemoryGovernanceDecisionStore();
    const decision = makeDecision();
    await store.store(decision);

    const retrieved = await store.get(decision.decisionId);
    assert.strictEqual(retrieved.decisionId, "govd-001");
    assert.strictEqual(retrieved.proposalId, "prop-001");
    assert.strictEqual(retrieved.evolutionId, "evol-001");
    assert.strictEqual(retrieved.kind, "APPROVE");
    assert.strictEqual(retrieved.confidence, 0.9);
    assert.strictEqual(retrieved.targetState, "APPROVED");
    assert.strictEqual(retrieved.decidedBy, "governance_policy");
  });

  it("throws DuplicateDecisionError on duplicate decisionId (append-only)", async () => {
    const store = new InMemoryGovernanceDecisionStore();
    const decision = makeDecision();
    await store.store(decision);

    await assert.rejects(
      () => store.store(decision),
      DuplicateDecisionError,
    );
  });

  it("throws DecisionNotFoundError for unknown decisionId", async () => {
    const store = new InMemoryGovernanceDecisionStore();

    await assert.rejects(
      () => store.get("nonexistent"),
      DecisionNotFoundError,
    );
  });

  it("listByProposal returns correct decisions", async () => {
    const store = new InMemoryGovernanceDecisionStore();
    await store.store(makeDecision({ decisionId: "govd-001", proposalId: "prop-001" }));
    await store.store(makeDecision({ decisionId: "govd-002", proposalId: "prop-001" }));
    await store.store(makeDecision({ decisionId: "govd-003", proposalId: "prop-002" }));
    await store.store(makeDecision({ decisionId: "govd-004", proposalId: "prop-001" }));

    const results = await store.listByProposal("prop-001");
    assert.strictEqual(results.length, 3);
    assert.ok(results.every((d) => d.proposalId === "prop-001"));
    assert.strictEqual(results[0].decisionId, "govd-001");
    assert.strictEqual(results[1].decisionId, "govd-002");
    assert.strictEqual(results[2].decisionId, "govd-004");
  });

  it("listByEvolution returns correct decisions", async () => {
    const store = new InMemoryGovernanceDecisionStore();
    await store.store(makeDecision({ decisionId: "govd-001", evolutionId: "evol-001" }));
    await store.store(makeDecision({ decisionId: "govd-002", evolutionId: "evol-001" }));
    await store.store(makeDecision({ decisionId: "govd-003", evolutionId: "evol-002" }));
    await store.store(makeDecision({ decisionId: "govd-004", evolutionId: "evol-001" }));

    const results = await store.listByEvolution("evol-001");
    assert.strictEqual(results.length, 3);
    assert.ok(results.every((d) => d.evolutionId === "evol-001"));
    assert.strictEqual(results[0].decisionId, "govd-001");
    assert.strictEqual(results[1].decisionId, "govd-002");
    assert.strictEqual(results[2].decisionId, "govd-004");
  });

  it("listByProposal returns empty array when no decisions exist for proposal", async () => {
    const store = new InMemoryGovernanceDecisionStore();
    await store.store(makeDecision({ decisionId: "govd-001", proposalId: "prop-001" }));

    const results = await store.listByProposal("prop-999");
    assert.deepStrictEqual(results, []);
  });

  it("listByEvolution returns empty array when no decisions exist for evolution", async () => {
    const store = new InMemoryGovernanceDecisionStore();
    await store.store(makeDecision({ decisionId: "govd-001", evolutionId: "evol-001" }));

    const results = await store.listByEvolution("evol-999");
    assert.deepStrictEqual(results, []);
  });

  it("deep copy prevents external mutation of stored decision", async () => {
    const store = new InMemoryGovernanceDecisionStore();
    const decision = makeDecision();
    await store.store(decision);

    // Mutate the original reference
    (decision as unknown as Record<string, unknown>).kind = "REJECT";

    // Retrieved copy should still be APPROVE
    const retrieved = await store.get("govd-001");
    assert.strictEqual(retrieved.kind, "APPROVE");
  });

  it("deep copy prevents external mutation of returned decision", async () => {
    const store = new InMemoryGovernanceDecisionStore();
    await store.store(makeDecision());

    const retrieved = await store.get("govd-001");
    // Mutate the retrieved copy
    (retrieved as unknown as Record<string, unknown>).kind = "REJECT";

    // Second retrieval should still be APPROVE
    const retrievedAgain = await store.get("govd-001");
    assert.strictEqual(retrievedAgain.kind, "APPROVE");
  });
});
