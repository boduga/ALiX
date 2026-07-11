/**
 * X4.5 — Runtime Persistence Integration
 *
 * Routes execution evidence from X4's in-memory emitter to X3b's durable
 * ExecutionEvidenceStore, and provides restart recovery by reconstructing
 * execution states from persisted evidence.
 *
 * @invariant Evidence emission never blocks the runtime
 * @invariant Recovery is best-effort — in-flight executions are reported
 *   but not automatically resumed
 */

import { type ExecutionEvidenceEmitter, type ExecutionEventType, ExecutionState } from "./contracts/execution-runtime-contract.js";
import type { ExecutionEvidence } from "./contracts/execution-intent-contract.js";
import { ExecutionEvidenceStore } from "./execution-evidence-store.js";

// ---------------------------------------------------------------------------
// Persistence Evidence Emitter
// ---------------------------------------------------------------------------

/**
 * Adapter that routes `ExecutionEvidenceEmitter` events to the X3b
 * `ExecutionEvidenceStore` for durable persistence.
 *
 * Emission is non-blocking (fire-and-forget). If the store append fails,
 * the error is logged but not propagated to the emitter caller.
 *
 * Use this emitter when wiring X4 components to production storage:
 *
 * ```ts
 * const store = new ExecutionEvidenceStore("./alix/evidence");
 * const emitter = new PersistenceEvidenceEmitter(store);
 * const machine = new ExecutionStateMachine(emitter);
 * ```
 */
export class PersistenceEvidenceEmitter implements ExecutionEvidenceEmitter {
  constructor(private readonly store: ExecutionEvidenceStore) {}

  emit(_eventType: ExecutionEventType, evidence: ExecutionEvidence): void {
    // Fire-and-forget: non-blocking to avoid stalling the runtime
    this.store.append(evidence).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[PersistenceEvidenceEmitter] failed to persist evidence ${evidence.evidenceId}: ${msg}`,
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Execution State Snapshot
// ---------------------------------------------------------------------------

/**
 * Minimal execution state reconstructed from persisted evidence.
 *
 * Used by recovery to determine which executions completed and which
 * were in-flight when the system last shut down.
 */
export interface ExecutionStateSnapshot {
  /** The execution ID extracted from evidence metadata. */
  executionId: string;
  /** The intent the execution belonged to. */
  intentId: string;
  /** The last known state derived from evidence. */
  state: ExecutionState;
  /** When the execution was created. */
  createdAt: string;
  /** Whether the execution reached a terminal state. */
  isTerminal: boolean;
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

/**
 * Result of a recovery scan.
 */
export interface RecoveryResult {
  /** Total persisted evidence records loaded. */
  totalEvidence: number;
  /** Distinct intents found in the evidence. */
  intents: string[];
  /** Executions that reached a terminal (SUCCEEDED, FAILED, CANCELLED, ROLLED_BACK). */
  completed: ExecutionStateSnapshot[];
  /** Executions that started but did not reach a terminal state. */
  inFlight: ExecutionStateSnapshot[];
  /** Warnings encountered during recovery. */
  warnings: string[];
}

/**
 * Scan persisted evidence and reconstruct execution state.
 *
 * Loads all evidence from the store, groups it by intentId, and
 * derives the last known state for each execution from the most
 * recent evidence record's outcome field.
 *
 * Limitations:
 * - PARTIAL outcome maps to ROLLED_BACK (cannot distinguish from
 *   in-progress with evidence alone)
 * - Execution identity uses evidenceId as proxy (no executionId
 *   recorded in evidence schema)
 *
 * @param store - The X3b ExecutionEvidenceStore to scan.
 * @returns RecoveryResult with completed and in-flight executions.
 */
export async function recoverExecutionState(
  store: ExecutionEvidenceStore,
): Promise<RecoveryResult> {
  const allEvidence = await store.list();
  const warnings: string[] = [];

  // Group evidence by intentId
  const byIntent = new Map<string, ExecutionEvidence[]>();
  for (const evidence of allEvidence) {
    const list = byIntent.get(evidence.intentId) ?? [];
    list.push(evidence);
    byIntent.set(evidence.intentId, list);
  }

  const completed: ExecutionStateSnapshot[] = [];
  const inFlight: ExecutionStateSnapshot[] = [];

  for (const [intentId, records] of byIntent) {
    // Sort by startedAt timestamp
    records.sort((a, b) => a.startedAt.localeCompare(b.startedAt));

    const first = records[0];
    const last = records[records.length - 1];

    // Derive the last known state from outcome
    const { state, isTerminal } = outcomeToExecutionState(last.outcome);

    const snapshot: ExecutionStateSnapshot = {
      executionId: last.evidenceId,
      intentId,
      state,
      createdAt: first.startedAt,
      isTerminal,
    };

    if (isTerminal) {
      completed.push(snapshot);
    } else {
      // Non-terminal outcome on persisted evidence indicates the
      // execution was in-flight when shutdown occurred
      warnings.push(
        `Execution for intent ${intentId} did not reach terminal state — last outcome: ${last.outcome}`,
      );
      inFlight.push(snapshot);
    }
  }

  return {
    totalEvidence: allEvidence.length,
    intents: Array.from(byIntent.keys()),
    completed,
    inFlight,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Map an ExecutionEvidence outcome to the closest ExecutionState.
 *
 * This is a best-effort mapping since evidence outcomes are
 * coarser-grained than state machine states.
 */
function outcomeToExecutionState(
  outcome: "SUCCESS" | "FAILED" | "PARTIAL",
): { state: ExecutionState; isTerminal: boolean } {
  switch (outcome) {
    case "SUCCESS":
      return { state: ExecutionState.SUCCEEDED, isTerminal: true };
    case "FAILED":
      return { state: ExecutionState.FAILED, isTerminal: true };
    case "PARTIAL":
      return { state: ExecutionState.ROLLED_BACK, isTerminal: true };
  }
}
