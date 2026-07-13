/**
 * Integration tests for A3 — Governance Decision Pipeline.
 *
 * Tests the full A2→A3→evolution lifecycle integration with
 * real implementations (not mocks) of all pipeline components:
 * - EvolutionStateMachine (A0.2)
 * - InMemoryVerificationEvidenceLedger (A2.4)
 * - RecommendationEngine (A2.5)
 * - generateDecision / decisionKindToTargetState (A3)
 * - GovernanceDecisionBridge (A3)
 * - InMemoryGovernanceDecisionStore (A3)
 *
 * Tests 4 scenarios:
 * 1. Full end-to-end happy path (APPROVE) — evidence → recommendation → decision → bridge → state change
 * 2. Wrong evolution state → bridge catches illegal transition, no state change
 * 3. No actionable evidence → insufficient evidence quality, REQUEST_MORE_EVIDENCE, no state change
 * 4. Expired evidence → fail-closed REJECT, state transitions to REJECTED
 *
 * @module a3-integration
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EvolutionStateMachine } from "../../../../src/evolution/evolution-state-machine.js";
import { EvolutionState } from "../../../../src/evolution/contracts/evolution-contract.js";
import {
  InMemoryVerificationEvidenceLedger,
  createVerificationEvidence,
} from "../../../../src/evolution/verification/index.js";
import {
  RecommendationEngine,
  DEFAULT_RECOMMENDATION_CONFIG,
} from "../../../../src/evolution/verification/recommendation/recommendation-engine.js";
import { generateDecision } from "../../../../src/evolution/governance/decision-engine.js";
import { GovernanceDecisionBridge } from "../../../../src/evolution/governance/governance-decision-bridge.js";
import { InMemoryGovernanceDecisionStore } from "../../../../src/evolution/governance/decision-store.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Create credible, high-confidence evidence sufficient for APPROVE.
 * Uses createVerificationEvidence to get a valid integrityHash.
 */
function makeHighConfidenceEvidence() {
  return createVerificationEvidence({
    verificationId: "ver-int-001",
    proposalId: "prop-int-001",
    replayDatasetId: "ds-int-001",
    proposalSnapshotHash: "hash-proposal",
    environmentHash: "hash-env",
    baselineMetrics: { accuracy: 0.85 },
    candidateMetrics: { accuracy: 0.92 },
    metricDeltas: { accuracy: 0.07 },
    behavioralChanges: [],
    confidenceProfile: {
      replayFidelity: 0.95,
      coverage: 0.90,
      determinism: 1.0,
      historicalSimilarity: 0.95,
      overallConfidence: 0.92,
    },
    reproducibilityLevel: 2,
    lineage: [],
    verifiedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  });
}

/**
 * Evidence with reproducibilityLevel below the default policy threshold.
 * generateDecision should return REQUEST_MORE_EVIDENCE (insufficient quality
 * for governance action).
 */
function makeLowReproducibilityEvidence() {
  return createVerificationEvidence({
    verificationId: "ver-int-002",
    proposalId: "prop-int-002",
    replayDatasetId: "ds-int-002",
    proposalSnapshotHash: "hash-proposal",
    environmentHash: "hash-env",
    baselineMetrics: { accuracy: 0.85 },
    candidateMetrics: { accuracy: 0.87 },
    metricDeltas: { accuracy: 0.02 },
    behavioralChanges: [],
    confidenceProfile: {
      replayFidelity: 0.5,
      coverage: 0.5,
      determinism: 0.6,
      historicalSimilarity: 0.5,
      overallConfidence: 0.85,
    },
    reproducibilityLevel: 0, // below minReproducibilityLevel of 2
    lineage: [],
    verifiedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  });
}

/**
 * Evidence with expiresAt in the past. generateDecision should REJECT
 * due to fail-closed expired evidence check (performed before any
 * confidence or regression checks).
 */
function makeExpiredEvidence() {
  return createVerificationEvidence({
    verificationId: "ver-int-expired",
    proposalId: "prop-int-expired",
    replayDatasetId: "ds-int-003",
    proposalSnapshotHash: "hash-proposal",
    environmentHash: "hash-env",
    baselineMetrics: { accuracy: 0.85 },
    candidateMetrics: { accuracy: 0.92 },
    metricDeltas: { accuracy: 0.07 },
    behavioralChanges: [],
    confidenceProfile: {
      replayFidelity: 0.95,
      coverage: 0.90,
      determinism: 1.0,
      historicalSimilarity: 0.95,
      overallConfidence: 0.92,
    },
    reproducibilityLevel: 2,
    lineage: [],
    verifiedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("A3 Integration", () => {
  it("runs full A2→A3→lifecycle end-to-end (APPROVE)", async () => {
    // 1. Create EvolutionStateMachine with an evolution in UNDER_REVIEW.
    const evidence = makeHighConfidenceEvidence();
    const sm = new EvolutionStateMachine();
    // decision engine sets decision.evolutionId = evidence.proposalId,
    // so create evolution with matching ID.
    sm.createEvolution(evidence.proposalId, EvolutionState.UNDER_REVIEW);

    // 2. Store evidence in InMemoryVerificationEvidenceLedger
    const ledger = new InMemoryVerificationEvidenceLedger();
    await ledger.store(evidence);

    // 3. Generate A2.5 recommendation from evidence
    const engine = new RecommendationEngine(DEFAULT_RECOMMENDATION_CONFIG);
    const recommendation = engine.generate(evidence);
    assert.ok(recommendation.recommendationId.startsWith("rec-"));
    assert.strictEqual(recommendation.kind, "APPROVE");

    // 4. Call generateDecision() with evidence + recommendation
    const decision = generateDecision(evidence, recommendation);

    // Verify decision engine produced APPROVE (confidence 0.92 >= 0.8)
    assert.strictEqual(decision.kind, "APPROVE");
    assert.strictEqual(decision.targetState, "APPROVED");

    // 5. Execute via GovernanceDecisionBridge
    const decisionStore = new InMemoryGovernanceDecisionStore();
    const bridge = new GovernanceDecisionBridge(sm, decisionStore);
    const result = await bridge.execute(decision);

    // 6. Assert: decision stored
    assert.strictEqual(result.decision.decisionId, decision.decisionId);
    assert.strictEqual(result.decision.kind, "APPROVE");

    const stored = await decisionStore.get(decision.decisionId);
    assert.strictEqual(stored.decisionId, decision.decisionId);
    assert.strictEqual(stored.kind, "APPROVE");
    assert.strictEqual(stored.proposalId, evidence.proposalId);

    // 6a. Assert: evidenceId matches source evidence
    assert.strictEqual(stored.evidenceId, evidence.evidenceId);
    assert.strictEqual(decision.evidenceId, evidence.evidenceId);

    // 6b. Assert: policySnapshot reflects DEFAULT_GOVERNANCE_POLICY
    assert.strictEqual(stored.policySnapshot.policyName, "default");
    assert.strictEqual(stored.policySnapshot.minApproveConfidence, 0.8);
    assert.strictEqual(
      stored.policySnapshot.rejectConfidenceThreshold,
      0.3,
    );

    // 6c. Assert: lifecycle transitioned to APPROVED
    assert.strictEqual(result.lifecycleTransitioned, true);
    assert.ok(result.transition);
    assert.strictEqual(result.transition.current, EvolutionState.APPROVED);
    assert.strictEqual(result.transition.previous, EvolutionState.UNDER_REVIEW);

    const currentState = sm.getStatus(evidence.proposalId);
    assert.strictEqual(currentState, EvolutionState.APPROVED);

    // Recommendation tracking
    assert.strictEqual(decision.recommendationAvailable, true);
    assert.strictEqual(decision.followedRecommendation, true);
    assert.strictEqual(
      decision.recommendationId,
      recommendation.recommendationId,
    );
    assert.strictEqual(decision.overrideReason, undefined);
  });

  it("rejects when evolution is in wrong state", async () => {
    // Create evolution in DRAFT — cannot directly transition to APPROVED
    const evidence = makeHighConfidenceEvidence();
    const sm = new EvolutionStateMachine();
    sm.createEvolution(evidence.proposalId, EvolutionState.DRAFT);

    // Generate a valid APPROVE decision
    const engine = new RecommendationEngine(DEFAULT_RECOMMENDATION_CONFIG);
    const recommendation = engine.generate(evidence);
    const decision = generateDecision(evidence, recommendation);

    assert.strictEqual(decision.kind, "APPROVE");
    assert.strictEqual(decision.targetState, "APPROVED");

    // Execute via bridge — should fail because DRAFT → APPROVED is illegal
    const decisionStore = new InMemoryGovernanceDecisionStore();
    const bridge = new GovernanceDecisionBridge(sm, decisionStore);
    const result = await bridge.execute(decision);

    // Decision should still be stored (append-first invariant)
    assert.strictEqual(result.decision.decisionId, decision.decisionId);
    const stored = await decisionStore.get(decision.decisionId);
    assert.strictEqual(stored.decisionId, decision.decisionId);

    // Transition should have failed with error
    assert.strictEqual(result.lifecycleTransitioned, false);
    assert.strictEqual(result.transition, undefined);
    assert.ok(result.error);
    assert.ok(result.error!.includes("Illegal evolution transition"));

    // State should remain DRAFT
    const currentState = sm.getStatus(evidence.proposalId);
    assert.strictEqual(currentState, EvolutionState.DRAFT);
  });

  it("rejects when no evidence found", async () => {
    // Create evolution but evidence quality is too low for governance action.
    // "No evidence found" means no actionable evidence is available to
    // reach a binding governance decision.
    const evidence = makeLowReproducibilityEvidence();
    const sm = new EvolutionStateMachine();
    sm.createEvolution(evidence.proposalId, EvolutionState.UNDER_REVIEW);

    // generateDecision should produce REQUEST_MORE_EVIDENCE
    const decision = generateDecision(evidence);

    assert.strictEqual(decision.kind, "REQUEST_MORE_EVIDENCE");
    assert.strictEqual(decision.targetState, "UNDER_REVIEW");
    assert.ok(
      decision.reasoning.includes("Reproducibility level"),
    );

    // Execute via bridge — target state (UNDER_REVIEW) matches current
    const decisionStore = new InMemoryGovernanceDecisionStore();
    const bridge = new GovernanceDecisionBridge(sm, decisionStore);
    const result = await bridge.execute(decision);

    // No lifecycle transition since already in UNDER_REVIEW
    assert.strictEqual(result.lifecycleTransitioned, false);
    assert.strictEqual(result.transition, undefined);

    // Evolution state unchanged
    const currentState = sm.getStatus(evidence.proposalId);
    assert.strictEqual(currentState, EvolutionState.UNDER_REVIEW);

    // Decision still stored
    const stored = await decisionStore.get(decision.decisionId);
    assert.strictEqual(stored.kind, "REQUEST_MORE_EVIDENCE");
    assert.strictEqual(stored.targetState, "UNDER_REVIEW");
  });

  it("rejects expired evidence with fail-closed", async () => {
    // Create evolution in UNDER_REVIEW
    const evidence = makeExpiredEvidence();
    const sm = new EvolutionStateMachine();
    sm.createEvolution(evidence.proposalId, EvolutionState.UNDER_REVIEW);

    // generateDecision should check isEvidenceExpired first and REJECT
    const decision = generateDecision(evidence);

    assert.strictEqual(decision.kind, "REJECT");
    assert.strictEqual(decision.targetState, "REJECTED");
    assert.ok(decision.risks.some((r) => r.includes("expired")));
    assert.strictEqual(decision.decidedBy, "governance_policy");
    assert.strictEqual(decision.evidenceId, evidence.evidenceId);

    // Execute via bridge — should transition to REJECTED
    const decisionStore = new InMemoryGovernanceDecisionStore();
    const bridge = new GovernanceDecisionBridge(sm, decisionStore);
    const result = await bridge.execute(decision);

    // Decision stored
    assert.strictEqual(result.decision.decisionId, decision.decisionId);
    assert.strictEqual(result.decision.kind, "REJECT");

    // Lifecycle transitioned to REJECTED (UNDER_REVIEW → REJECTED is allowed)
    assert.strictEqual(result.lifecycleTransitioned, true);
    assert.ok(result.transition);
    assert.strictEqual(result.transition.current, EvolutionState.REJECTED);
    assert.strictEqual(result.transition.previous, EvolutionState.UNDER_REVIEW);

    const currentState = sm.getStatus(evidence.proposalId);
    assert.strictEqual(currentState, EvolutionState.REJECTED);

    // Policy snapshot reflects fail-closed config
    assert.strictEqual(
      result.decision.policySnapshot.failClosedOnExpiredEvidence,
      true,
    );
  });
});
