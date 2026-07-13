// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A3 — Governance Decision Bridge.
 *
 * Bridges governance decisions into the evolution lifecycle. Persists the
 * decision first (append-first invariant), then transitions the evolution
 * lifecycle state if the target state differs from the current state.
 *
 * @module governance-decision-bridge
 */

import type { GovernanceDecision } from "./contracts/decision-contract.js";
import type { GovernanceDecisionStore } from "./contracts/decision-store-contract.js";
import { decisionKindToTargetState } from "./decision-engine.js";
import type {
  EvolutionStateMachine,
  EvolutionTransitionResult,
} from "../../evolution/evolution-state-machine.js";
import type { EvolutionEvidenceBridge } from "../../evolution/evolution-evidence-bridge.js";
import { EvolutionState } from "../../evolution/contracts/evolution-contract.js";

// ---------------------------------------------------------------------------
// GovernanceDecisionBridgeResult
// ---------------------------------------------------------------------------

/**
 * Result of executing a governance decision through the bridge.
 *
 * @property decision - The stored governance decision.
 * @property lifecycleTransitioned - Whether the evolution lifecycle transitioned.
 * @property transition - The transition result, if a transition occurred.
 * @property error - Error message if the transition failed.
 */
export interface GovernanceDecisionBridgeResult {
  decision: GovernanceDecision;
  lifecycleTransitioned: boolean;
  transition?: EvolutionTransitionResult;
  error?: string;
}

// ---------------------------------------------------------------------------
// GovernanceDecisionBridge
// ---------------------------------------------------------------------------

/**
 * Bridges governance decisions into the evolution lifecycle.
 *
 * Flow:
 * 1. Persist the decision via decisionStore.store() (append-first).
 * 2. Map decision kind to target evolution state.
 * 3. If target state differs from current state → transition.
 * 4. If transition succeeded and evidenceBridge is present → emit event.
 * 5. Return result with transition details.
 */
export class GovernanceDecisionBridge {
  constructor(
    private readonly stateMachine: EvolutionStateMachine,
    private readonly decisionStore: GovernanceDecisionStore,
    private readonly evidenceBridge?: EvolutionEvidenceBridge,
  ) {}

  /**
   * Execute a governance decision through the bridge.
   *
   * Persists the decision, transitions the evolution lifecycle if needed,
   * and optionally emits an evidence event.
   *
   * @param decision - The governance decision to execute.
   * @returns Bridge result with transition and error details.
   */
  async execute(
    decision: GovernanceDecision,
  ): Promise<GovernanceDecisionBridgeResult> {
    // Step 1: Persist decision first (append-first invariant)
    const stored = await this.decisionStore.store(decision);

    // Step 2: Map decision kind to target evolution state (pure, no I/O)
    const targetState = decisionKindToTargetState(decision.kind);
    const targetEvolutionState = this.toEvolutionState(targetState);

    // Step 3: Attempt transition (getStatus + transition inside try-catch)
    let transitionResult: EvolutionTransitionResult | undefined;
    let error: string | undefined;
    let lifecycleTransitioned = false;

    try {
      const currentState = this.stateMachine.getStatus(decision.evolutionId);
      if (targetEvolutionState !== currentState) {
        transitionResult = this.stateMachine.transition(
          decision.evolutionId,
          targetEvolutionState,
        );
        lifecycleTransitioned = true;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    // Step 4: Emit evidence event if bridge available and transition succeeded
    if (transitionResult && this.evidenceBridge) {
      try {
        this.evidenceBridge.emitTransitionEvent(transitionResult.event);
      } catch {
        // Non-fatal: emission failure does not roll back the transition
      }
    }

    return {
      decision: stored,
      lifecycleTransitioned,
      transition: transitionResult,
      error,
    };
  }

  /**
   * Map a decision target state string to an EvolutionState enum value.
   */
  private toEvolutionState(
    target: "APPROVED" | "REJECTED" | "UNDER_REVIEW",
  ): EvolutionState {
    switch (target) {
      case "APPROVED":
        return EvolutionState.APPROVED;
      case "REJECTED":
        return EvolutionState.REJECTED;
      case "UNDER_REVIEW":
        return EvolutionState.UNDER_REVIEW;
    }
  }
}
