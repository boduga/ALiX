# ALiX Capability Platform — Phase 7 Design (Projection Platform)

**Status:** Approved 2026-08-02
**Branch:** `feat/capability-phase7`
**Relates to:** Phase 6 spec (`docs/superpowers/specs/2026-07-31-capability-platform-phase6-design.md`) `## Future Direction` — projection registry + additional projections; frozen architecture (`docs/architecture/eventlog-projection-architecture.md`).

## Goal

Replace "collector knows its builders" with "collector hosts registered projections."

> **Adding a fourth projection must require only implementing a `ProjectionBuilder`, registering it, and consuming its snapshot — without modifying the collector's orchestration logic.**

## Scope

In scope (landed C-style):

1. `ProjectionRuntime` — a single object owning registration, generic dispatch, snapshot extraction, durable builder state, and reset coordination.
2. Migrate the two existing builders (timeline, trace) onto it with **byte-for-byte behavior equivalence**.
3. Make the durable-state envelope keying registry-driven.
4. Add `ApprovalProjection` as the first registry-native projection, consumed registry-only (no snapshot/view changes).

Explicitly out of scope (later phases): capability projection, metrics projection, workflow projection, cross-projection dashboards, replay tooling, web UI, and the `ProjectionDispatcher` / `ProjectionCheckpointManager` / `SnapshotAssembler` decomposition.

## Architecture

```
                EventLog
                   |
                   v
         RuntimeCollectorImpl
                   |
                   v
          ProjectionRuntime
                   |
        +----------+-----------+
        |          |           |
   TimelineBuilder  TraceBuilder  ApprovalBuilder
```

### Responsibility split

**`RuntimeCollectorImpl` owns time:**
- polling interval
- EventLog access (`readSince`)
- cursor progression
- session filtering
- workflow accounting
- snapshot publication

**`ProjectionRuntime` owns projection lifecycle:**
- registered projections
- update dispatch
- snapshot extraction
- durable builder state (export/import)
- reset/recovery coordination

### Naming

One object: **`ProjectionRuntime`**. Do **not** split into `ProjectionRuntime` / `ProjectionDispatcher` / `ProjectionCheckpointManager` / `SnapshotAssembler` — that decomposition is architecturally clean but introduces abstractions before the system has earned them. The current responsibility boundary is the right altitude.

## The `ProjectionRuntime` contract (freeze BEFORE touching the collector)

```ts
interface ProjectionRuntime {
  register(id: string, builder: DurableProjectionBuilder<unknown>): void;
  all(): readonly RegisteredProjection[];
  updateAll(events: readonly AlixEvent[]): void;
  /** Returns the projection's snapshot (array or object) or `undefined` if the
   *  id is not registered. The generic param is the snapshot shape. */
  snapshot<TSnapshot>(id: string): TSnapshot | undefined;
  exportState(): ProjectionStateSnapshot;
  importState(state: ProjectionStateSnapshot): void;
  resetAll(): void;
}
```

- `register` with a duplicate id → throws a **typed `ProjectionRegistrationError`** (ids are the durable-state keys; ambiguity is corruption). This is a configuration-corruption condition, not a runtime failure.
- **Dispatch order MUST be deterministic and must not affect output.** Registration order is preserved for update/export/import iteration, but projections MUST NOT depend on execution order or on other projections (D11 — builders derive only from the EventLog batch). A future contributor must not be able to create an ordering dependency.

  ```
  EventLog batch
     ├── TimelineBuilder
     ├── TraceBuilder
     └── ApprovalBuilder
  ```
  Never:
  ```
  TimelineBuilder → TraceBuilder  (producer/consumer chain)
  ```

- The collector MUST never call `runtime.get("trace")` / `runtime.get("timeline")` during update/reset/export paths. **The only place projection ids appear is the snapshot-assembler boundary** (building `RuntimeSnapshot`), where the collector reads specific typed fields.
- **Each registered builder MAY implement `DurableProjectionBuilder<T>`.** If it does, its opaque state participates in export/import (durable). If it does not, it remains **replay-derived only** — `exportState()` omits it and checkpoint persistence never depends on non-durable builders. This keeps the abstraction open for future replay-derived projections (e.g. metrics). Timeline, trace, and approval are all durable; a hypothetical metrics projection might be replay-derived.
- **Projection batch atomicity (failure isolation + rollback):** `ProjectionRuntime.updateAll()` is **transactional** — the runtime enforces the invariant itself, not just the collector's save ordering:

  ```ts
  updateAll(events) {
    const before = this.exportState();
    try {
      for (const projection of this.projections.values()) projection.update(events);
    } catch (err) {
      this.importState(before);   // rollback: no projection keeps partial mutation
      throw err;                   // never swallow — the collector's catch is reachable
    }
  }
  ```

  If any projection throws during `updateAll`, the update cycle fails, the checkpoint MUST NOT commit, AND the in-memory projection state is **rolled back** so no builder retains a partially-advanced state (a later successful sample must not commit corrupted state). Builders are idempotent by seq, so a clean re-read from the old cursor reconciles. This makes the runtime the single owner of the atomicity invariant.

## ProjectionRuntime invariants (final)

1. **`updateAll` is transactional** — all-or-nothing across registered projections; a throw rolls back every builder and propagates.
2. **Builders receive events in EventLog sequence order.** A builder's `update()` is a pure function of its input events; deterministic replay requires deterministic ordering. A builder MAY enforce this defensively (throw if `seq` is non-monotonic) but MUST NOT reorder.
3. **Builder execution order is not semantic.** Registration order is preserved for iteration but must never affect output (D11).
4. **A projection cannot depend on another projection's state.** Each builder derives only from the EventLog batch (D11).
5. **`snapshot<T>(id)` typing is caller-owned.** The runtime is a heterogeneous registry; it cannot verify that `T` matches the registered builder. The caller owns type agreement with the registered id (documented on the method).

## Frozen projection contract (generalized snapshot shape)

Before the registry migration, generalize the projection contract so the snapshot shape is arbitrary — NOT restricted to arrays. The pre-Phase-7 contract (`snapshot(): readonly T[]`) accidentally encoded the first two projections (timeline, trace both return arrays); approval's `{ pending, completed }` snapshot would not fit. This is an additive generalization of the Phase-6 frozen contract: existing array-returning builders are unchanged at the call sites.

```ts
/** TSnapshot is the projection's snapshot shape — an array (timeline/trace) or
 *  any object (approval). The contract no longer assumes a list. */
interface ProjectionBuilder<TSnapshot> {
  update(events: readonly AlixEvent[]): void;
  snapshot(): TSnapshot;
  reset(): void;
}

interface DurableProjectionBuilder<TSnapshot>
  extends ProjectionBuilder<TSnapshot> {
  exportState(): ProjectionState;
  importState(state: ProjectionState): void;
}
```

Type bindings after generalization:
- `TimelineBuilder implements DurableProjectionBuilder<readonly TimelineEntry[]>`
- `IncrementalExecutionTraceBuilder implements DurableProjectionBuilder<readonly ExecutionTraceEntry[]>`
- `ApprovalProjection implements DurableProjectionBuilder<ApprovalProjectionSnapshot>`

Constraints:
- `ProjectionState` (`Record<string, unknown>`) in/out — the runtime validates serializability; no builder leaks class instances into checkpoint state.
- The checkpoint layer MUST never know builder-specific state types (`ApprovalProjectionSnapshot`, `TraceState`, `TimelineState`) — only `Record<string, unknown>` / the opaque envelope.
- Deterministic replay: a builder's `update()` MUST be a pure function of its input events — `Date.now()`/`Math.random()` in an update path breaks replay (same log must produce same state). Event timestamps are parsed strictly; a malformed timestamp throws rather than falling back to `Date.now()`.

**State types live in their own module** — `src/tui/runtime/projection-state.ts` — to avoid a layering inversion. `ProjectionRuntime` currently imports `ProjectionStateSnapshot` from `projection-checkpoint-store.ts`, which inverts the intended dependency:

```
bad:                          good:
ProjectionRuntime              ProjectionCheckpointStore   ProjectionRuntime
   |                                  \                        /
   v                                   v----------------------v
ProjectionCheckpointStore              ProjectionState (projection-state.ts)
```

Move `ProjectionState` and `ProjectionStateSnapshot` into `src/tui/runtime/projection-state.ts`; both `projection-runtime.ts` and `projection-checkpoint-store.ts` import from it. (Same for the phase-6.5 `ProjectionStateSnapshot` type currently defined in the checkpoint store.)

## Snapshot contract

```ts
interface RuntimeSnapshot {
  trace: readonly ExecutionTraceEntry[];
  timeline: readonly TimelineEntry[];
  workflow: WorkflowStateSnapshot | null;
  totalEventCount: number;
  lastEventAt: number | null;
  sessionId: string;
  projections?: Readonly<Record<string, unknown>>; // extension boundary only
}
```

- The **typed fields are the public API**. `runtime-view.ts` keeps reading `r.trace` untouched.
- `projections?` is **NOT a supported consumer API** — it exists only as an extension boundary for future experimental projections. Consumers MUST NOT read `snapshot.projections["foo"]`; the typed fields are the contract. The type MUST carry this documentation inline:

  ```ts
  /**
   * Experimental extension boundary only.
   * Runtime consumers MUST NOT depend on keys here.
   * Typed snapshot fields are the supported API.
   */
  readonly projections?: Readonly<Record<string, unknown>>;
  ```

- When a projection isn't registered (e.g. the outer runtime collector doesn't register timeline), its typed field is `[]`.

**ApprovalProjection does NOT add a `RuntimeSnapshot` field in Phase 7.** The TUI snapshot already carries an `approvals: ApprovalSnapshot | null` field (snapshot.ts:15) fed by the live `ApprovalManager` (approvals-view.ts consumes it). Introducing a parallel `approvals`/`approvalProjection` field now would create a second approval-truth surface and force a premature "which approval state is authoritative" decision. That reconciliation is its own phase. The projection's snapshot is produced by `ProjectionRuntime.snapshot("approval")` and consumed by tests; the UI continues to use the existing `ApprovalManager` surface.

## Checkpoint model (load-bearing — recorded)

Keep **one checkpoint file per collector** (`projections/<role>/projection-checkpoint.json`), with the durable-state envelope keyed **per-builder by registered id**:

```ts
// today (hard-coded)                    // registry-driven
{ cursor, committedAt, state: {          { cursor, committedAt,
    timeline: {...}, trace: {...}            projections: {
  }                                            timeline: {...},
                                             }
                                           }
```

Do **not** move to per-builder cursor files (`trace-checkpoint.json`, etc.).

**Why:** the cursor is a property of the **projection-runtime consumption boundary**, not individual builders. All registered builders advance together over one shared readSince position (the Phase 6 D5 co-advancement invariant). Per-builder cursors would introduce a new, more complex recovery model that contradicts co-advancement. The invariant:

```
EventLog position N
   ├── Timeline projection at N
   ├── Trace projection at N
   └── Approval projection at N
```

The registry changes *who receives the events*, not *how the event stream advances*. This preserves the Phase 6 recovery guarantee: **a checkpoint represents a coherent published projection state.** One projection = one checkpoint remains enforced (the checkpoint holds each projection's durable state).

**`ProjectionStateSnapshot` boundary (documented on the type):**

```ts
/**
 * The projection-state portion of the checkpoint envelope ONLY.
 * Cursor and commit metadata belong to ProjectionCheckpointStore /
 * PersistedProjectionCheckpoint. A consumer of
 * ProjectionRuntime.exportState() gets projection state, never a full
 * checkpoint envelope.
 */
export type ProjectionStateSnapshot = Record<string, ProjectionState>;
```

This prevents a future contributor from assuming `ProjectionRuntime.exportState()` returns the complete checkpoint envelope.

**Version-1 dual-shape doc (on `PersistedProjectionCheckpoint`):**

```ts
/**
 * Version 1 contains two historical shapes:
 *   Phase 6.5: state: { timeline?, trace? }        (read-only legacy)
 *   Phase 7:   projections: { <id>: ProjectionState }  (always written)
 * load() accepts BOTH; save() always writes `projections`.
 */
```
Keep the `state` field permanently — a future contributor must not "clean up" it as dead while any 6.5-era checkpoint file may still exist.

## ApprovalProjection

- **Host:** the runtime collector (outer sessionId) — approval events are stamped with the outer sessionId (`src/policy/approvals.ts:44`), so it projects alongside the trace. Independent of `buildTimeline`.
- **Events consumed:** `approval.requested` / `approval.resolved` / `approval.expired` / `approval.consumed` / `approval.revoked` / `approval.resumed` (already defined in `src/events/types.ts`).
- **Semantics:** **state machine / active-state** — a third distinct projection style alongside append-only (timeline) and lifecycle-reconciliation (trace).

  ```ts
  interface ApprovalProjectionEntry {
    approvalId: string;                              // identity
    status: 'pending' | 'approved' | 'denied' | 'edited'
          | 'expired' | 'revoked' | 'consumed' | 'resumed';
    prompt?: string;
    toolName?: string;
    requestedAt: number;
    completedAt?: number;                            // set on terminal
  }

  interface ApprovalProjectionSnapshot {
    pending: readonly ApprovalProjectionEntry[];     // unresolved
    completed: readonly ApprovalProjectionEntry[];   // last N resolved events
  }
  ```

  `completed` is bounded by a deterministic cap (`MAX_COMPLETED = 50`) — NOT a time window. A time window introduces clock/replay problems; a bounded count is deterministic and replay-safe.

  **Identity & reconciliation rules (deterministic):** an approval's identity is its `approvalId` (generated by `generateApprovalId()`). The projection reconciles with these explicit rules, so `requested(A) → resolved(A) → requested(A)` has a deterministic answer:
  - `approval.requested(id)` — if no **pending** entry exists for `id`, create a pending entry (new lifecycle). If a pending entry already exists (idempotent replay of the same request), leave it unchanged. If a **completed** entry exists with the same `id`, that is a **new lifecycle** — create a fresh pending entry; the older completed entry stays in `completed`.
  - terminal event for `id` (`resolved`/`expired`/`consumed`/`revoked`) — acts ONLY if a pending entry exists for `id`; marks it with the mapped `status` + `completedAt` and moves it to `completed` (newest→oldest, bounded by `MAX_COMPLETED`). An unknown `id` is ignored (replay of a resolve without its request is a no-op). `approval.resolved` maps its `decision` (`approved`/`denied`/`edited`) to `status`; an `approval.resolved` with an unrecognized `decision` is a **malformed event** and THROWS (deterministic replay — no `'resolved'` catch-all status; the union has no such state).
  - `resumed` — **Option A (recorded):** a pending entry's `status` is set to `resumed`; it STAYS in `pending` (a resumed approval is still active, not completed). No-op if the id is unknown. `resume.failed` is NOT a terminal event — a failed resume leaves the approval pending (transient), and is ignored by this projection.
  - Non-approval events and events without a string `approvalId` are ignored.
  - **Timestamps are deterministic:** `requestedAt`/`completedAt` come from `Date.parse(e.timestamp)` — the EventLog timestamp, never `Date.now()`. A malformed/absent timestamp THROWS (invalid event), so replay of the same log always yields identical state.

  (`requestedBy` / `capability` are deferred — the current `approval.requested` payload carries `approvalId`/`prompt`/`toolCallId`/`patchProposalId`/`choices`, not those fields. Add them when the payloads do.)
- **Durable:** implements `DurableProjectionBuilder<ApprovalEntry>` — export/import pending + completed state so resume does not replay.
- **Consumer: registry-only in Phase 7.** No `RuntimeSnapshot` field, no `SnapshotBuilder` change, no view change. The snapshot is consumed via `ProjectionRuntime.snapshot("approval")` and the projection's own tests. The TUI's existing `ApprovalManager` → `snapshot.approvals` → `ApprovalsView` path is untouched. Projection-backed operator surfaces (replacing the live manager, cross-projection views, capability/metrics dashboards) are deferred to a later phase.

### Projection-style diversity (proof the abstraction is generic)

| Projection | Model |
|---|---|
| Timeline | append-only |
| Execution Trace | lifecycle reconciliation |
| Approval | state machine / active state |

## Landing sequence (C-style)

Implemented as **4 PRs**, each independently reviewable and green:

### PR 1 — ProjectionRuntime foundation

Only: interface + registry + `updateAll` + `snapshot(id)` + `resetAll` + tests. **No collector changes.** Goal: `ProjectionRuntime` exists and is trusted.

### PR 2 — Collector migration (no behavior change)

Before:
```ts
if (this.buildTimeline) this.timelineBuilder.update(sessionBatch);
this.traceBuilder.update(sessionBatch);
```

After:
```ts
this.projectionRuntime.updateAll(sessionBatch);
```

with registration:
```ts
projectionRuntime.register("timeline", timelineBuilder);
projectionRuntime.register("trace", traceBuilder);
```

**Nothing else changes.** Same projections, same snapshots, same UI, all existing tests pass unchanged. This is the critical safety checkpoint — a regression here is caught by the untouched suite. `resetAll()` replaces the collector's direct `timelineBuilder.reset()` / `traceBuilder.reset()` calls.

### PR 3 — Generic durable-state envelope

Replace the hard-coded `state: { timeline, trace }` assembly with the runtime's `exportState()`/`importState()` producing/consuming the registry-keyed `projections` envelope. No semantic change.

### PR 4 — ApprovalProjection

`ApprovalBuilder` → `projectionRuntime.register("approval", builder)` → consumed via `ProjectionRuntime.snapshot("approval")` + projection tests. **No RuntimeSnapshot, SnapshotBuilder, RuntimeCollector, or view changes.**

> **Adjustment (approved):** the acceptance criterion changes from "builder + registration + typed snapshot field + consumer" to **"builder + registration + durable projection state + projection tests, with zero RuntimeCollector or RuntimeSnapshot changes."** Proving the collector no longer knows projections exist is the stronger milestone.

## Acceptance criteria

- ✅ `RuntimeCollectorImpl` contains **zero projection-specific code** — no `this.timelineBuilder`, no `this.traceBuilder`, no `if (id === "trace")`, in update/reset/export paths. The collector is blind to projection identity.
- ✅ **Static inspection confirms `ProjectionRuntime` is the only owner** of projection update dispatch, reset, and export/import. Grep `src/tui/runtime-collector.ts` for `\.update(`, `\.reset(`, `\.exportState(`, `\.importState(`, `\.snapshot(` and verify the only matches are on `this.projectionRuntime.` (tests can pass while a hidden `this.traceBuilder.reset()` survives — grep catches it).
- ✅ Adding ApprovalProjection requires: builder implementation + registration + durable state contract + projection tests. **Must NOT modify: `RuntimeCollectorImpl`, `RuntimeSnapshot`, or the checkpoint transaction flow.** (The strengthened bar prevents "technically modified the collector while claiming the platform works.")
- ✅ Existing Phase 6/6.5 behavior is byte-for-byte equivalent for timeline + trace (all `tests/tui/runtime` pass unchanged — 88/88 + the state tests).
- ✅ Replay/recovery still works (D12 invalid-cursor → replay from `beginningCursor()`, persisted state never trusted on invalid cursor).
- ✅ One projection = one checkpoint remains enforced (registry-keyed `projections` envelope within the single per-collector checkpoint).

## Global constraints

- NodeNext ESM (`.js` import specifiers), strict TypeScript.
- vitest tests under `tests/**/*.vitest.ts`.
- `EventLog` API stays additive; `src/capability/*` untouched.
- Checkpoint envelope `version` STAYS `1` — the `state` → `projections` rename is a **schema change to the 6.5 `state` field**; see migration note below. Backward compatibility is required for Phase-6.5-era checkpoints.
- Durable state must remain JSON-serializable plain objects only.
- Replay-from-`beginningCursor()` remains the ONLY recovery for an invalid cursor; persisted state never trusted on an invalid cursor.

### Migration note (6.5 → 7 envelope)

Phase 6.5 shipped `state: { timeline?, trace }`. Phase 7 renames the key to `projections` and keys it by registered id. The collector's `initializeCheckpoint` must accept BOTH shapes on load:
- `state` (6.5 legacy) → treat keys `timeline`/`trace` as valid; restore into the corresponding registered builders.
- `projections` (7) → registry-keyed; restore by id.
- On save, always write the new `projections` shape.

This keeps version `1` and is backward compatible with existing 6.5 checkpoint files. (Schema decision deferred to implementation-planning detail, but the load must not reject legacy envelopes.)

## Risks / mitigations

- **Registry migration regression** (PR 2): mitigated by the untouched test suite + byte-for-byte equivalence acceptance criterion; PR 2 lands as its own reviewable commit.
- **Envelope schema change** (PR 3): mitigated by dual-shape load + always-write-new; legacy 6.5 checkpoints keep working.
- **Approval snapshot semantics ambiguity** (PR 4): bounded by the deterministic `MAX_COMPLETED` cap (no time window); the entry shape and reconciliation rules are defined in this spec's ApprovalProjection section.
