# ExecutionState Contract, Projector & Store

## Overview
Bounded, patch-only decision state derived from the authoritative EventLog. This package owns four layers: the `ExecutionState` schema and its validation (`execution-state.ts`), a deterministic reducer from `execution.*` events to state (`execution-state-projector.ts`), a durable snapshot store with optimistic concurrency whose authority is the shared runtime ledger and whose file is a compatibility projection (`execution-state-store.ts`), and a live, opt-in emitter that drives governed transition proposals (`execution-state-emitter.ts`). A read-only reconciler compares snapshots against the ledger (`execution-ledger-reconcile.ts`).

## Interface
- `ExecutionState`, `ExecutionStatus`, `StatePatch`, `EXECUTION_STATE_SCHEMA_VERSION`, `EXECUTION_STATE_ALLOWED_KEYS`, `EXECUTION_STATE_PATCHABLE_KEYS` [execution-state.ts:EXECUTION_STATE_ALLOWED_KEYS]
- `validateExecutionState(input)` / `validateStatePatch(input)` / `applyStatePatch(state, patch)` / `isCurrentSchemaVersion(v)` [execution-state.ts:applyStatePatch]
- `project(events)` / `applyEvent(state, event)` / `projectFromCheckpoint(checkpoint, events)` / `toExecutionState(checkpointed)` [execution-state-projector.ts:project]
- `EXECUTION_EVENT_TYPES`, `isStateAffectingEventType(type)`, `hashStep(prevHash, event)`, `computeHistoryHash(events)`, `INITIAL_HISTORY_HASH` [execution-state-projector.ts:EXECUTION_EVENT_TYPES]
- `ProjectionError`, `ProjectionUnsupportedError`, `CheckpointedExecutionState`, `ProjectorEvent` [execution-state-projector.ts:ProjectionError]
- `ExecutionStateStore` — `loadSnapshot`/`load`/`exists`/`save`/`delete`/`rebuildFromEvents`/`ledgerStatus` [execution-state-store.ts:ExecutionStateStore]
- `stateFilePath(baseDir, executionId)`, `StateSnapshot`, `FlatPersistedState`, `SaveOptions`, `SaveResult`, `DEFAULT_PROJECTION_VERSION` [execution-state-store.ts:stateFilePath]
- `StateVersionConflictError`, `StateCorruptionError`, `STATE_VERSION_CONFLICT`, `STATE_CORRUPTION` [execution-state-store.ts:StateVersionConflictError]
- `ExecutionStateEmitter` — `bootstrap`/`getState`/`proposePatch`/`setObjective`/`setStatus`/`registerArtifact`/`bindCapability`/`applyConstraint`/`lastError` [execution-state-emitter.ts:ExecutionStateEmitter]
- `isExecutionStateEmitEnabled(env)` / `isExecutionStateSendEnabled(env)` / `executionStateStoreDir(env)` / `ExecutionStateEmitterOptions` [execution-state-emitter.ts:isExecutionStateEmitEnabled]
- `reconcileExecutionLedger(storeDir?, ledgerCwd?)`, `ExecutionReconcileIssueKind`, `ExecutionReconcileReport` [execution-ledger-reconcile.ts:reconcileExecutionLedger]
- `state-transition.ts` re-exports the canonical harness from `../state/state-transition.js` [state-transition.ts]

## Invariants
- Patch-only mutation: only `EXECUTION_STATE_PATCHABLE_KEYS` are accepted; an allowed-but-runtime-owned key is rejected as "runtime-owned and not patchable", any other key as "unknown key" [execution-state.ts:validateStatePatch]
- `applyStatePatch` semantics are omission = preserve, `null` = delete, non-null = replace; it neither mutates inputs nor bumps `version`/`step` (the harness owns versioning) [execution-state.ts:applyStatePatch]
- A `null` delete of a required field can produce an invalid state; the helper does not fabricate defaults and callers must re-validate before persisting [execution-state.ts:applyStatePatch]
- `schemaVersion` (contract generation), `version` (per-execution monotonic counter), and `projectionVersion` (projector generation) are distinct values [execution-state.ts:EXECUTION_STATE_SCHEMA_VERSION]
- `project` copies before sorting and never mutates input events or payloads (INV-P2); identical history yields identical state (INV-P1) [execution-state-projector.ts:project]
- Replay fails closed: history must begin with `execution.created`, unknown `execution.*` types throw `ProjectionUnsupportedError`, and errors carry `failedAtRevision`/`eventId` [execution-state-projector.ts:applyEvent]
- Status transitions follow a fixed lifecycle table; terminal statuses (`completed`/`failed`/`cancelled`) have no outgoing transitions, and `from === to` is idempotent [execution-state-projector.ts:EXECUTION_EVENT_TYPES]
- `execution.action_executed` is evidence, not a state patch: its payload must name `kind` and it advances only `historyRevision`/`historyHash` (no version bump); other non-execution evidence advances the checkpoint hash and leaves state untouched [execution-state-projector.ts:applyEvent]
- `projectFromCheckpoint` skips events whose `seq` is at or below the checkpoint's `historyRevision`, making incremental apply idempotent (INV-P7) [execution-state-projector.ts:projectFromCheckpoint]
- The ledger append IS the commit: `save` and `rebuildFromEvents` append the flat envelope before the file write and throw on append failure, so no JSON-only state can exist [execution-state-store.ts:ExecutionStateStore]
- Projection write failure after a committed append is tolerated and counted in `ledgerStatus().projectionFailures`; the ledger remains the truth [execution-state-store.ts:ledgerStatus]
- `loadSnapshot` reads the ledger first and consults `state.json` only for legacy executions with zero ledger facts; ledger DB errors are counted and rethrown, never masked by the file fallback [execution-state-store.ts:loadSnapshot]
- `save` enforces CAS: create requires `expectedVersion === null` and `version === 0`; update requires an exact current-version match and `version === expectedVersion + 1`, else `StateVersionConflictError` with no file mutation [execution-state-store.ts:ExecutionStateStore]
- `save` rejects any state whose `schemaVersion` differs from `EXECUTION_STATE_SCHEMA_VERSION` before touching disk [execution-state-store.ts:ExecutionStateStore]
- `rebuildFromEvents` refuses to overwrite an existing snapshot whose version is newer than the projected state (B7) [execution-state-store.ts:rebuildFromEvents]
- `delete` removes only the projection file (and an empty directory, best effort); ledger authority facts persist, so `load()` still returns state after a delete, while `exists()` is the file-level check [execution-state-store.ts:delete]
- Ledger root derivation strips the canonical `.alix/executions` suffix to get the workspace root, but treats any custom directory as its own root so sibling dirs never share a ledger [execution-state-store.ts:ExecutionStateStore]
- Genesis is the single allowed direct EventLog append; every later mutation is a patch-only proposal through `StateTransitionHarness`, and the bootstrap is idempotent and rejects empty `executionId`/`objective` [execution-state-emitter.ts:bootstrap]
- Every harness-emitted payload is tagged with `executionId`, and bootstrap replay filters to this execution's facts, so a shared session EventLog cannot collide on duplicate `execution.created` [execution-state-emitter.ts:ExecutionStateEmitter]
- The emitter is fail-soft: failures are recorded in `lastError` and returned as non-committed results, never thrown into the task loop [execution-state-emitter.ts:proposePatch]
- The emitter is opt-in via `ALIX_EXECUTION_STATE_EMIT` (`1`/`true`, default off); `ALIX_EXECUTION_STATE_SEND` requires emit to be enabled first, and the store dir defaults to `.alix/executions` or `ALIX_EXECUTION_STATE_DIR` [execution-state-emitter.ts:isExecutionStateSendEnabled]
- The reconciler never writes: it classifies `missing_in_ledger`/`record_mismatch`/`projection_missing`/`version_behind`/`ledger_payload_invalid`, counts unknown event types, and reports truncated ledger reads [execution-ledger-reconcile.ts:reconcileExecutionLedger]

## Side Effects
- Appends `execution.state_created` / `execution.state_saved` facts to the shared transactional ledger at `<root>/.alix/runtime-ledger.db`; append failure is counted and thrown [execution-state-store.ts:ExecutionStateStore]
- Writes `<baseDir>/<executionId>/state.json` via atomic tmp→fsync→rename after a committed ledger append; failure is tolerated and counted [execution-state-store.ts:ExecutionStateStore]
- Deletes the projection file and best-effort removes its now-empty directory [execution-state-store.ts:delete]
- Appends `execution.created` and `execution.status_changed` to the session EventLog during `bootstrap`, then replays and rebuilds the snapshot [execution-state-emitter.ts:bootstrap]
- Appends harness-emitted `execution.*` events (tagged with `executionId`) to the session EventLog for every committed proposal [execution-state-emitter.ts:ExecutionStateEmitter]
- Reads EventLog history (`readAll`), snapshot files, and ledger events; the reconciler is read-only over both the store dir and the ledger [execution-ledger-reconcile.ts:reconcileExecutionLedger]
- Reads `ALIX_EXECUTION_STATE_EMIT`, `ALIX_EXECUTION_STATE_SEND`, and `ALIX_EXECUTION_STATE_DIR` from the process environment [execution-state-emitter.ts:executionStateStoreDir]
- Pure helpers (`validateExecutionState`, `validateStatePatch`, `applyStatePatch`, `project`, `applyEvent`, `hashStep`, `computeHistoryHash`) perform no I/O [execution-state.ts:applyStatePatch]

## Verification
- Run: `pnpm test`
- Relevant tests: `tests/execution-state-emitter.vitest.ts`, `tests/runtime/execution-ledger-dualwrite.test.ts`
