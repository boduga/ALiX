# ALiX Capability Platform — Phase 5.5 Design (Durable Projection Checkpoints)

**Status:** Approved — Ready for Implementation
**Date:** 2026-07-31
**Depends on:** Phase 5 (`docs/superpowers/specs/2026-07-31-capability-platform-phase5-design.md`) — merged 2026-07-31 (`7a3cd94c`)

> Persists the `ProjectionCheckpoint` (cursor + committedAt) so the incremental
> EventLog processing from Phase 5 survives process replacement. Delivers the
> strongest primitive for the future Timeline Projection phase: a durable, opaque,
> replay-safe projection watermark.

## Goal

Persist the execution-trace projection's checkpoint to disk so a restarted collector resumes from its last committed position instead of rebuilding from `beginningCursor()`. The checkpoint is a **commit marker**: it advances only after a durable save succeeds.

## Design Decisions

| # | Decision |
|---|---|
| D1 | **EventLog owns cursor serialization.** `EventLog.serializeCursor(cursor)` and `deserializeCursor(serialized)` are the only way cursors cross the persistence boundary. The internal representation stays private to the log module — consumer code never depends on sequence representation. The serialized form is a **position claim**, not a transferable cursor: no owner token is persisted, so on restart `deserializeCursor` creates a cursor owned by the new instance. |
| D2 | **Cursor format is versioned internally.** `{ version: 1, seq }`. Future migration switches on `version`. `deserializeCursor` has exactly three failure modes: **malformed JSON**, **unsupported version**, **invalid payload** — all throw. |
| D3 | **`ProjectionCheckpointStore` owns atomic persistence only.** A dedicated store persists `{ version, cursor, committedAt }` to `.alix/sessions/<sessionId>/projection-checkpoint.json` via atomic tmp+rename (mirrors session-store-jsonl). The store never receives an `EventLog` and never interprets the cursor string (D1/D7). Dependency graph is one-directional: `EventLog ↑ Collector ↓ CheckpointStore` — the collector is the bridge that serializes/deserializes around the store, never the store touching the log. |
| D4 | **Checkpoint file has its own version envelope.** The container is `{ version: 1, cursor, committedAt }` — the cursor's internal format is versioned too, but the container envelope is the store's contract and may evolve independently (future `projection`/`schema` fields). The two versions evolve independently. |
| D5 | **The checkpoint is the durable commit marker.** Neither the in-memory checkpoint nor the published snapshot may advance unless the checkpoint has been durably persisted. `readSince` → `builder.update` → `save(candidateCheckpoint)` → on success advance in-memory checkpoint + publish snapshot; on failure keep BOTH the old checkpoint and the old cache (retry next sample). A published `RuntimeSnapshot` always has a corresponding durable checkpoint position. |
| D5a | **Commit-marker invariant (D5, stated once):** *A checkpoint file never represents a projection state that has not been durably published, and a published snapshot never represents a checkpoint position that has not been durably persisted.* |
| D6 | **Write cadence = every successful sample.** The EventLog is append-only and the file is ~100 bytes; 1 write/sec via atomic tmp+rename is negligible versus LLM calls/rendering. No throttle (optimize correctness first; a throttle is a later option if I/O ever matters). Shutdown-only is rejected (daemon environments have ungraceful exits: SIGKILL, OOM, container eviction). |
| D7 | **`ProjectionCheckpoint` stays cursor-object based in the runtime layer.** The collector never touches a `cursorString`; serialization happens only at the store boundary (`serializeCursor`/`deserializeCursor`). |
| D8 | **Boundary.** `src/capability/*`, `timelineEvents[]`, ChatView, AgentView, and the capability presenter are untouched. Timeline Projection (the unification) is still a separate future phase. |

## Architecture

### Cursor serialization (`src/events/event-log.ts`)

```ts
interface EventLog {
  // (existing) beginningCursor / getCursor / readSince / cursorsEqual

  /** Serialize a cursor for durable storage. Opaque — only meaningful to this EventLog. */
  serializeCursor(cursor: EventLogCursor): string;
  /** Restore a cursor owned by this EventLog. Throws for malformed or foreign
   *  serialized cursors. The restored cursor carries THIS instance's owner token. */
  deserializeCursor(serialized: string): EventLogCursor;
}
```

Internal representation (module-private, versioned):

```json
{ "version": 1, "seq": 4812 }
```

The serialized string may contain the sequence internally, but it is only handled inside `serializeCursor`/`deserializeCursor` — **seq is never exposed through the public EventLog cursor API** (D1/D2).

### Checkpoint store (`src/tui/runtime/projection-checkpoint-store.ts`)

The store's contract is the **persisted** form — it never sees an `EventLog` or a cursor object (D3/D7):

```ts
/** The persisted form of a projection checkpoint. `committedAt` is the instant
 *  this projection became durable (matches D5 — the checkpoint is the durable
 *  commit marker). */
export interface PersistedProjectionCheckpoint {
  readonly version: 1;
  readonly cursor: string;      // opaque — the store never interprets it
  readonly committedAt: number;
}

export interface ProjectionCheckpointStore {
  load(): Promise<PersistedProjectionCheckpoint | null>;
  save(checkpoint: PersistedProjectionCheckpoint): Promise<void>;
}
```

Storage: `.alix/sessions/<sessionId>/projection-checkpoint.json`

```json
{ "version": 1, "cursor": "<opaque>", "committedAt": 1785544200000 }
```

Atomic write: write `<file>.tmp` then `rename` over the target (session-store-jsonl pattern). `load()` returns `null` for a missing file, malformed JSON, or an unknown container `version`. The store owns the envelope (D4); it never reads the cursor string. The collector is the bridge: `load() → deserializeCursor() → ProjectionCheckpoint`, and `ProjectionCheckpoint → serializeCursor() → save()` (D3 dependency graph: `EventLog ↑ Collector ↓ CheckpointStore`).

### Collector wiring (`src/tui/runtime-collector.ts`)

`RuntimeCollectorImpl` takes the store via **constructor injection** — it never instantiates it internally (tests inject an in-memory store; filesystem persistence stays outside collector logic; a future backend can swap in):

```ts
constructor(
  eventLog: EventLog,
  checkpointStore: ProjectionCheckpointStore,
) {
  this.eventLog = eventLog;
  this.checkpointStore = checkpointStore;
}
```

`tui.ts` creates both (`new EventLog(sessionDir)` + `new ProjectionCheckpointStore(sessionDir)` or a factory) and injects them. `start()` is **async and awaits recovery before sampling** — the first sample must never race a not-yet-completed `initializeCheckpoint()` (which would incorrectly start from `beginningCursor()`):

```ts
async start(): Promise<void> {
  await this.initializeCheckpoint();
  await this.sample();
  this.timer = setInterval(() => void this.sample(), 1000);
}
```

`initializeCheckpoint()`:
```
load() → null / malformed / foreign → beginningCursor()
       → valid → deserializeCursor(saved.cursor) → checkpoint = restored (owned by this instance)
```

### Runtime flow — save is the commit marker (D5)

```
readSince(checkpoint.cursor)
   │
   ▼
builder.update(batch.events)
   │
   ▼
nextCheckpoint = { cursor: batch.cursor, committedAt: Date.now() }
   │
   ▼
await checkpointStore.save(nextCheckpoint)
   │
   ├── failure ──► keep old checkpoint + old cache; retry next sample
   │
   └── success ──► this.checkpoint = nextCheckpoint; this.cache = buildSnapshot()
```

A save failure keeps the in-memory checkpoint at the old (durable) position — so the projection, checkpoint, and published snapshot stay aligned. Recovery replays the unsaved window (idempotent), but a published snapshot always has a durable watermark behind it.

## Data Flow

```
EventLog (append-only, seq'd)
   │ readSince(cursor)                      serializeCursor() [at the store boundary]
   ▼                                                       │
IncrementalExecutionTraceBuilder.update(events)             ▼
   ▼                                            ProjectionCheckpointStore
candidateCheckpoint ── save() ──► projection-checkpoint.json (atomic tmp+rename)
   │                                                         │
   ▼ success                                                │ load()
checkpoint advances + snapshot publishes              beginningCursor() fallback
```

## Error Handling

- **Save failure** — old checkpoint + old cache preserved (D5); next sample retries.
- **Missing/malformed/foreign checkpoint on load** — fall back to `beginningCursor()` (full replay, idempotent).
- **`deserializeCursor` throws** — caught in `initializeCheckpoint`, falls back to `beginningCursor()`.
- **Atomic write failure** — `save` rejects; the `.tmp` file is left, never a half-written target.

## Testing Strategy

- **EventLog cursor serialization:** round-trip (serialize→deserialize→`cursorsEqual`); serialized cursor from another log instance rejects on `deserializeCursor`; malformed JSON rejects; versioned format preserved.
- **Checkpoint store:** atomic write (tmp+rename — target only appears complete); `load` missing→null, malformed→null, unknown version→null; round-trip.
- **Collector:** recovery from a saved checkpoint resumes (does not full-replay); fallback to `beginningCursor()` on missing/malformed/foreign; **save-failure keeps old checkpoint + old cache and retries next sample** (D5 — the discriminating test: inject a failing store, assert the checkpoint did NOT advance and the cache is unchanged, then a successful sample advances both).
- **Gate:** `npx tsc -p tsconfig.json --noEmit` + `npx vitest run tests/tui tests/events --config vitest.config.mts` green.

## Success Criteria

- ✅ `EventLog.serializeCursor`/`deserializeCursor` exist; cursor opacity preserved (seq never exposed through the public API); versioned internal format.
- ✅ `ProjectionCheckpointStore` persists atomically with its own version envelope; `load` falls back cleanly.
- ✅ Collector resumes from the saved checkpoint after restart; save is a commit marker (checkpoint advances only after durable save; save-failure preserves old checkpoint + old cache).
- ✅ **D5a commit-marker invariant:** a checkpoint file never represents a projection state that has not been durably published, and a published snapshot never represents a checkpoint position that has not been durably persisted.
- ✅ Write cadence = every successful sample, persist-before-publish.
- ✅ `src/capability/*`, `timelineEvents[]`, ChatView, AgentView, capability presenter untouched; vitest green; `tsc --noEmit` clean.

## Non-Goals (Phase 5.5)

- **Timeline Projection unification.** Reuses the durable watermark later — not this phase (D8).
- **Cursor/offset micro-optimizations** (a persisted offset index for faster reads). Separate future direction.
- **Throttled writes / batching.** Every-sample writes are negligible; optimize correctness first.
- **`seenSequences` compaction or durable projection state** beyond the cursor. The checkpoint persists the position; the projection reconstructs in-memory state from the persisted watermark using the existing idempotent reconciliation semantics — from the checkpoint cursor forward, not necessarily from the beginning (the distinction matters once multiple projections share the EventLog).

## Future Direction

- **Timeline Projection phase** — reuse the durable, opaque, replay-safe watermark as the shared projection foundation for `timelineEvents[]` + execution trace on the unified log.
- **Checkpoint envelope v2** — add `projection`/`schema` fields when multiple projections share the checkpoint model.
- **`readSince` offset index** if large logs need faster cursor reads.
