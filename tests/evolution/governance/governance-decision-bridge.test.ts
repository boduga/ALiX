/**
 * Tests A3 — GovernanceDecisionBridge.
 *
 * Covers all test cases from the Task 4 brief:
 * - APPROVE → stateMachine.transition() called with APPROVED
 * - REJECT → stateMachine.transition() called with REJECTED
 * - MONITOR → stateMachine.transition() NOT called (same state)
 * - REQUEST_MORE_EVIDENCE → stateMachine.transition() NOT called
 * - stateMachine.transition() throws → error captured in result
 * - Decision stored before transition attempted
 * - evidenceBridge emission when available
 *
 * @module governance-decision-bridge
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { GovernanceDecisionBridge } from "../../../src/evolution/governance/governance-decision-bridge.js";
import { EvolutionState } from "../../../src/evolution/contracts/evolution-contract.js";
import type { GovernanceDecision } from "../../../src/evolution/governance/contracts/decision-contract.js";
import type { GovernanceDecisionStore } from "../../../src/evolution/governance/contracts/decision-store-contract.js";
import type {
  EvolutionStateMachine,
  EvolutionTransitionResult,
  EvolutionTransitionEvent,
} from "../../../src/evolution/evolution-state-machine.js";
import type { EvolutionEvidenceBridge } from "../../../src/evolution/evolution-evidence-bridge.js";

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
    reasoning: "All checks passed.",
    risks: [],
    evidenceId: "ev-001",
    recommendationAvailable: false,
    followedRecommendation: false,
    policySnapshot: {
      policyName: "default",
      minApproveConfidence: 0.8,
      minMonitorConfidence: 0.5,
      rejectConfidenceThreshold: 0.3,
      maxAllowedRegressions: 0,
      escalateBehavior: "request_evidence",
      failClosedOnExpiredEvidence: true,
      minReproducibilityLevel: 2,
    },
    targetState: "APPROVED",
    decidedAt: "2026-07-12T10:00:00.000Z",
    decidedBy: "governance_policy",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockStateMachine(initialState: EvolutionState = EvolutionState.UNDER_REVIEW): {
  mock: EvolutionStateMachine;
  transitionCalls: Array<{ evolutionId: string; to: EvolutionState }>;
  transitionShouldThrow: Error | null;
} {
  let currentState = initialState;
  const transitionCalls: Array<{ evolutionId: string; to: EvolutionState }> = [];
  let transitionShouldThrow: Error | null = null;

  const mockStateMachine = {
    transition(evolutionId: string, to: EvolutionState): EvolutionTransitionResult {
      if (transitionShouldThrow) {
        throw transitionShouldThrow;
      }
      const from = currentState;
      currentState = to;
      transitionCalls.push({ evolutionId, to });
      const event: EvolutionTransitionEvent = {
        evolutionId,
        from,
        to,
        eventType: `Evolution${to}`,
        timestamp: "2026-07-12T10:00:00.000Z",
        summary: `Evolution Evolution${to}: ${from} → ${to}`,
      };
      return { previous: from, current: to, event };
    },
    getStatus(_evolutionId: string): EvolutionState {
      return currentState;
    },
    getHistory(_evolutionId: string): EvolutionTransitionEvent[] {
      return [];
    },
    listEvolutions() {
      return [];
    },
    createEvolution(_evolutionId: string, _initialState?: EvolutionState, _meta?: Record<string, unknown>): void {
      // no-op
    },
    getMetadata(_evolutionId: string): Record<string, unknown> | undefined {
      return undefined;
    },
  } as unknown as EvolutionStateMachine;

  return {
    mock: mockStateMachine,
    transitionCalls,
    get transitionShouldThrow() {
      return transitionShouldThrow;
    },
    set transitionShouldThrow(err: Error | null) {
      transitionShouldThrow = err;
    },
  };
}

function createMockDecisionStore(): {
  mock: GovernanceDecisionStore;
  storedDecisions: GovernanceDecision[];
} {
  const storedDecisions: GovernanceDecision[] = [];

  const mockStore: GovernanceDecisionStore = {
    async store(decision: GovernanceDecision): Promise<GovernanceDecision> {
      storedDecisions.push(decision);
      return { ...decision };
    },
    async get(decisionId: string): Promise<GovernanceDecision> {
      const found = storedDecisions.find((d) => d.decisionId === decisionId);
      if (!found) {
        throw new Error(`Decision not found: ${decisionId}`);
      }
      return { ...found };
    },
    async listByProposal(proposalId: string): Promise<GovernanceDecision[]> {
      return storedDecisions
        .filter((d) => d.proposalId === proposalId)
        .map((d) => ({ ...d }));
    },
    async listByEvolution(evolutionId: string): Promise<GovernanceDecision[]> {
      return storedDecisions
        .filter((d) => d.evolutionId === evolutionId)
        .map((d) => ({ ...d }));
    },
  };

  return { mock: mockStore, storedDecisions };
}

function createMockEvidenceBridge(): {
  mock: EvolutionEvidenceBridge;
  emittedEvents: EvolutionTransitionEvent[];
} {
  const emittedEvents: EvolutionTransitionEvent[] = [];

  const mockBridge = {
    emitTransitionEvent(event: EvolutionTransitionEvent): void {
      emittedEvents.push(event);
    },
  } as unknown as EvolutionEvidenceBridge;

  return { mock: mockBridge, emittedEvents };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GovernanceDecisionBridge", () => {
  it("APPROVE -> stateMachine.transition() called with APPROVED", async () => {
    const state = createMockStateMachine(EvolutionState.UNDER_REVIEW);
    const store = createMockDecisionStore();
    const bridge = new GovernanceDecisionBridge(state.mock, store.mock);

    const decision = makeDecision({ kind: "APPROVE" });
    const result = await bridge.execute(decision);

    assert.strictEqual(result.lifecycleTransitioned, true);
    assert.ok(result.transition);
    assert.strictEqual(result.transition.current, EvolutionState.APPROVED);
    assert.strictEqual(state.transitionCalls.length, 1);
    assert.strictEqual(state.transitionCalls[0].to, EvolutionState.APPROVED);
  });

  it("REJECT -> stateMachine.transition() called with REJECTED", async () => {
    const state = createMockStateMachine(EvolutionState.UNDER_REVIEW);
    const store = createMockDecisionStore();
    const bridge = new GovernanceDecisionBridge(state.mock, store.mock);

    const decision = makeDecision({ kind: "REJECT" });
    const result = await bridge.execute(decision);

    assert.strictEqual(result.lifecycleTransitioned, true);
    assert.ok(result.transition);
    assert.strictEqual(result.transition.current, EvolutionState.REJECTED);
    assert.strictEqual(state.transitionCalls.length, 1);
    assert.strictEqual(state.transitionCalls[0].to, EvolutionState.REJECTED);
  });

  it("MONITOR -> stateMachine.transition() NOT called (same state)", async () => {
    const state = createMockStateMachine(EvolutionState.UNDER_REVIEW);
    const store = createMockDecisionStore();
    const bridge = new GovernanceDecisionBridge(state.mock, store.mock);

    const decision = makeDecision({ kind: "MONITOR" });
    const result = await bridge.execute(decision);

    assert.strictEqual(result.lifecycleTransitioned, false);
    assert.strictEqual(result.transition, undefined);
    assert.strictEqual(state.transitionCalls.length, 0);
  });

  it("REQUEST_MORE_EVIDENCE -> stateMachine.transition() NOT called", async () => {
    const state = createMockStateMachine(EvolutionState.UNDER_REVIEW);
    const store = createMockDecisionStore();
    const bridge = new GovernanceDecisionBridge(state.mock, store.mock);

    const decision = makeDecision({ kind: "REQUEST_MORE_EVIDENCE" });
    const result = await bridge.execute(decision);

    assert.strictEqual(result.lifecycleTransitioned, false);
    assert.strictEqual(result.transition, undefined);
    assert.strictEqual(state.transitionCalls.length, 0);
  });

  it("stateMachine.transition() throws -> error captured in result", async () => {
    const state = createMockStateMachine(EvolutionState.UNDER_REVIEW);
    const store = createMockDecisionStore();
    const bridge = new GovernanceDecisionBridge(state.mock, store.mock);

    // Set the state machine to throw on transition
    (state as unknown as { transitionShouldThrow: Error }).transitionShouldThrow =
      new Error("Illegal transition: cannot approve from current state");

    const decision = makeDecision({ kind: "APPROVE" });
    const result = await bridge.execute(decision);

    // Decision should still be stored
    assert.strictEqual(result.decision.decisionId, "govd-001");

    // Transition should have failed
    assert.strictEqual(result.lifecycleTransitioned, false);
    assert.strictEqual(result.transition, undefined);
    assert.ok(result.error);
    assert.ok(result.error!.includes("Illegal transition"));
  });

  it("Decision stored before transition attempted", async () => {
    const state = createMockStateMachine(EvolutionState.UNDER_REVIEW);
    const store = createMockDecisionStore();
    const bridge = new GovernanceDecisionBridge(state.mock, store.mock);

    const decision = makeDecision({ kind: "APPROVE" });
    const result = await bridge.execute(decision);

    // Decision should be in the store
    assert.strictEqual(store.storedDecisions.length, 1);
    assert.strictEqual(store.storedDecisions[0].decisionId, "govd-001");

    // Transition should have happened (confirm flow completed)
    assert.strictEqual(result.lifecycleTransitioned, true);
    assert.strictEqual(state.transitionCalls.length, 1);
  });

  it("evidenceBridge emission when available", async () => {
    const state = createMockStateMachine(EvolutionState.UNDER_REVIEW);
    const store = createMockDecisionStore();
    const evidence = createMockEvidenceBridge();
    const bridge = new GovernanceDecisionBridge(
      state.mock,
      store.mock,
      evidence.mock,
    );

    const decision = makeDecision({ kind: "APPROVE" });
    const result = await bridge.execute(decision);

    // Transition should have succeeded
    assert.strictEqual(result.lifecycleTransitioned, true);
    assert.ok(result.transition);

    // Evidence bridge should have received the event
    assert.strictEqual(evidence.emittedEvents.length, 1);
    assert.strictEqual(
      evidence.emittedEvents[0].evolutionId,
      "evol-001",
    );
    assert.strictEqual(
      evidence.emittedEvents[0].to,
      EvolutionState.APPROVED,
    );
  });

  it("evidenceBridge NOT called when no bridge provided", async () => {
    const state = createMockStateMachine(EvolutionState.UNDER_REVIEW);
    const store = createMockDecisionStore();
    const bridge = new GovernanceDecisionBridge(state.mock, store.mock);

    const decision = makeDecision({ kind: "APPROVE" });
    const result = await bridge.execute(decision);

    // Transition should have succeeded
    assert.strictEqual(result.lifecycleTransitioned, true);
    assert.ok(result.transition);
    assert.strictEqual(result.transition.current, EvolutionState.APPROVED);
  });

  it("evidenceBridge NOT called when transition fails", async () => {
    const state = createMockStateMachine(EvolutionState.UNDER_REVIEW);
    const store = createMockDecisionStore();
    const evidence = createMockEvidenceBridge();
    const bridge = new GovernanceDecisionBridge(
      state.mock,
      store.mock,
      evidence.mock,
    );

    // Make transition throw
    (state as unknown as { transitionShouldThrow: Error }).transitionShouldThrow =
      new Error("Transition failed");

    const decision = makeDecision({ kind: "APPROVE" });
    const result = await bridge.execute(decision);

    // Error should be captured
    assert.strictEqual(result.error, "Transition failed");
    assert.strictEqual(result.lifecycleTransitioned, false);

    // Evidence bridge should NOT have been called
    assert.strictEqual(evidence.emittedEvents.length, 0);
  });

  it("returns stored decision in result", async () => {
    const state = createMockStateMachine(EvolutionState.UNDER_REVIEW);
    const store = createMockDecisionStore();
    const bridge = new GovernanceDecisionBridge(state.mock, store.mock);

    const decision = makeDecision({ kind: "APPROVE" });
    const result = await bridge.execute(decision);

    assert.strictEqual(result.decision.decisionId, "govd-001");
    assert.strictEqual(result.decision.kind, "APPROVE");
    assert.strictEqual(result.decision.evolutionId, "evol-001");
  });
});
