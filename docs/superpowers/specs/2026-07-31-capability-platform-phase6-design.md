# ALiX Capability Platform — Phase 6 Design (Timeline Projection Unification)

**Status:** Implemented (Phase 6)
**Date:** 2026-08-01
**Depends on:** Phase 5 (`b95bff32`) + Phase 5.5 (`40072c38`)

> **One append-only EventLog is the canonical source of all narrative facts —
> chat, agent, and execution. Each tab/view is a projection filtered by
> `sessionId`. Three projections over ONE log — the outer (runtime) collector,
> the chat sub-session collector, and the agent sub-session collector — each
> owning its own cursor + one durable checkpoint (independent advancement).
> The log is the only source of truth; every view is a projection.**

## Goal

Unify the operator timeline (`timelineEvents[]` in Phase 3) and the execution
trace (Phase 4) under one shared EventLog with `sessionId`-routed projections.
Establish the canonical pattern: **facts live in one place; everything else
is a projection.** This unlocks future projections (approval, capability,
metrics) and non-tab consumers (web UI, CLI, global timeline) without adding
event stores.

## Design Decisions

| # | Decision |
|---|---|
| D1 | **One `EventLog` per session dir canonical; projections route by `sessionId`.** Every event carries `sessionId` (stamped once at emit, immutable). Projections filter `event.sessionId === projection.sessionId`. Three projection domains share the same log but never see each other's events: the OUTER runtime session (execution trace), the chat sub-session (`${sessionId}-chat`), and the agent sub-session (`${sessionId}-agent`). |
| D2 | **`sessionId` is the routing dimension, not "chat vs agent".** Future consumers (multi-chat, background agent, web UI, CLI, detached workflow) are identical projections over the same log — `projection(sessionId)` with optional `kind` filtering. The persistence layer does NOT know about UI topology. |
| D3 | **`sessionId` is immutable once emitted.** Routing is always based on the stamped origin; a projection may filter or display events from any session later (e.g. global timeline), but events never change ownership. |
| D4 | **Projection builders share a contract, not an engine.** `interface ProjectionBuilder<T> { update(events: readonly AlixEvent[]): void; snapshot(): readonly T[]; }`. Each builder owns its own reconciliation semantics. `ExecutionTraceBuilder` keeps its mature lifecycle/open-closed/terminal-first-wins logic UNTOUCHED. **`TimelineBuilder` is append-only** — narratives don't reconcile; events become entries, entries are never mutated. |
| D5 | **One cursor, one checkpoint, one save-before-publish transaction — PER projection.** Each of the three `RuntimeCollectorImpl` instances (runtime / chat / agent) reads the EventLog ONCE per sample, dispatches its projection builders, saves its checkpoint AFTER all builders succeed, then publishes its snapshot (the Phase-5.5 D5 save-as-commit-marker flow). Checkpoints advance independently per projection — no shared cursor. |
| D6 | **`RuntimeSnapshot` grows, the collector doesn't.** Add `timeline: readonly TimelineEntry[]` alongside the existing `trace: readonly ExecutionTraceEntry[]` + `workflow` + `totalEventCount` + `lastEventAt`. Each view reads what it needs; future projections (approval, capability) extend the snapshot without changing the collector. The field is named `timeline` (NOT `chat`) — `timeline` is the broader, accurate name; "chat" would mislead since the projection also carries `agent.message`/`agent.reasoning`/`agent.decision`/`agent.response`. |
| D7 | **New event kinds in log.** Add `chat.message` (user input), `chat.response` (agent reply to chat), `agent.message` (agent tab conversation — operator prompt OR task-loop narration), `agent.response` (agent tab final summary), `agent.reasoning`, `agent.decision`, plus session lifecycle (`agent.session.turn.started`/`completed`, `agent.session.phase_changed` — already emitted). All carry originating `sessionId`. The `actor` distinguishes operator input (`user`) from agent narration (`agent`) within `agent.message`, so the agent view renders direction. |
| D8 | **`TimelineEntry` DTO** new projection output: `{ readonly id, readonly kind: 'chat.message'\|'chat.response'\|'agent.message'\|'agent.response'\|'agent.reasoning'\|'agent.decision'\|…, readonly actor?, readonly sessionId, readonly startedAt, readonly text?, readonly detail?, readonly sourceEvents: { readonly firstSequence: number; readonly lastSequence?: number; } }`. Mirrors `ExecutionTraceEntry`'s readonly-detached shape. |
| D9 | **`timelineEvents[]` transitional compatibility cache — REMOVED directly.** The cache was deleted once `ChatView`/`AgentView` consumed `RuntimeSnapshot.timeline` (the precondition for the transitional dual-emit phase; that phase was skipped). The deprecated `appendTimelineEvent` wrapper remains as a void no-op compat shim (emits only via the optional `emit` context) until Phase 7. |
| D10 | **Builder-doesn't-become-a-God-object.** `RuntimeCollectorImpl` orchestrates read/dispatch/save/publish; it does NOT contain chat-message-specific or execution-specific logic. The builders own their state machines. |
| D11 | **Projection independence.** Builders MUST NOT depend on the outputs of other builders. Every projection is derived directly from the EventLog batch. The dependency graph is always `EventLog → builder` (never `builder → builder`). This keeps replay deterministic — restoring from `beginningCursor()` rebuilds every projection independently — and allows adding or removing projections without changing existing ones. |
| D12 | **`ProjectionBuilder<T>` contract includes `reset()`.** Beyond `update(events)` and `snapshot()`, the contract includes `reset(): void` so the collector can wipe in-memory projection state on a beyond-head fallback (Phase 5.5) and on corruption recovery. Each builder implements its own reset semantics (the trace builder clears its maps; the timeline builder clears its entries; etc.). Tiny addition that makes lifecycle management uniform across builders and enables tests / replay / hot reload / corruption recovery. |
| D13 | **Boundary.** `src/capability/*`, `timelineEvents[]` (until cleanup), Phase-5 cursor/checkpoint machinery — preserved; `EventLog` API stays additive; `RuntimeCollectorImpl` grows the `timeline` projection (one new builder + new snapshot field). Three collectors wire it in production (chat/agent build timeline + trace); the OUTER collector stays trace-only via `buildTimeline:false` (no view consumes its timeline). Timeline Projection unification is THIS phase. |

## Architecture

### EventLog evolution (`src/events/event-log.ts`)

Every emitted event carries `sessionId`. The existing `append({ sessionId, actor, type, payload })` already accepts a `sessionId` (verify — if it lives in `NewEvent`, just plumb it through; if missing, add to `NewEvent<TType, TPayload>`). Add `serializeCursor`/`deserializeCursor` already return `{ sessionId, version, seq }` (Phase 5) — no change there.

```ts
// Stamped once at append, immutable thereafter.
event.sessionId = originSessionId;
```

### `ProjectionBuilder<T>` contract (`src/tui/runtime/projection-builder.ts`)

```ts
/** Generic projection builder contract. Each builder owns its own reconciliation
 *  semantics; the contract only defines the lifecycle hooks the collector
 *  orchestrates. Builders MUST NOT depend on the outputs of other builders
 *  (D11) — every projection is derived directly from the EventLog batch. */
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
```

### `TimelineBuilder` (`src/tui/runtime/timeline-builder.ts`)

Append-only. No lifecycle matching. No terminal promotion. Each event becomes one entry; entries are never mutated.

```ts
export type TimelineKind =
  | 'chat.message' | 'chat.response'
  | 'agent.message' | 'agent.reasoning' | 'agent.decision' | 'agent.response';

export interface TimelineEntry {
  readonly id: string;                  // `tl-${firstSequence}` — runtime-local deterministic
  readonly kind: TimelineKind;          // discriminated union
  readonly sessionId: string;           // stamped origin (D1/D3)
  readonly startedAt: number;
  readonly text?: string;
  readonly detail?: string;
  readonly sourceEvents: { readonly firstSequence: number; readonly lastSequence?: number };
}

export class TimelineBuilder implements ProjectionBuilder<TimelineEntry> {
  private readonly entries = new Map<string, TimelineEntry>();     // by id; append-only
  private readonly seen = new Set<number>();                        // dedup
  constructor(private readonly sessionId: string) { … }
  update(events: readonly AlixEvent[]): void { … }                   // filter by sessionId, dedup, append
  snapshot(): readonly TimelineEntry[] { … }                        // ordered by firstSequence
  reset(): void { this.entries.clear(); this.seen.clear(); }        // wipe state on fallback
}
```

Idempotent by event `seq` (mirror `seen` semantics). The `id` is `tl-${firstSequence}` for stable identity; a duplicate terminal seq is ignored (append-only — but the `seen` dedup means a replay of an already-appended event produces the same entry, not a duplicate).

### `RuntimeCollectorImpl` evolution (`src/tui/runtime-collector.ts`)

```ts
constructor(
  eventLog: EventLog,
  checkpointStore: ProjectionCheckpointStore,
  sessionId: string,                            // NEW — the projection's session
  timelineBuilder = new TimelineBuilder(sessionId),
  traceBuilder: IncrementalExecutionTraceBuilder, // unchanged — keeps mature semantics
) {
  this.eventLog = eventLog;
  this.checkpointStore = checkpointStore;
  this.sessionId = sessionId;
  this.timelineBuilder = timelineBuilder;
  this.traceBuilder = traceBuilder;
  this.checkpoint = { cursor: eventLog.beginningCursor(), committedAt: 0 };
}

private async sample(): Promise<void> {
  try {
    const batch = await this.eventLog.readSince(this.checkpoint.cursor);
    // Filter the batch by sessionId at the boundary — projections only see their own session.
    const sessionBatch = batch.events.filter(e => e.sessionId === this.sessionId);
    this.timelineBuilder.update(sessionBatch);
    this.traceBuilder.update(sessionBatch);              // trace already implicitly session-scoped via the chat/agent event mix
    // ... build nextCache / nextCheckpoint, then commit atomically (D5/D5a unchanged) ...
  } catch (err) {
    if (err instanceof EventLogCursorError) {
      // D12 — both builders reset so the replay from beginningCursor rebuilds
      // independent, in-memory projection state.
      this.timelineBuilder.reset();
      this.traceBuilder.reset();
      this.resetCheckpoint();
      return;
    }
    // else preserve (operational failure — existing behavior)
  }
}
```

### `RuntimeSnapshot` growth (`src/tui/snapshot.ts`)

```ts
export interface RuntimeSnapshot {
  readonly trace: readonly ExecutionTraceEntry[];    // existing
  readonly timeline: readonly TimelineEntry[];        // NEW (D6) — named `timeline`, NOT `chat`
  readonly workflow: WorkflowStateSnapshot | null;
  readonly totalEventCount: number;
  readonly lastEventAt: number | null;
  readonly sessionId: string;                        // NEW — projected session
}
```

### Views consume the projection

- **`RuntimeView`** keeps rendering `r.trace` (existing).
- **`ChatView`** replaces `r.timelineEvents` with `r.timeline.filter(e => e.kind.startsWith('chat.'))` (filter by sessionId is implicit — `r.timeline` is already scoped to this collector's session).
- **`AgentView`** similarly projects `r.timeline.filter(e => e.kind.startsWith('agent.'))`.

### Pipeline (no duplicated I/O / durability)

```
EventLog.readSince(cursor)         // Phase 5.5
   │
   ▼
sessionBatch = events.filter(e.sessionId === sessionId)
   │
   ▼
traceBuilder.update(sessionBatch)
timelineBuilder.update(sessionBatch)
   │
   ▼
save(checkpoint)        // D5: save-before-publish
   │
   ▼
commit { checkpoint, snapshot } atomically   // D5a
   │
   ▼
publish snapshot with { trace, timeline, workflow, ... }
```

One read, one save, multiple projections, one snapshot.

## Data Flow

```
EventLog (per session dir)
   │
   ▼ readSince(cursor)  →  events
sessionBatch = events.filter(e.sessionId === collector.sessionId)
   │
   ▼
traceBuilder.update(sessionBatch)       →  in-memory projection state (lifecycle)
timelineBuilder.update(sessionBatch)    →  in-memory append-only state
   │
   ▼
checkpointStore.save(serializeCursor(newCursor))
   │
   ▼ commit
snapshot = { trace: traceBuilder.snapshot(),
              timeline: timelineBuilder.snapshot(),
              workflow: computeWorkflow(workflowBatch),
              totalEventCount, lastEventAt, sessionId }
```

## Error Handling

- **`EventLog.readSince(cursor)` throws `EventLogCursorError` (beyond-head)** — Phase 5.5 fallback: `resetCheckpoint()`, full replay from `beginningCursor()`. The new `timeline` projection re-builds from the same filtered batch (idempotent by seq). All error-class discrimination from Phase 5.5 carries over unchanged.
- **Operational failure (disk read rejection, save throw)** — preserve current checkpoint + cache; retry next sample.
- **Corrupted chat events** — `timelineEvents[]` was just an in-memory array; now they're log-backed. Corruption = replay from `beginningCursor()`. No new failure mode.

## Testing Strategy

- **`ProjectionBuilder<T>` contract** — shared `update(events)` / `snapshot()` / `reset()` lifecycle. Each builder's `reset()` is independent (trace clears maps, timeline clears entries).
- **`TimelineBuilder`** — append-only idempotency (replay → same entries, no duplicates); one event per entry; `reset()` clears state.
- **`IncrementalExecutionTraceBuilder`** — unchanged behavior preserved (Phase 4-5 semantics intact); `reset()` added (D12).
- **`EventLog`** — `sessionId` plumbed through `append`/`readSince`/`NewEvent`/`AlixEvent`; foreign-session events rejected (same opacity as cursor).
- **`RuntimeCollectorImpl`** — the new D5/D5a flow with each collector's builders (chat/agent build timeline + trace; the outer collector builds trace only) is correct; cursor advancement atomicity; **beyond-head fallback resets BOTH builders via `traceBuilder.reset()` + `timelineBuilder.reset()` and calls `resetCheckpoint()`** (D12).
- **Views** — ChatView reads `r.timeline.filter(e => e.kind.startsWith('chat.'))`; AgentView reads `r.timeline.filter(e => e.kind.startsWith('agent.'))`; RuntimeView unchanged.
- **Gate:** `npx tsc -p tsconfig.json --noEmit` + `npx vitest run tests/tui --config vitest.config.mts` green.

## Success Criteria

- ✅ `EventLog.append` accepts/stores `sessionId`; events expose it; `readSince` filters by it.
- ✅ `TimelineBuilder` is append-only (entries never mutated after creation); implements `ProjectionBuilder<T>` with `update`/`snapshot`/`reset`.
- ✅ `RuntimeCollectorImpl` runs ONE `readSince` per sample, dispatches its projection builders, advances its own checkpoint, publishes its snapshot (trace; timeline when `buildTimeline` is set).
- ✅ Chat tab + Agent tab have distinct `sessionId`s — neither sees the other's events.
- ✅ Projection independence (D11): neither builder consumes the other's DTOs.
- ✅ Future projections (approval, capability) extend the snapshot without touching the collector.
- ✅ `src/capability/*`, `timelineEvents[]` (until Phase 6 cleanup), Phase-5 cursor/checkpoint machinery — preserved.
- ✅ Vitest green, `tsc --noEmit` clean.

## Non-Goals (Phase 6)

- **Durable projection state** (persist TimelineBuilder snapshots beyond the checkpoint cursor) — Phase 6.5+.
- **Per-tab EventLog instances** — log is shared, `sessionId` is the partition key.
- **Persistent chat/agent session recovery** — the durable watermark rebuilds the projection forward; full-state recovery of a multi-turn chat is out of scope.
- **ApprovalBuilder / MetricsBuilder / CapabilityBuilder** — same contract, future phases.
- **Removing `timelineEvents[]` entirely** — done directly in Phase 6 once the views consumed `RuntimeSnapshot.timeline` (the precondition for the transitional dual-emit phase; that phase was skipped). The deprecated `appendTimelineEvent` wrapper remains as a void no-op compat shim until Phase 7.

## Future Direction

- **Projection registry** — a `collector.register(builder)` API so new projections (approval, capability, metrics) plug in without changing the collector. Deferred — current builders are concrete fields on the constructor; a registry becomes worthwhile when the projection count exceeds ~5.
- **Phase 6.5** — ✅ done — durable projection-state snapshots (timeline + trace) alongside the checkpoint cursor. Implemented: `DurableProjectionBuilder` contract, builder `exportState`/`importState`, envelope `state` block (additive, version stays 1), collector persists/restores state in the same save transaction as the cursor. Legacy checkpoints (no state) replay from the cursor; invalid cursors still rebuild by replay from `beginningCursor()`.
- **Phase 7** — additional projections (approval, capability, metrics) + cross-projection views.
- **Global Timeline projection** — a view that filters across multiple sessionIds (the architecture already supports it: `projection(filter: (sessionId: string) => boolean)`).
- **Web UI consumer** — the immutable DTOs (`ExecutionTraceEntry`, `TimelineEntry`) are projection-friendly for a future web surface.
