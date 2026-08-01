# ALiX Capability Platform Phase 6 — Timeline Projection Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the operator timeline (`timelineEvents[]` in Phase 3) and the execution trace (Phase 4) under one shared EventLog with `sessionId`-routed projections. Establish the canonical pattern: **facts live in one place; everything else is a projection.**

**Architecture:** One `EventLog` carries `sessionId` on every event (already does — Phase 4 used it). One `RuntimeCollectorImpl` owns one cursor + one durable checkpoint + multiple projection builders (`IncrementalExecutionTraceBuilder` for trace, new `TimelineBuilder` for chat/agent). `RuntimeSnapshot` grows a `timeline` field. ChatView/AgentView project from `RuntimeSnapshot.timeline`. `timelineEvents[]` becomes a transitional compatibility cache.

**Tech Stack:** TypeScript (NodeNext ESM, strict), vitest, the existing EventLog + RuntimeCollector + ProjectionCheckpointStore + IncrementalExecutionTraceBuilder.

## Global Constraints

- **`sessionId` stamping (D1/D3):** every event already carries `sessionId` (Phase 4); verify the field flows through `append`/`readSince`/`NewEvent`/`AlixEvent` end-to-end. Projections filter `event.sessionId === projection.sessionId`.
- **`sessionId` is immutable once emitted (D3).** The stamped origin is the routing dimension.
- **`timeline` (NOT `chat`) field name (D6):** the projection covers `chat.message`/`chat.response`/`agent.message`/`agent.reasoning`/`agent.decision` — broader than "chat."
- **`ProjectionBuilder<T>` contract (D4/D12):** `update(events)` / `snapshot()` / `reset()`. `ExecutionTraceBuilder` keeps its mature lifecycle semantics UNTOUCHED. `TimelineBuilder` is append-only (narratives don't reconcile).
- **D11 — Projection independence.** Builders MUST NOT depend on the outputs of other builders. Dependency graph: `EventLog → builder` (never `builder → builder`).
- **One cursor, one checkpoint, one save-before-publish transaction (D5/D5a)** — extends Phase 5.5's flow. Beyond-head fallback resets BOTH builders (`traceBuilder.reset()` + `timelineBuilder.reset()`) + calls `resetCheckpoint()`.
- **`timelineEvents[]` is a transitional cache** during Phase 6 migration; the Phase 6 cleanup task removes it.
- **`src/capability/*`, Phase-5 cursor/checkpoint machinery — preserved.**
- NodeNext ESM (`.js` imports), strict TS, vitest.
- Every task ends green: `npx tsc -p tsconfig.json --noEmit` passes and the task's tests pass.

---

### Task 1: `ProjectionBuilder<T>` contract + `TimelineBuilder` (append-only)

**Files:**
- Create: `src/tui/runtime/projection-builder.ts`
- Create: `src/tui/runtime/timeline-builder.ts`
- Test: `tests/tui/runtime/timeline-builder.vitest.ts` (new)

**Interfaces:**
- Produces: `ProjectionBuilder<T>` interface (shared lifecycle contract — D4/D12). `TimelineBuilder` implements `ProjectionBuilder<TimelineEntry>`. `TimelineEntry`, `TimelineKind` exported. Tasks 3-4 consume these.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tui/runtime/timeline-builder.vitest.ts
import { describe, it, expect } from 'vitest';
import { TimelineBuilder, type TimelineEntry } from '../../../src/tui/runtime/timeline-builder.js';
import type { AlixEvent } from '../../../src/events/types.js';

function evt(seq: number, type: string, sessionId = 's1', payload: object = {}): AlixEvent {
  return {
    id: `e${seq}`, seq, version: 1, sessionId, runId: undefined, parentEventId: undefined,
    timestamp: new Date(seq * 1000).toISOString(), type, actor: 'user', payload,
  };
}

describe('TimelineBuilder', () => {
  it('appends one entry per chat.message event (append-only)', () => {
    const b = new TimelineBuilder('s1');
    b.update([
      evt(1, 'chat.message', 's1', { text: 'hi' }),
      evt(2, 'chat.response', 's1', { text: 'hello' }),
    ]);
    const snap = b.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap[0]!.kind).toBe('chat.message');
    expect(snap[1]!.kind).toBe('chat.response');
    expect(snap[0]!.sessionId).toBe('s1');
  });

  it('filters events by sessionId (other sessions ignored)', () => {
    const b = new TimelineBuilder('s1');
    b.update([evt(1, 'chat.message', 's1'), evt(2, 'chat.message', 's2')]);
    expect(b.snapshot()).toHaveLength(1);
  });

  it('is idempotent by event seq — replay produces no duplicates', () => {
    const b = new TimelineBuilder('s1');
    const batch = [evt(1, 'chat.message', 's1'), evt(2, 'chat.response', 's1')];
    b.update(batch);
    const once = b.snapshot();
    b.update(batch);                                    // replay
    expect(b.snapshot()).toEqual(once);
  });

  it('reset() clears all in-memory projection state', () => {
    const b = new TimelineBuilder('s1');
    b.update([evt(1, 'chat.message', 's1'), evt(2, 'chat.response', 's1')]);
    expect(b.snapshot()).toHaveLength(2);
    b.reset();
    expect(b.snapshot()).toEqual([]);
  });

  it('entries are never mutated after creation (append-only)', () => {
    const b = new TimelineBuilder('s1');
    b.update([evt(1, 'chat.message', 's1', { text: 'v1' })]);
    const snap = b.snapshot();
    (snap[0] as { text: string }).text = 'mutated';
    // The internal entry is NOT the same object as the snapshot entry (cloned)
    // — so a later update cannot mutate the published entry. (Verify via a
    // second snapshot — the live entry is unchanged.)
    b.update([evt(2, 'chat.response', 's1', { text: 'v2' })]);
    const live = b.snapshot().find((e) => e.id === 'tl-1')!;
    expect(live.text).toBe('v1');                            // unchanged
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/runtime/timeline-builder.vitest.ts --config vitest.config.mts`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement the contract + builder**

```typescript
// src/tui/runtime/projection-builder.ts
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
```

```typescript
// src/tui/runtime/timeline-builder.ts
import type { AlixEvent } from '../../events/types.js';
import type { ProjectionBuilder } from './projection-builder.js';

export type TimelineKind =
  | 'chat.message' | 'chat.response'
  | 'agent.message' | 'agent.reasoning' | 'agent.decision';

/** Timeline projection entry (D8). Mirrors ExecutionTraceEntry's readonly
 *  detached shape. */
export interface TimelineEntry {
  readonly id: string;                  // `tl-${firstSequence}` — runtime-local deterministic
  readonly kind: TimelineKind;
  readonly sessionId: string;           // stamped origin (D1/D3)
  readonly startedAt: number;
  readonly text?: string;
  readonly detail?: string;
  readonly sourceEvents: { readonly firstSequence: number; readonly lastSequence?: number };
}

function cloneEntry(e: TimelineEntry): TimelineEntry {
  return {
    id: e.id, kind: e.kind, sessionId: e.sessionId, startedAt: e.startedAt,
    ...(e.text !== undefined ? { text: e.text } : {}),
    ...(e.detail !== undefined ? { detail: e.detail } : {}),
    sourceEvents: {
      firstSequence: e.sourceEvents.firstSequence,
      ...(e.sourceEvents.lastSequence !== undefined ? { lastSequence: e.sourceEvents.lastSequence } : {}),
    },
  };
}

/** Append-only timeline projection (D4). No lifecycle matching, no terminal
 *  promotion. Events become entries; entries are never mutated. Filtered by
 *  the collector's sessionId at the collector boundary; the builder also
 *  defensively filters here. */
export class TimelineBuilder implements ProjectionBuilder<TimelineEntry> {
  private readonly entries = new Map<string, TimelineEntry>(); // by id; append-only
  private readonly seen = new Set<number>();                    // dedup

  constructor(private readonly sessionId: string) {}

  update(events: readonly AlixEvent[]): void {
    for (const e of events) {
      if (e.sessionId !== this.sessionId) continue;       // (defensive — collector already filters)
      const seq = e.seq ?? 0;
      if (this.seen.has(seq)) continue;
      this.seen.add(seq);
      const entry = this.build(e);
      this.entries.set(entry.id, entry);
    }
  }

  snapshot(): readonly TimelineEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => a.sourceEvents.firstSequence - b.sourceEvents.firstSequence)
      .map(cloneEntry);
  }

  reset(): void {
    this.entries.clear();
    this.seen.clear();
  }

  private build(e: AlixEvent): TimelineEntry {
    const kind = e.type as TimelineKind;
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const text = typeof p.text === 'string' ? p.text : undefined;
    const detail = typeof p.detail === 'string' ? p.detail : undefined;
    const ts = Date.parse(e.timestamp) || 0;
    return {
      id: `tl-${e.seq ?? 0}`,
      kind, sessionId: e.sessionId, startedAt: ts,
      ...(text !== undefined ? { text } : {}),
      ...(detail !== undefined ? { detail } : {}),
      sourceEvents: { firstSequence: e.seq ?? 0 },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/runtime/timeline-builder.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Build + full TUI suite + commit**

Run: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui --config vitest.config.mts`
```bash
git add src/tui/runtime/projection-builder.ts src/tui/runtime/timeline-builder.ts tests/tui/runtime/timeline-builder.vitest.ts
git commit -m "feat(capabilities): ProjectionBuilder contract + append-only TimelineBuilder"
```

---

### Task 2: Wire chat/agent appends into the EventLog

**Files:**
- Modify: `src/tui/state.ts` (`appendTimelineEvent` also emits to the EventLog)
- Modify: `src/tui/app.ts` (sites that call `appendTimelineEvent` pass the EventLog + sessionId)
- Modify: `src/tui/capabilities/invocation-presenter.ts` (capability completion on the chat tab)
- Modify: `src/cli/commands/tui.ts` (inject the EventLog into TuiApp's construction so chat/agent emitters can route through it)
- Test: `tests/tui/state.vitest.ts` (existing) + extend `tests/tui/app.vitest.ts` (existing) + add `tests/tui/capabilities/invocation-presenter.vitest.ts` for the dual-emit

**Interfaces:**
- Consumes: `appendTimelineEvent` keeps its in-memory semantics (transitional cache, D9). New: `appendTimelineEvent(state, event, ctx?)` where `ctx` carries `eventLog` + `sessionId` so the same call ALSO emits a typed log entry. OR: a thin wrapper `emitTimelineEvent(state, eventLog, sessionId, kind, payload)` that does both.
- Produces: every chat/agent timeline append also emits a log event (`chat.message`, `chat.response`, `agent.message`, `agent.reasoning`, `agent.decision`) with the originating sessionId. `timelineEvents[]` continues to be populated in parallel for transitional UX.

- [ ] **Step 1: Write the failing test**

Add to `tests/tui/state.vitest.ts` (existing):

```typescript
it('appendTimelineEvent emits a matching log entry when given an eventLog+sessionId', async () => {
  const state = createInitialTuiAppState();
  const log = new EventLog(state.values);                       // existing test pattern: tempDir
  await log.init();
  appendTimelineEvent(state.views.chat, { kind: 'user', text: 'hi' }, { eventLog: log, sessionId: 'chat-1' });
  const events = await log.readAll();
  expect(events).toHaveLength(1);
  expect(events[0]!.type).toBe('chat.message');
  expect(events[0]!.sessionId).toBe('chat-1');
});
```

(Exact log construction matches the existing test's pattern — check the file.)

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `appendTimelineEvent` does not accept an eventLog context, so the log is empty.

- [ ] **Step 3: Implement `appendTimelineEvent` dual-emit**

In `src/tui/state.ts`:
```typescript
export interface TimelineEmitContext {
  readonly eventLog: EventLog;
  readonly sessionId: string;
}

export function appendTimelineEvent(
  state: Pick<PerTabState, 'timelineEvents'>,
  event: TimelineEventInput,
  emit?: TimelineEmitContext,                       // optional — preserves Phase 3 callers
): TimelineEvent {
  const created = /* existing Phase 3 body */;
  if (emit) {
    // Emit a typed log entry in parallel (D7). Use canonical type names.
    const kindToType: Partial<Record<TimelineEvent['kind'], string>> = {
      user: 'chat.message',
      agent: 'chat.response',
      plan: 'chat.response',                          // existing 'plan' kind → log 'chat.response'
      toolCall: 'chat.message',                       // existing toolCall → chat.message (best-effort)
      approval: 'chat.message',                       // best-effort
    };
    const type = kindToType[event.kind];
    if (type) {
      void emit.eventLog.append({
        sessionId: emit.sessionId,
        actor: event.kind === 'user' ? 'user' : 'agent',
        type,
        payload: { text: (event as { text?: string }).text, detail: (event as { detail?: string }).detail },
      });
    }
  }
  return created;
}
```

(Adjust the kind→log-type mapping after confirming what `TimelineEvent['kind']` actually contains — it may be `user | agent | plan | approval | toolCall`. Map each to a sensible log type; drop entries that don't map cleanly.)

- [ ] **Step 4: Update call sites**

In `src/tui/app.ts`, every `appendTimelineEvent(perTab, { kind: 'user' | 'agent', text })` becomes `appendTimelineEvent(perTab, …, { eventLog: this.opts.eventLog, sessionId: this.opts.chatSessionId })` (the chat tab gets `chat-…`, the agent tab gets `agent-…` — pull the ids from `tui.ts` or compute them there).
In `src/tui/capabilities/invocation-presenter.ts`, the `appendTimelineEvent` call gets the same emit context.

- [ ] **Step 5: Update `tui.ts`**

Pass `eventLog` (and a per-tab `chatSessionId` / `agentSessionId`) into the `TuiApp` constructor — either as new optional fields on `TuiAppOptions` or via a small "context" object. The session ids can be derived deterministically: `${sessionId}-chat` and `${sessionId}-agent` (using the outer `sessionId` from line 43).

- [ ] **Step 6: Run tests + commit**

Run: `npx vitest run tests/tui/state.vitest.ts tests/tui/app.vitest.ts tests/tui/capabilities/invocation-presenter.vitest.ts --config vitest.config.mts`
```bash
git add src/tui/state.ts src/tui/app.ts src/tui/capabilities/invocation-presenter.ts src/cli/commands/tui.ts tests/tui/state.vitest.ts tests/tui/app.vitest.ts tests/tui/capabilities/invocation-presenter.vitest.ts
git commit -m "feat(capabilities): emit chat/agent entries to the EventLog with sessionId"
```

---

### Task 3: `RuntimeSnapshot` grows + `RuntimeCollector` wires both builders

**Files:**
- Modify: `src/tui/snapshot.ts` (add `timeline: readonly TimelineEntry[]` + `sessionId: string`)
- Modify: `src/tui/runtime-collector.ts` (constructor takes sessionId + timeline builder; sample() filters by sessionId + dispatches to both builders)
- Modify: `src/tui/runtime-collector.ts` (extend `IncrementalExecutionTraceBuilder` to expose `reset()` per D12)
- Modify: `src/tui/runtime/runtime-collector.ts` (any other code touching `trace` snapshot field)
- Modify: `src/cli/commands/tui.ts` (pass sessionId + the constructed TimelineBuilder into the collector)
- Test: extend `tests/tui/runtime/runtime-collector.vitest.ts`

**Interfaces:**
- Consumes: `ProjectionBuilder<T>` from Task 1; `TimelineBuilder` from Task 1; the new `RuntimeSnapshot.timeline` and `sessionId` fields.
- Produces: a collector that produces snapshots with both `trace` and `timeline`, both sessionId-scoped.

- [ ] **Step 1: Write the failing test**

Extend `tests/tui/runtime/runtime-collector.vitest.ts` with:

```typescript
  it('snapshot.timeline contains chat events for this collector session (D1)', async () => {
    const { log, append } = makeEventLog();
    await append('chat.message', { text: 'hi' }, 'chat-1');
    await append('tool.started', { toolCallId: 't1', toolName: 'x' }, 'chat-1');
    await append('agent.message', { text: 'thinking' }, 'agent-1');     // wrong session → filtered out
    const chat = new RuntimeCollectorImpl(log, store, 'chat-1', makeTimeline('chat-1'));
    await (chat as unknown as { start(): Promise<void> }).start.call(chat);
    const snap = await chat.snapshot();
    expect(snap?.timeline.map(e => e.kind)).toEqual(['chat.message']);
    expect(snap?.sessionId).toBe('chat-1');
  });

  it('snapshot.timeline + trace coexist (one read, two projections)', async () => {
    const { log, append } = makeEventLog();
    await append('chat.message', { text: 'hi' }, 'chat-1');
    await append('tool.started', { toolCallId: 't1', toolName: 'x' }, 'chat-1');
    await append('tool.completed', { toolCallId: 't1', toolName: 'x', status: 'success', durationMs: 5 }, 'chat-1');
    const c = new RuntimeCollectorImpl(log, store, 'chat-1', makeTimeline('chat-1'));
    await c.start();
    const snap = await c.snapshot();
    expect(snap?.timeline).toHaveLength(1);
    expect(snap?.timeline[0]!.kind).toBe('chat.message');
    expect(snap?.trace).toHaveLength(1);
    expect(snap?.trace[0]!.kind).toBe('completed');
  });

  it('beyond-head fallback resets BOTH builders (D12)', async () => {
    const { log, append } = makeEventLog();
    await append('chat.message', { text: 'hi' }, 'chat-1');
    const rejecting = { saved: 0, async load() { return { version: 1, cursor: log.serializeCursor(log.getCursor()), committedAt: Date.now() }; } } as never;   // works at head; force beyond-head:
    // Actually: build a cursor at seq=99 then advance the log to seq 2, then sample. The collector must reset BOTH builders.
    // (Implementation note for the implementer: use a cursor serialized before the events exist, then read it back — see the existing test pattern.)
  });
```

(The implementer should follow the existing test's `makeEventLog` pattern and write the beyond-head case concretely; the key invariants are: (1) snapshot.timeline has the chat event for THIS session only; (2) snapshot.trace has the tool event; (3) on beyond-head from the checkpoint, both builders reset so replay reconstructs.)

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — the constructor still has 2 args; the snapshot has no `timeline` field.

- [ ] **Step 3: Update `RuntimeSnapshot` + collector**

```typescript
// src/tui/snapshot.ts
import type { TimelineEntry } from './runtime/timeline-builder.js';

export interface RuntimeSnapshot {
  readonly trace: readonly ExecutionTraceEntry[];
  readonly timeline: readonly TimelineEntry[];          // NEW (D6)
  readonly workflow: WorkflowStateSnapshot | null;
  readonly totalEventCount: number;
  readonly lastEventAt: number | null;
  readonly sessionId: string;                          // NEW — projected session
}
```

```typescript
// src/tui/runtime-collector.ts
constructor(
  eventLog: EventLog,
  checkpointStore: ProjectionCheckpointStore,
  sessionId: string,                                    // NEW — the projection's session
  timelineBuilder = new TimelineBuilder(sessionId),     // NEW (defaults for tests)
  traceBuilder: IncrementalExecutionTraceBuilder = new IncrementalExecutionTraceBuilder(),
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
    const sessionBatch = batch.events.filter(e => e.sessionId === this.sessionId);
    this.timelineBuilder.update(sessionBatch);
    this.traceBuilder.update(sessionBatch);
    // ... build nextCache / nextCheckpoint, then commit atomically ...
    const nextCache: RuntimeSnapshot = {
      trace: this.traceBuilder.snapshot(),
      timeline: this.timelineBuilder.snapshot(),
      workflow: computeWorkflow(/* workflow batch filtered by sessionId */),
      totalEventCount: this.totalEventCount,
      lastEventAt: ...,
      sessionId: this.sessionId,
    };
    // D5/D5a commit
    this.checkpoint = nextCheckpoint;
    this.cache = nextCache;
  } catch (err) {
    if (err instanceof EventLogCursorError) {
      // D12 — both builders reset so replay from beginningCursor rebuilds
      // independent, in-memory projection state.
      this.timelineBuilder.reset();
      this.traceBuilder.reset();
      this.resetCheckpoint();
      return;
    }
    // else preserve (operational failure)
  }
}
```

Also ensure `IncrementalExecutionTraceBuilder` has a public `reset(): void` (Task 1's D12 requirement). If it's missing, add it as part of this task.

- [ ] **Step 4: Update `tui.ts`**

In `src/cli/commands/tui.ts`, derive the chat/agent session ids from the outer `sessionId` (e.g. `const chatSessionId = sessionId + '-chat'; const agentSessionId = sessionId + '-agent';`) and pass them to TuiApp construction, then to the RuntimeCollector for each tab (chat gets `chatSessionId`, agent gets `agentSessionId`). The collector wiring stays in `tui.ts` (it's not the TuiApp's concern — the collector lives at the bootstrap).

- [ ] **Step 5: Run tests + commit**

Run: `npx vitest run tests/tui/runtime/runtime-collector.vitest.ts --config vitest.config.mts` and `npx vitest run tests/tui --config vitest.config.mts`
```bash
git add src/tui/snapshot.ts src/tui/runtime-collector.ts src/cli/commands/tui.ts tests/tui/runtime/runtime-collector.vitest.ts
git commit -m "feat(capabilities): RuntimeCollector wires timeline+trace projections on one checkpoint"
```

---

### Task 4: Views consume `RuntimeSnapshot.timeline`

**Files:**
- Modify: `src/tui/views/chat-view.ts` (read `r.timeline.filter(e => e.kind.startsWith('chat.'))` instead of `r.timelineEvents`)
- Modify: `src/tui/views/agent-view.ts` (read `r.timeline.filter(e => e.kind.startsWith('agent.'))` instead of `r.timelineEvents`)
- Test: extend the existing view tests

**Interfaces:**
- Consumes: `RuntimeSnapshot.timeline` (Task 3).
- Produces: ChatView/AgentView render the log-projected timeline.

- [ ] **Step 1: Write the failing test**

Extend `tests/tui/views/chat-view.vitest.ts` (existing):

```typescript
  it('renders chat.message entries from RuntimeSnapshot.timeline (replacing r.timelineEvents)', () => {
    const state = createInitialTuiAppState();
    state.views.chat.timelineEvents.length = 0;          // transitional cache ignored
    state.runtime.chat.timeline = [
      { id: 'tl-1', kind: 'chat.message', sessionId: 'c1', startedAt: 1, text: 'hello', sourceEvents: { firstSequence: 1 } },
    ];
    // ...existing render ctx...
    expect(frame).toContain('hello');
  });
```

(Adapt to the existing test fixture pattern.)

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — ChatView still reads `r.timelineEvents` and the empty array produces no rows.

- [ ] **Step 3: Switch ChatView/AgentView to read `r.timeline`**

In `src/tui/views/chat-view.ts`:
- Replace `getOrderedTimeline(ctx.perTab.timelineEvents)` with `getOrderedTimeline(ctx.runtime.chat.timeline.filter(e => e.kind === 'chat.message' || e.kind === 'chat.response'))`.
- Make sure `ctx.runtime` is passed (existing — verify).

In `src/tui/views/agent-view.ts`:
- Replace `ctx.perTab.timelineEvents.filter(e => e.kind === 'user' || e.kind === 'agent')` with `ctx.runtime.agent.timeline.filter(e => e.kind === 'agent.message' || e.kind === 'agent.reasoning' || e.kind === 'agent.decision')`.

(Note: `TimelineEvent['kind']` from Phase 3 was `user | agent | plan | approval | toolCall`; `TimelineEntry['kind']` from Task 1 is the new typed union. The mapping from old to new is: `user → chat.message`, `agent → chat.response` (for chat tab) / `agent.message` (for agent tab). This depends on the legacy compatibility — keep `r.timelineEvents` populated in tandem during the transition so the view never blanks mid-migration.)

- [ ] **Step 4: Run tests + commit**

Run: `npx vitest run tests/tui/views/chat-view.vitest.ts tests/tui/views/agent-view.vitest.ts --config vitest.config.mts`
```bash
git add src/tui/views/chat-view.ts src/tui/views/agent-view.ts tests/tui/views/chat-view.vitest.ts tests/tui/views/agent-view.vitest.ts
git commit -m "feat(capabilities): ChatView/AgentView consume RuntimeSnapshot.timeline"
```

---

### Task 5: `tli` cleanup — remove the transitional `timelineEvents[]` cache

**Files:**
- Modify: `src/tui/state.ts` (remove `TimelineEventInput`/`appendTimelineEvent`/the per-tab `timelineEvents: TimelineEvent[]` field)
- Modify: `src/tui/app.ts` (drop the parallel write)
- Modify: `src/tui/capabilities/invocation-presenter.ts` (drop the parallel write)
- Modify: `src/tui/views/chat-view.ts` + `src/tui/views/agent-view.ts` (already switched in Task 4)
- Modify: `src/tui/views/dashboard-view.ts` + any other consumer of `perTab.timelineEvents`
- Test: update all view tests; add a regression that the `timelineEvents[]` field no longer exists on `PerTabState`

**Interfaces:**
- Produces: a single source of truth (the log) for the timeline.

- [ ] **Step 1: Find every consumer of `timelineEvents`**

Run: `rg "timelineEvents" src/ tests/ --include="*.ts" -l`

- [ ] **Step 2: Delete the field + helper + every parallel write**

```typescript
// src/tui/state.ts
export interface PerTabState {
  // ... remove: timelineEvents: TimelineEvent[]
  // Keep: inputBuffer, cursor, scrollOffset, pinnedBottom, searchQuery, etc.
}

export function appendTimelineEvent(...) { /* delete — no longer needed */ }
```

- [ ] **Step 3: Update every consumer**

For each file in the grep output, switch the read from `perTab.timelineEvents` to `runtime.chat.timeline` or `runtime.agent.timeline` as appropriate (matching Task 4's chat/agent split). Delete the parallel writes in app.ts and invocation-presenter.ts (Task 2's dual-emit becomes single-emit — the cache is gone).

- [ ] **Step 4: Run tests + commit**

Run: `npx vitest run tests/tui --config vitest.config.mts` — all tests should still pass because Task 4 already wired the views to `r.timeline`.
```bash
git add src/tui/state.ts src/tui/app.ts src/tui/capabilities/invocation-presenter.ts tests/tui/state.vitest.ts tests/tui/views tests/tui/app.vitest.ts tests/tui/capabilities/invocation-presenter.vitest.ts
git commit -m "refactor(capabilities): remove transitional timelineEvents[] cache"
```

---

### Task 6: Documentation + verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-capability-platform-phase6-design.md` (status → implemented)
- Create: `docs/capability-platform-phase6.md` (consumer note)

- [ ] **Step 1: Full build + full suites + D8 gate**

Run: `npm run build` and `npx vitest run tests/capability tests/tui tests/events --config vitest.config.mts`. Then `git diff --name-only origin/main -- src/capability/` → empty.

- [ ] **Step 2: Update spec status**

Change `**Status:** Approved — Ready for Implementation` → `**Status:** Implemented (Phase 6)`.

- [ ] **Step 3: Write the consumer doc**

```markdown
# ALiX Capability Platform — Phase 6 (Timeline Projection Unification)

The Runtime tab's Execution Trace and the chat/agent timeline now share one
canonical source: the append-only EventLog with sessionId-routed projections.

A `ProjectionBuilder<T>` contract (update / snapshot / reset) keeps
`IncrementalExecutionTraceBuilder`'s mature lifecycle semantics untouched
and adds a new append-only `TimelineBuilder` for chat/agent entries. The
`RuntimeCollector` reads once per sample, dispatches the batch to both
builders, saves ONE checkpoint, and publishes a snapshot with `trace` + `timeline`.

`sessionId` is the routing dimension — the chat tab and the agent tab have
distinct sessionIds stamped on every emitted event, and each tab's
projection filters `event.sessionId === projection.sessionId`. The
persistence layer does NOT know about UI topology. Future consumers
(multi-chat, background agent, web UI, CLI, detached workflow) are identical
projections over the same log.

`timelineEvents[]` is removed in Phase 6 — it was a transitional in-memory
cache while the views migrated to `RuntimeSnapshot.timeline`. The log is now
the only source of truth for the timeline.

The operator timeline and platform (src/capability/*) are unchanged.
```

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs(capabilities): Phase-6 usage note + spec status to implemented"
```

---

## Phase Completion Criteria

- ✅ `ProjectionBuilder<T>` contract (update / snapshot / reset) with both `IncrementalExecutionTraceBuilder` and `TimelineBuilder` implementing it.
- ✅ `TimelineBuilder` is append-only; implements `ProjectionBuilder<TimelineEntry>`; idempotent by event `seq`; `reset()` clears state.
- ✅ `RuntimeSnapshot` gains `timeline: readonly TimelineEntry[]` and `sessionId: string` (D6).
- ✅ `RuntimeCollectorImpl` runs ONE `readSince` per sample, dispatches to both builders, advances ONE checkpoint, publishes BOTH projections atomically (D5/D5a preserved).
- ✅ Beyond-head fallback resets BOTH builders (`traceBuilder.reset()` + `timelineBuilder.reset()`) and calls `resetCheckpoint()` (D12).
- ✅ `sessionId` plumbed through the log; chat/agent appends emit to the EventLog with the originating session (D7); `readSince` filters by it (D1/D3).
- ✅ Projection independence: `TimelineBuilder` and `ExecutionTraceBuilder` are independent — neither consumes the other's DTOs (D11).
- ✅ ChatView/AgentView consume `RuntimeSnapshot.timeline`; `timelineEvents[]` removed (D9 — cleanup).
- ✅ `src/capability/*`, Phase-5 cursor/checkpoint machinery — preserved (D13).
- ✅ Vitest green, `tsc --noEmit` clean.
