# DOX — ExecutionState Contract, Projector & Store

**Purpose:** Bounded decision-state projection — patch-only contract (EventLog authoritative) + deterministic projector (EventLog → ExecutionState) + durable snapshot store (OCC, atomic, rebuildable).

**Ownership:**
- `execution-state.ts` — ExecutionState (11 keys: executionId/schemaVersion/version/step/objective/status/intent/pendingActions/activeCapabilities/constraints/artifacts), StatePatch (patch-only, null=delete omission=preserve), validation (no arbitrary keys), applyStatePatch, schemaVersion vs version distinction.
- `execution-state-projector.ts` — StateProjector deterministic reducer EVENT TYPE → STATE EFFECT (execution.created→objective, status lifecycle, intent_bound, action proposed/completed→pending, capability bound/unbound, constraint applied/removed, artifact registered/removed), fail-closed ProjectionError/ProjectionUnsupportedError with failedAtRevision, checkpoint historyRevision/historyHash, INV-P1/P2/P7.
- `execution-state-store.ts` — ExecutionStateStore durable snapshot: filesystem `.alix/executions/<id>/state.json` (atomic tmp→fsync→rename), OCC CAS `save(state, expectedVersion)` (1 row commit, 0 → STATE_VERSION_CONFLICT), delete, flat CheckpointedExecutionState persistence (`...ExecutionState, projectionVersion/historyRevision/historyHash/savedAt`), rebuildFromEvents (delete→replay→reconstruct), single-writer POC invariant.
- `state-transition.ts` — alias re-export of canonical harness `src/runtime/state/state-transition.ts` (#627 compatibility).

**Local Contracts:**
- Runtime owns schema — only EXECUTION_STATE_ALLOWED_KEYS accepted; only EXECUTION_STATE_PATCHABLE_KEYS patchable.
- Patch-only semantics: model proposes StatePatch, harness validates then merges (Σ(next)=Σ(current)⊕ΔΣ).
- Explicit null deletion; omission preserves.
- schemaVersion (contract generation, 1.0.0) ≠ version (per-execution monotonic) ≠ projectionVersion (projector generation); historyRevision/historyHash lineage distinct from version.
- Projector: no LLM, O(relevant events) typed dispatch, never mutates history (INV-P2), same history→same state (INV-P1), fail-closed on invalid lifecycle/unsupported type, evidence events ignored but advance historyRevision/historyHash, checkpoint invariant state@47+events48..100==full replay 1..100 (INV-P7).
- Store: EventLog authoritative, state disposable (INV-10); atomic tmp→rename, deterministic JSON, corruption detection (StateCorruptionError), OCC version check (STATE_VERSION_CONFLICT, single-writer POC, no auto-rebase), flat+envelope read compat, rebuild delete→replay equality (INV-P7).
- No prompt/governor logic here — contract + projector + store only (arch doc §6-10, §14-15, §32-35, §41 invariants 4-5,10; resolutions #617-619, #618).

**Verification:**
- `pnpm build && pnpm typecheck` — types compile.
- Manual validation via `validateExecutionState` / `validateStatePatch` / `applyStatePatch` (arbitrary keys rejected, null delete verified).
- `project(history)` / `applyEvent` / `projectFromCheckpoint` deterministic, checkpoint invariant verified (state@47+48..100==full 1..100).
- Store: save/load CAS (commit vs STATE_VERSION_CONFLICT), atomic .tmp→rename, delete idempotent, flat persistence with projectionVersion/historyRevision/historyHash, rebuildFromEvents delete→replay equality and corruption detection.
