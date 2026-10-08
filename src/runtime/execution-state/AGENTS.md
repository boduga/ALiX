# DOX — ExecutionState Contract, Projector & Store

## Purpose

Bounded decision-state projection — patch-only contract (EventLog authoritative) + deterministic projector (EventLog → ExecutionState) + durable snapshot store (OCC, atomic, rebuildable).

## Ownership

- `execution-state.ts` — ExecutionState (11 keys: executionId/schemaVersion/version/step/objective/status/intent/pendingActions/activeCapabilities/constraints/artifacts), StatePatch (patch-only, null=delete omission=preserve), validation (no arbitrary keys), applyStatePatch, schemaVersion vs version distinction.
- `execution-state-projector.ts` — StateProjector deterministic reducer EVENT TYPE → STATE EFFECT (execution.created→objective, status lifecycle, intent_bound, action proposed/completed→pending, capability bound/unbound, constraint applied/removed, artifact registered/removed), fail-closed ProjectionError/ProjectionUnsupportedError with failedAtRevision, checkpoint historyRevision/historyHash, INV-P1/P2/P7.
- `execution-state-store.ts` — ExecutionStateStore durable snapshot: filesystem `.alix/executions/<id>/state.json` (atomic tmp→fsync→rename), OCC CAS `save(state, expectedVersion)` (1 row commit, 0 → STATE_VERSION_CONFLICT), delete, flat CheckpointedExecutionState persistence (`...ExecutionState, projectionVersion/historyRevision/historyHash/savedAt`), rebuildFromEvents (delete→replay→reconstruct), single-writer POC invariant.
- `execution-state-emitter.ts` — `ExecutionStateEmitter`: live governed emission of `execution.*` events into the session EventLog. `bootstrap(objective)` appends genesis (`execution.created` + `running`) and rebuilds the snapshot via `rebuildFromEvents`; `setObjective`/`setStatus`/`registerArtifact`/`bindCapability`/`applyConstraint` each run a patch-only `StateTransitionProposal` through the canonical `StateTransitionHarness` (schema → version CAS → patch-only governor → apply → CAS persist → emit). Opt-in via `isExecutionStateEmitEnabled` (`ALIX_EXECUTION_STATE_EMIT=1`, default off) and `executionStateStoreDir` (`ALIX_EXECUTION_STATE_DIR`, default `.alix/executions`); fail-soft (`lastError`, never throws into the task loop).
- `state-transition.ts` — alias re-export of canonical harness `src/runtime/state/state-transition.ts`.
- `execution-ledger-reconcile.ts` — R2.6 read-only comparison of `state.json` snapshots against the transactional ledger (`missing_in_ledger` / `record_mismatch` / `projection_missing` / `version_behind` / `ledger_payload_invalid`); counts unknown event types, reports truncated reads. CLI: `alix runtime reconcile-executions` (exit 1 on drift).

## Local Contracts

- Runtime owns schema — only EXECUTION_STATE_ALLOWED_KEYS accepted; only EXECUTION_STATE_PATCHABLE_KEYS patchable.
- Patch-only semantics: model proposes StatePatch, harness validates then merges (Σ(next)=Σ(current)⊕ΔΣ).
- Explicit null deletion; omission preserves.
- schemaVersion (contract generation, 1.0.0) ≠ version (per-execution monotonic) ≠ projectionVersion (projector generation); historyRevision/historyHash lineage distinct from version.
- Projector: no LLM, O(relevant events) typed dispatch, never mutates history (INV-P2), same history→same state (INV-P1), fail-closed on invalid lifecycle/unsupported type, evidence events ignored but advance historyRevision/historyHash, checkpoint invariant state@47+events48..100==full replay 1..100 (INV-P7).
- Store: EventLog authoritative, state disposable (INV-10); atomic tmp→rename, deterministic JSON, corruption detection (StateCorruptionError), OCC version check (STATE_VERSION_CONFLICT, single-writer POC, no auto-rebase), flat+envelope read compat, rebuild delete→replay equality (INV-P7).
- Emitter: genesis is the only direct EventLog append (the harness cannot create); every later mutation is patch-only through the harness and the governor denies any `action` (tools execute in the task loop). State derived, EventLog authoritative; failures never propagate into the loop.
- Contract, projector, store, and emitter orchestration belong here; prompt building and governor implementations remain in their owning modules.
- **Ledger dual-write (R2.6, strangler).** `ExecutionStateStore.save` and
  `rebuildFromEvents` mirror the committed snapshot to the shared
  transactional ledger (entityType `execution`, events
  `execution.state_created`/`execution.state_saved`, full state payload) —
  JSON authoritative in this phase, mirror failures counted in
  `ledgerStatus()`, never thrown. `stateFilePath` is exported for the
  reconciler.
- **`execution.action_executed` is evidence, not a state patch.** The
  projector accepts it via a non-state execution allowlist: payload must
  carry `kind`; it advances historyRevision/historyHash only (no version
  bump). Unknown `execution.*` types still fail closed.
- **Emitter events are executionId-tagged.** Every harness-emitted payload
  carries `executionId`; bootstrap replay filters positively-tagged events
  for other executions (untagged legacy events are included), so a shared
  session EventLog cannot collide on duplicate `execution.created`.
- **Rebuilds are version-checked (B7).** `rebuildFromEvents` refuses to
  overwrite an existing snapshot whose version is newer than the projected
  state — a replay can never resurrect older history over a newer commit.

## Work Guidance

- Schema or reducer changes must preserve checkpoint replay equality, explicit
  null deletion, and version/OCC distinctions.

## Verification

- `pnpm build && pnpm typecheck` — types compile.
- Manual validation via `validateExecutionState` / `validateStatePatch` / `applyStatePatch` (arbitrary keys rejected, null delete verified).
- `project(history)` / `applyEvent` / `projectFromCheckpoint` deterministic, checkpoint invariant verified (state@47+48..100==full 1..100).
- Store: save/load CAS (commit vs STATE_VERSION_CONFLICT), atomic .tmp→rename, delete idempotent, flat persistence with projectionVersion/historyRevision/historyHash, rebuildFromEvents delete→replay equality and corruption detection.
- `vitest run tests/execution-state-emitter.vitest.ts` — opt-in flag, genesis emits `execution.created`+`running`, idempotent bootstrap, objective/artifact/capability/constraint via harness (events present), fail-soft without genesis, idempotent artifact registration.
- `tests/runtime/execution-ledger-dualwrite.test.ts` — ledger mirrors, reconciliation drift (legacy/tamper), ledger-failure tolerance, `action_executed` evidence projection, unknown-type fail-closed, version-checked rebuild.

## Child DOX Index

None.
