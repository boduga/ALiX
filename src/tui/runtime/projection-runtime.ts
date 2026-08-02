import type { AlixEvent } from '../../events/types.js';
import type { ProjectionBuilder } from './projection-builder.js';
import type { DurableProjectionBuilder } from './durable-projection-builder.js';
import type { ProjectionState, ProjectionStateSnapshot } from './projection-state.js';

export interface RegisteredProjection {
  readonly id: string;
  readonly builder: ProjectionBuilder<unknown>;
}

/** Structural durability discriminator (Phase 7 :94). A builder is DURABLE iff
 *  it implements BOTH exportState AND importState — i.e. it can capture and
 *  restore its mutable state for the checkpoint envelope and the transactional
 *  rollback. A plain ProjectionBuilder (neither method) is NON-durable:
 *  omitted from captureState/exportState and never importState'd. A builder
 *  with only one of the two methods is treated as non-durable (the round-trip
 *  is incomplete). */
function isDurable(builder: ProjectionBuilder<unknown>): builder is DurableProjectionBuilder<unknown> {
  return 'exportState' in builder && 'importState' in builder;
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
 * - updateAll is TRANSACTIONAL for DURABLE builders — a throw rolls back every
 *   durable builder (via exportState/importState) and propagates; no partial
 *   durable mutation survives.
 * - Non-durable builders (ProjectionBuilder only — no exportState/importState)
 *   update/reset like durable ones but are OMITTED from the durable envelope:
 *   captureState/exportState never include them and restoreState/importState
 *   never touch them. On an updateAll failure a non-durable builder's partial
 *   mutation is NOT rolled back — this is SAFE because the builder is
 *   idempotent-by-seq (D5): the checkpoint did not advance, the next sample
 *   re-reads from the old cursor, and the builder skips already-applied seqs —
 *   it self-heals. updateAll still throws, so the durable checkpoint never
 *   commits partial state.
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
  // registration order and yields stable RegisteredProjection objects.
  // all() returns a defensive copy so consumers cannot mutate the live array.
  private readonly byId = new Map<string, ProjectionBuilder<unknown>>();
  private readonly registrations: RegisteredProjection[] = [];

  register(id: string, builder: ProjectionBuilder<unknown>): void {
    // Projection ids are canonical: normalize whitespace FIRST so "trace" and
    // " trace " are the same id (operationally surprising otherwise).
    const normalized = id.trim();
    if (!normalized) throw new ProjectionRegistrationError(id, 'id must not be empty');
    if (this.byId.has(normalized)) throw new ProjectionRegistrationError(normalized, 'duplicate id');
    this.byId.set(normalized, builder);
    this.registrations.push({ id: normalized, builder });
  }

  all(): readonly RegisteredProjection[] {
    return [...this.registrations];
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
   *  validates and is a public API; capture is what a rollback needs. Only
   *  DURABLE builders are captured — a non-durable builder is omitted (no
   *  exportState exists), so its partial mutation on a failed updateAll is
   *  intentionally not rolled back (see class doc for why that is safe). */
  private captureState(): ProjectionStateSnapshot {
    // Null-prototype + plain-object guard (same as exportState, but internal).
    const out: Record<string, ProjectionState> = Object.create(null);
    for (const { id, builder } of this.registrations) {
      if (isDurable(builder)) out[id] = assertProjectionState(builder.exportState());
    }
    return out;
  }

  /** Internal restore (also the rollback path). Iterates in registration
   *  order; state for ids not registered is ignored — rolling-upgrade
   *  safety: an older runtime reading a newer checkpoint drops unknown
   *  projections. Only DURABLE builders are restored (non-durable builders
   *  are never importState'd — they have no importState and are not part of
   *  the envelope). Validates the envelope is a plain object (a malicious
   *  checkpoint like `{ "trace": [] }`, `null`, or a class instance such as
   *  `new Date()` is rejected, not trusted). */
  private restoreState(state: ProjectionStateSnapshot): void {
    if (!isPlainProjectionObject(state)) {
      throw new Error('Projection snapshot must be a plain object');
    }
    for (const { id, builder } of this.registrations) {
      const s = state[id];
      if (s !== undefined && isDurable(builder)) builder.importState(s);
    }
  }

  resetAll(): void {
    for (const { builder } of this.registrations) builder.reset();
  }
}

/** Pure tuple factory — the composition root decides what to register.
 *  The helper knows nothing about TimelineBuilder/TraceBuilder/etc. */
export function createProjectionRuntime(
  registrations: ReadonlyArray<readonly [string, ProjectionBuilder<unknown>]>,
): ProjectionRuntime {
  const runtime = new ProjectionRuntime();
  for (const [id, builder] of registrations) runtime.register(id, builder);
  return runtime;
}

/** Defensive boundary: a builder's exportState must produce a plain object
 *  (durable state is JSON-serializable only). A builder returning a primitive,
 *  array, or class instance (e.g. `new Map()`, `new Date()`) would corrupt the
 *  checkpoint envelope — JSON.stringify would silently reduce them to `{}` or
 *  an ISO string and lose state. */
function assertProjectionState(value: unknown): ProjectionState {
  if (!isPlainProjectionObject(value)) {
    throw new Error('Projection state must be a plain object');
  }
  return value as ProjectionState;
}

/** Plain-object check for durable projection state. Accepts both the normal
 *  Object.prototype and null prototypes — exportState builds a null-proto
 *  envelope, and a builder may likewise produce a null-proto state object.
 *  Rejects arrays, class instances (Map/Date/Set), and primitives. */
function isPlainProjectionObject(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
