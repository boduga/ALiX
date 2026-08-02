import type { AlixEvent } from '../../events/types.js';
import type { DurableProjectionBuilder } from './durable-projection-builder.js';
import type { ProjectionState, ProjectionStateSnapshot } from './projection-state.js';

export interface RegisteredProjection {
  readonly id: string;
  readonly builder: DurableProjectionBuilder<unknown>;
}

export class ProjectionRegistrationError extends Error {
  constructor(id: string, reason = 'already registered') {
    super(`Projection registration failed for "${id}": ${reason}`);
    this.name = 'ProjectionRegistrationError';
  }
}

/** Update + rollback BOTH failed — preserves both errors. A durable-state
 *  correctness boundary: the runtime cannot claim a rolled-back batch when
 *  the restore itself threw. */
export class ProjectionRollbackError extends Error {
  constructor(
    public readonly updateError: unknown,
    public readonly rollbackError: unknown,
  ) {
    // Both original errors are preserved as properties (updateError,
    // rollbackError) — the message stays stable and the caller can inspect
    // the causes without the stack being flattened.
    super('Projection rollback failed after projection update failure');
    this.name = 'ProjectionRollbackError';
  }
}

/**
 * Owns the projection lifecycle: registration, deterministic dispatch,
 * snapshot extraction, durable builder state, and reset coordination.
 *
 * Invariants (Phase 7 spec):
 * - updateAll is TRANSACTIONAL — a throw rolls back every builder (via
 *   exportState/importState) and propagates; no partial mutation survives.
 * - Builders receive events in EventLog sequence order; execution order is
 *   not semantic (D11 — each derives only from the EventLog batch).
 * - The runtime never interprets a builder's state; it only carries
 *   ProjectionState = Record<string, unknown> through the envelope.
 * - snapshot() supports ANY snapshot shape (array or object); unregistered
 *   ids return undefined. Caller owns type agreement with the registered id —
 *   the heterogeneous registry cannot verify T matches the builder.
 */
export class ProjectionRuntime {
  // Map for O(1) duplicate + snapshot lookup; the array preserves explicit
  // registration order and yields stable RegisteredProjection objects (no
  // allocation per all() call — this runs every sample cycle).
  private readonly byId = new Map<string, DurableProjectionBuilder<unknown>>();
  private readonly registrations: RegisteredProjection[] = [];

  register(id: string, builder: DurableProjectionBuilder<unknown>): void {
    // Projection ids are canonical: normalize whitespace FIRST so "trace" and
    // " trace " are the same id (operationally surprising otherwise).
    const normalized = id.trim();
    if (!normalized) throw new ProjectionRegistrationError(id, 'id must not be empty');
    if (this.byId.has(normalized)) throw new ProjectionRegistrationError(normalized, 'duplicate id');
    this.byId.set(normalized, builder);
    this.registrations.push({ id: normalized, builder });
  }

  all(): readonly RegisteredProjection[] {
    return this.registrations;
  }

  /** Transactional batch update. A builder throw rolls back every projection
   *  (in registration order) and propagates — the checkpoint must never
   *  commit partial state. A rollback failure surfaces as a typed
   *  ProjectionRollbackError carrying BOTH the update and rollback errors. */
  updateAll(events: readonly AlixEvent[]): void {
    const before = this.captureState();
    try {
      for (const { builder } of this.registrations) builder.update(events);
    } catch (err) {
      try {
        this.restoreState(before);
      } catch (rollbackErr) {
        throw new ProjectionRollbackError(err, rollbackErr);
      }
      throw err;
    }
  }

  snapshotOf<TSnapshot>(id: string): TSnapshot | undefined {
    // Normalize like register — 'trace' and ' trace ' resolve the same id.
    return this.byId.get(id.trim())?.snapshot() as TSnapshot | undefined;
  }

  exportState(): ProjectionStateSnapshot {
    return this.captureState();
  }

  importState(state: ProjectionStateSnapshot): void {
    this.restoreState(state);
  }

  /** Internal capture for the transactional rollback — an internal transaction
   *  primitive, NOT the public durability boundary (exportState). exportState
   *  validates and is a public API; capture is what a rollback needs. */
  private captureState(): ProjectionStateSnapshot {
    // Null-prototype + plain-object guard (same as exportState, but internal).
    const out: Record<string, ProjectionState> = Object.create(null);
    for (const { id, builder } of this.registrations) out[id] = assertProjectionState(builder.exportState());
    return out;
  }

  /** Internal restore (also the rollback path). Iterates in registration
   *  order; state for ids not registered is ignored — rolling-upgrade
   *  safety: an older runtime reading a newer checkpoint drops unknown
   *  projections. Validates the envelope is a plain object (a malicious
   *  checkpoint like `{ "trace": [] }` or `null` is rejected, not trusted). */
  private restoreState(state: ProjectionStateSnapshot): void {
    if (typeof state !== 'object' || state === null || Array.isArray(state)) {
      throw new Error('Projection snapshot must be a plain object');
    }
    for (const { id, builder } of this.registrations) {
      const s = state[id];
      if (s !== undefined) builder.importState(s);
    }
  }

  resetAll(): void {
    for (const { builder } of this.registrations) builder.reset();
  }
}

/** Pure tuple factory — the composition root decides what to register.
 *  The helper knows nothing about TimelineBuilder/TraceBuilder/etc. */
export function createProjectionRuntime(
  registrations: ReadonlyArray<readonly [string, DurableProjectionBuilder<unknown>]>,
): ProjectionRuntime {
  const runtime = new ProjectionRuntime();
  for (const [id, builder] of registrations) runtime.register(id, builder);
  return runtime;
}

/** Defensive boundary: a builder's exportState must produce a plain object
 *  (durable state is JSON-serializable only). A builder returning a primitive
 *  or array would corrupt the checkpoint envelope. */
function assertProjectionState(value: unknown): ProjectionState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Projection state must be a plain object');
  }
  return value as ProjectionState;
}
