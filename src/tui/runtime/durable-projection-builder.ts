import type { ProjectionBuilder } from './projection-builder.js';
import type { ProjectionState } from './projection-state.js';

/**
 * Phase 6.5 — durable projection state. A builder that wants its in-memory
 * projection state persisted alongside the checkpoint cursor implements this
 * (in addition to ProjectionBuilder<TSnapshot>). The collector calls
 * exportState() on save and importState() on load; state must round-trip
 * exactly through exportState -> importState.
 */
export interface DurableProjectionBuilder<TSnapshot> extends ProjectionBuilder<TSnapshot> {
  /** MUST capture ALL mutable state required to restore the builder to the
   *  exact state before update() — the runtime's transactional rollback
   *  depends on exportState/importState round-tripping every internal
   *  field a builder mutates (not just the durable subset). A builder whose
   *  exportState omits internal fields breaks the atomicity guarantee. */
  exportState(): ProjectionState;      // ProjectionState = Record<string, unknown>
  importState(state: ProjectionState): void;
}
