import type { AlixEvent } from '../../events/types.js';

/** Generic projection builder contract. Each builder owns its own
 *  reconciliation semantics (D4); the contract only defines the lifecycle
 *  hooks the collector orchestrates. Builders MUST NOT depend on the outputs
 *  of other builders (D11) — every projection is derived directly from
 *  the EventLog batch. */
export interface ProjectionBuilder<T> {
  /** Reconcile the events into the builder's in-memory projection state.
   *  Idempotent by event identity (typically event.seq) — replay-safe. */
  update(events: readonly AlixEvent[]): void;
  /** Produce the current snapshot as a fresh immutable list. */
  snapshot(): readonly T[];
  /** Wipe the in-memory projection state. Called by the collector on
   *  beyond-head fallback / corruption recovery / hot reload. */
  reset(): void;
}
