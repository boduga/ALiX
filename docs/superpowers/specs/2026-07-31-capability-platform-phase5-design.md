# ALiX Capability Platform — Phase 5 Design (EventLog Incremental Projection Foundation)

**Status:** Approved — Ready for Implementation
**Date:** 2026-07-31
**Depends on:** Phase 4 (`docs/superpowers/specs/2026-07-31-capability-platform-phase4-execution-trace-design.md`) — merged 2026-07-31 (`b95bff32`)

> Completes the Phase-4 migration (#321) and replaces the trace's rebuild-every-poll
> with cursor-driven incremental processing — the infrastructure the future Timeline
> Projection phase will reuse. The projection consumes facts; it does not own them.

## Goal

Three outcomes: (1) remove the deprecated flat `RuntimeEventSnapshot`/`RuntimeSnapshot.events` projection (resolving issue #321); (2) add cursor-based `EventLog.readSince(cursor)` reads; (3) make the trace builder incremental (`update(newEvents)`/`snapshot()`) preserving open lifecycle state across updates — all sharing one reconciliation engine with the existing pure `buildExecutionTrace`.

## Design Decisions

| # | Decision |
|---|---|
| D1 | **Cursor is opaque, seq-backed, log-local.** `EventLogCursor` is a branded type whose internal representation (`seq`) is private to `event-log.ts`. Consumers can only obtain, store, compare-by-helper, and pass cursors back to the same `EventLog` instance. A cursor belongs to exactly one logical EventLog — it cannot migrate between sessions/log files and is not globally meaningful. |
| D2 | **At-least-once cursor semantics.** `readSince(cursor)` returns `{ events, cursor }` where the returned cursor is the **highest `seq` successfully included in the result** (not necessarily the log head observed). A consumer that fails before accepting the new cursor retries from the old one and re-reads the same range — so the incremental builder MUST be idempotent for duplicate event sequences. No new events → `events: []` + an equivalent cursor. Results are ascending by `seq`, from one consistent read snapshot. |
| D3 | **No durable checkpoint persistence in Phase 5.** Incremental processing exists; it does not survive process replacement. Cursor files / DB checkpoints / crash-recovery storage are explicitly Phase 5.5+. The in-memory `ProjectionCheckpoint { cursor, updatedAt }` shape is introduced for the collector's own state, not persisted. |
| D4 | **One reconciliation engine.** `buildExecutionTrace(events)` becomes a compatibility wrapper over `createTraceState()` + `reconcileEvents(state, events)` + `materializeTrace(state)`. The stateful `IncrementalExecutionTraceBuilder` uses the SAME `reconcileEvents`/`materializeTrace`. No second grouping algorithm. |
| D5 | **Idempotency by event `seq`.** `ExecutionTraceState.seenSequences` dedups; replaying events 11–13 leaves the projection unchanged. Terminal dedup: completed lifecycles leave `openByKey` into `terminalById` keyed by `tr-${firstSequence}`; a duplicate terminal with a different payload does NOT silently rewrite history — **first terminal completion wins**, later duplicates are ignored after reconciliation (their seqs may be retained internally for diagnostics). |
| D6 | **Mutable internal state, immutable published snapshots.** The builder holds a mutable `ExecutionTraceState` (open lifecycles, terminal map); `snapshot()` returns a fresh `retention.apply(materializeTrace(state))` of immutable `ExecutionTraceEntry[]` DTOs. An earlier snapshot never changes after a later `update` — enforced by a mandatory immutability test. |
| D7 | **#321 dashboard migration:** the RUNTIME panel "Last event:" row switches from newest raw event to the last trace unit (e.g. `tool.search ✔ completed`). `totalEventCount`/`lastEventAt` stay raw-log metadata. Trace = interpretation; EventLog metadata = accounting. |
| D8 | **Boundary:** `timelineEvents[]`, ChatView, AgentView, the capability presenter, and `src/capability/*` are UNTOUCHED. The Timeline Projection phase will later reuse `EventLogCursor`/`readSince`/the reconciliation engine/`ProjectionCheckpoint` without dragging the Phase-3 timeline migration into this phase. |

## Architecture

### Cursor (`src/events/event-log.ts`)

```ts
declare const eventLogCursorBrand: unique symbol;

/** Opaque, log-local position marker. Belongs to exactly one EventLog
 *  instance; consumers obtain/store/compare/pass back — never read internals. */
export type EventLogCursor = { readonly [eventLogCursorBrand]: true };

// Internal, private to event-log.ts:
interface InternalEventLogCursor { readonly seq: number; }
```

Public API additions to `EventLog`:

```ts
interface EventLog {
  /** The position before the first event — the start for full replay. */
  beginningCursor(): EventLogCursor;
  /** The current head cursor (for callers that want to skip existing history). */
  getCursor(): EventLogCursor;
  /** Events with seq > cursor.seq, ascending; returned cursor = highest seq included. */
  readSince(cursor: EventLogCursor): Promise<{
    readonly events: readonly AlixEvent[];
    readonly cursor: EventLogCursor;
  }>;
  /** Equality helper for opaque cursors. */
  cursorsEqual(a: EventLogCursor, b: EventLogCursor): boolean;
}
```

Semantics frozen: fabricated/negative/future cursors cannot be constructed through the public API (the brand is private); `beginningCursor()` is never null-based; cursors are log-local.

### Reconciliation engine + builder (`src/tui/runtime/execution-trace-builder.ts`)

```ts
interface MutableLifecycle {
  kind: ExecutionTraceKind;
  key: string;
  title: string;
  status: ExecutionTraceStatus;
  startedAt: number;
  firstSequence: number;
  lastSequence: number;
  detailParts: string[];
}

interface ExecutionTraceState {
  readonly seenSequences: Set<number>;
  readonly openByKey: Map<string, MutableLifecycle>;
  readonly terminalById: Map<string, ExecutionTraceEntry>;
}

function createTraceState(): ExecutionTraceState;
function reconcileEvents(state: ExecutionTraceState, events: readonly AlixEvent[]): void;
function materializeTrace(state: ExecutionTraceState): ExecutionTraceEntry[];
```

`buildExecutionTrace` becomes a compatibility wrapper (D4):

```ts
export function buildExecutionTrace(events: readonly AlixEvent[]): ExecutionTraceEntry[] {
  const state = createTraceState();
  reconcileEvents(state, events);
  return materializeTrace(state);
}
```

Stateful facade (D6):

```ts
export class IncrementalExecutionTraceBuilder {
  private readonly state = createTraceState();
  private readonly retention: ExecutionTraceRetention;

  constructor(retention: ExecutionTraceRetention = createExecutionTraceRetention()) {}

  /** Reconcile new events into the lifecycle state. Idempotent by event seq. */
  update(events: readonly AlixEvent[]): void {
    reconcileEvents(this.state, events);
  }

  /** Fresh immutable snapshot after retention. Never mutates prior snapshots. */
  snapshot(): readonly ExecutionTraceEntry[] {
    return this.retention.apply(materializeTrace(this.state));
  }
}
```

### `reconcileEvents` rules (single engine — carries forward Phase 4's grouping)

- **Dedup:** skip events whose `seq` is already in `state.seenSequences` (D5). Unknown event types ignored (forward-compat).
- **Open:** non-terminal events open (or update) `openByKey`; `tool.output` previews append to `detailParts`.
- **Terminal:** a terminal event with an open lifecycle promotes it: status/duration/detail set, moved from `openByKey` to `terminalById[tr-${firstSequence}]`. **First terminal completion wins** — if `terminalById[tr-${firstSequence}]` already exists, later duplicate terminal events are ignored (their seqs may be added to `seenSequences` for diagnostics).
- **Synthesized:** terminal-without-open becomes a standalone completed unit (e.g. `policy.decision`, `patch.checkpoint_created`).
- **materializeTrace:** emits terminal entries (oldest→newest by firstSequence) then open entries as `running` (no `lastSequence`).

### Collector integration (`src/tui/runtime-collector.ts`)

The collector owns TWO concerns: the trace (via the incremental builder) and the workflow/runtime accounting (via a bounded recent-events buffer). `computeWorkflow` scans for `workflow.created`/`workflow.completed` boundaries then counts steps since the last `workflow.created` — it needs events since that boundary, NOT the trace (non-lifecycle events like `workflow.completed` don't appear in the trace). So the collector retains a bounded `recentEvents` buffer (events appended per batch; trimmed once the active workflow completes) used only by `computeWorkflow`; `totalEventCount`/`lastEventAt` come from the raw log head (`getCursor`/latest read).

```
let checkpoint: ProjectionCheckpoint = { cursor: eventLog.beginningCursor(), updatedAt: Date.now() };
let recentEvents: AlixEvent[] = [];   // for computeWorkflow boundary/step scan
sample():
  const batch = await eventLog.readSince(checkpoint.cursor);
  builder.update(batch.events);
  checkpoint = { cursor: batch.cursor, updatedAt: Date.now() };
  recentEvents = trimAfterWorkflowBoundary([...recentEvents, ...batch.events]);
  this.cache = { trace: builder.snapshot(), workflow: computeWorkflow(recentEvents), totalEventCount: <from cursor>, lastEventAt: <last raw event ts>, ... };
```

Startup is fully incremental — no `readAll()`. Poll-failure keeps the previous snapshot (existing invariant). `ProjectionCheckpoint` is in-memory only (D3).

### #321: dashboard migration (`src/tui/dashboard-renderer.ts` + `src/tui/snapshot.ts`)

- Delete `RuntimeEventSnapshot` and the `events?` field from `RuntimeSnapshot`; remove the collector's flat `mapped` producer and the `runtime.events` guard in `dashboard-renderer.ts`.
- The RUNTIME panel "Last event:" row reads the last trace unit from `runtime.trace` (its title + status + started time). `totalEventCount`/`lastEventAt` remain raw-log metadata (D7).

## Data Flow

```
EventLog (append-only, seq'd)
   │ readSince(cursor)
   ▼
IncrementalExecutionTraceBuilder.update(events) ── reconcileEvents(state, events)
   │ (dedup by seq; open/merge/terminal; terminalById first-wins)
   ▼
builder.snapshot() ── retention.apply(materializeTrace(state))
   ▼
RuntimeSnapshot.trace (fresh readonly DTOs)
   ▼
RuntimeView + dashboard-renderer (renders trace)
```

## Error Handling

- **readSince failure** — collector keeps the previous snapshot (existing invariant).
- **Duplicate / replayed events** — `seenSequences` dedup + `terminalById` first-wins make the builder idempotent (D2/D5).
- **A lifecycle stuck open across updates** — stays `running` in snapshots; promotes on a later terminal event; never crashes.
- **Cursor from another log** — cursors are log-local; passing a foreign cursor yields undefined-but-safe behavior (no documented cross-log guarantee).

## Testing Strategy

- **Cursor:** `beginningCursor` vs `getCursor`; `readSince(beginning)` returns all events ascending; `readSince(current)` returns `[]` + equivalent cursor; returned cursor is highest-included-seq; a second `readSince` of the same range re-reads the same events (at-least-once); fabricated cursor impossible via public API.
- **Incremental builder:** `update`+`snapshot` equals `buildExecutionTrace(events)` over the same input; **idempotency** — replaying events 11–13 leaves the projection unchanged; open lifecycle survives across updates then promotes to terminal; **snapshot immutability (mandatory, D6)** — `before = snapshot()` stays `running` after `update(completed)` then `after = snapshot()` is `completed`; terminal dedup — a duplicate terminal with different payload does NOT rewrite `terminalById` (first wins).
- **Collector:** startup from `beginningCursor` (no `readAll()`); poll-failure keeps snapshot; `trace` matches single-shot `buildExecutionTrace`.
- **#321:** dashboard-renderer reads `trace`; zero `RuntimeEventSnapshot`/`RuntimeSnapshot.events` references in `src/` + `tests/`.
- **Gate:** `npx tsc -p tsconfig.json --noEmit` + `npx vitest run tests/tui --config vitest.config.mts` green.

## Success Criteria

- ✅ `EventLog.readSince(cursor)` exists with opaque, log-local, at-least-once semantics; `beginningCursor`/`getCursor`/`cursorsEqual` available.
- ✅ `IncrementalExecutionTraceBuilder.update/snapshot` shares the `createTraceState`/`reconcileEvents`/`materializeTrace` engine with the pure `buildExecutionTrace` wrapper (one algorithm).
- ✅ Idempotent by event `seq`; terminal first-wins; snapshot immutability test green.
- ✅ `RuntimeCollectorImpl` starts from `beginningCursor` and consumes incrementally — no `readAll()` in normal startup.
- ✅ #321 resolved: `RuntimeEventSnapshot` + `RuntimeSnapshot.events?` deleted, dashboard-renderer reads `trace`, zero references remain.
- ✅ `timelineEvents[]`, ChatView, AgentView, capability presenter, `src/capability/*` untouched; vitest green; `tsc --noEmit` clean.

## Non-Goals (Phase 5)

- **Durable checkpoint persistence** (cursor files, crash recovery). Explicitly Phase 5.5+ (D3).
- **Timeline Projection unification.** The Timeline Projection phase reuses the cursor/reconciliation/checkpoint machinery later — not this phase (D8).
- **`timelineEvents[]`, ChatView, AgentView, capability presenter changes.**
- **New event kinds / richer timeline kinds.** The existing `tool|policy|capability|runtime` trace vocabulary is unchanged.
- **`src/capability/*` modification.**

## Future Direction

- **Phase 5.5 — durable checkpoints.** Persist `ProjectionCheckpoint` (cursor + updatedAt) so incremental processing survives process replacement.
- **Timeline Projection phase** — unify `timelineEvents[]` + execution trace on the shared append-only log, reusing `EventLogCursor`, `readSince`, the reconciliation engine, and the checkpoint model.
- **`readSince` micro-optimizations** — a persisted offset index if large logs need faster cursor reads.
