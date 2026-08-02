import type { ProjectionBuilder } from './projection-builder.js';

/** Serialized form of a durable builder's in-memory projection state. Must be a
 *  JSON-serializable plain object (no Maps/Sets/Dates/undefined) so it can ride
 *  in the checkpoint envelope. */
export type ProjectionState = Record<string, unknown>;

/**
 * Phase 6.5 — durable projection state. A builder that wants its in-memory
 * projection state persisted alongside the checkpoint cursor implements this
 * (in addition to ProjectionBuilder<T>). The collector calls exportState() on
 * save and importState() on load; state must round-trip exactly through
 * exportState -> importState.
 */
export interface DurableProjectionBuilder<T> extends ProjectionBuilder<T> {
  exportState(): ProjectionState;
  importState(state: ProjectionState): void;
}
