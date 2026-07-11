/**
 * A0.3 — Evolution Evidence Bridge.
 *
 * Translates EvolutionTransitionEvent objects produced by A0.2 into
 * standard ExecutionEvidence records (X2 contract) and forwards them
 * through the existing ExecutionEvidenceEmitter (X4.5).
 *
 * A0.3 is a pure translation layer. It performs no persistence,
 * auditing, governance, or lifecycle management.
 *
 * @module evolution-evidence-bridge
 */

import { randomUUID } from "node:crypto";
import { EvolutionState } from "./contracts/evolution-contract.js";
import type { EvolutionTransitionEvent } from "./evolution-state-machine.js";
import type { ExecutionEvidence } from "../runtime/contracts/execution-intent-contract.js";
import type { ExecutionEvidenceEmitter } from "../runtime/contracts/execution-runtime-contract.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVIDENCE_ID_PREFIX = "evoe-";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateEvidenceId(): string {
  return `${EVIDENCE_ID_PREFIX}${randomUUID().slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// 1. Outcome Mapping
// ---------------------------------------------------------------------------

/**
 * Map an EvolutionState to its corresponding ExecutionEvidence outcome.
 *
 * ACTIVE is the only terminal state that maps to SUCCESS.
 * Terminal failure states (REJECTED, WITHDRAWN, ROLLED_BACK,
 * FAILED_VALIDATION) map to FAILED.
 * All intermediate/partial states map to PARTIAL.
 *
 * Unknown future states safely default to PARTIAL for forward compatibility.
 *
 * Pure — no side effects.
 */
export function evolutionStateToOutcome(
  state: EvolutionState | string,
): "SUCCESS" | "FAILED" | "PARTIAL" {
  switch (state) {
    case EvolutionState.ACTIVE:
      return "SUCCESS";
    case EvolutionState.REJECTED:
    case EvolutionState.WITHDRAWN:
    case EvolutionState.ROLLED_BACK:
    case EvolutionState.FAILED_VALIDATION:
      return "FAILED";
    default:
      return "PARTIAL";
  }
}

// ---------------------------------------------------------------------------
// 2. Translation Function
// ---------------------------------------------------------------------------

/**
 * Translate an EvolutionTransitionEvent into an ExecutionEvidence record.
 *
 * Pure function:
 * - Never mutates the supplied event
 * - Always returns a newly constructed ExecutionEvidence
 * - Produces identical output for identical inputs (except when
 *   evidenceId is generated rather than overridden)
 *
 * @param event - The transition event from A0.2 state machine.
 * @param options - Optional overrides (evidenceId for deterministic testing).
 * @returns A new ExecutionEvidence record.
 */
export function evolutionEventToEvidence(
  event: EvolutionTransitionEvent,
  options?: { evidenceId?: string },
): ExecutionEvidence {
  const outcome = evolutionStateToOutcome(event.to);

  return {
    evidenceId: options?.evidenceId ?? generateEvidenceId(),
    intentId: event.evolutionId,
    startedAt: event.timestamp,
    completedAt: event.timestamp,
    outcome,
    summary: event.summary,
    artifacts: [],
    verificationPassed: event.to === EvolutionState.ACTIVE,
    evidenceHash: "",
  };
}

// ---------------------------------------------------------------------------
// 3. Bridge Interface
// ---------------------------------------------------------------------------

/**
 * Bridges evolution lifecycle events into the existing evidence pipeline.
 *
 * Receives an EvolutionTransitionEvent, translates it to ExecutionEvidence,
 * and emits the result through the existing ExecutionEvidenceEmitter.
 *
 * Performs no persistence, auditing, or governance logic.
 */
export class EvolutionEvidenceBridge {
  constructor(private readonly emitter: ExecutionEvidenceEmitter) {}

  /**
   * Translate and emit one evolution transition event.
   *
   * @param event - The transition event from A0.2 state machine.
   */
  emitTransitionEvent(event: EvolutionTransitionEvent): void {
    const evidence = evolutionEventToEvidence(event);
    this.emitter.emit("ExecutionCompleted", evidence);
  }
}
