// src/runtime-state/contracts/runtime-event.ts
//
// R2 canonical runtime-event envelope — the fact shape every migrated
// domain writes through the transactional ledger. Type-only: the ledger
// mechanics live in src/runtime-state/storage/runtime-ledger.ts.

/** Who acted. Distinct from AuthorizationSource (why it was allowed). */
export type RuntimeActorType = "operator" | "agent" | "policy" | "system";

/**
 * Canonical append-only runtime fact.
 *
 * - `entityVersion` is the version AFTER this event applied (1-based).
 * - `correlationId` groups facts of one logical operation; `causationId`
 *   names the event that caused this one.
 * - Unknown `eventType` values must never disappear silently downstream:
 *   projectors count and report them (R2 exit condition).
 */
export interface RuntimeEvent {
  eventId: string;
  eventType: string;
  schemaVersion: number;

  entityType: string;
  entityId: string;
  entityVersion: number;

  runId?: string;
  sessionId?: string;
  coordinationRunId?: string;
  agentId?: string;
  taskId?: string;

  causationId?: string;
  correlationId: string;

  actor: { type: RuntimeActorType; id: string };

  occurredAt: string;
  recordedAt: string;

  payload: unknown;
}
