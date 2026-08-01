# ALiX Capability Platform Phase 5 — EventLog Incremental Projection Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Phase-4 migration (#321) and replace the trace's rebuild-every-poll with cursor-driven incremental processing — the infrastructure the future Timeline Projection phase will reuse. The projection consumes facts; it does not own them.

**Architecture:** `EventLog` gains an opaque, log-local, ownership-token-guarded `EventLogCursor` + `readSince(cursor)` with at-least-once semantics. The trace builder is refactored into one reconciliation engine (`createTraceState`/`reconcileEvents`/`materializeTrace`) shared by the pure `buildExecutionTrace` wrapper and a new stateful `IncrementalExecutionTraceBuilder` (`update`/`snapshot`). `RuntimeCollectorImpl` starts from `beginningCursor()`, consumes incrementally, and keeps a bounded `recentEvents` buffer for workflow accounting. The deprecated `RuntimeEventSnapshot`/`RuntimeSnapshot.events` shim is removed (#321).

**Tech Stack:** TypeScript (NodeNext ESM, strict), vitest, the existing TUI collector/snapshot/view system.

## Global Constraints

- **`timelineEvents[]`, ChatView, AgentView, the capability presenter, and `src/capability/*` are UNTOUCHED** (D8). The Timeline Projection phase reuses this infrastructure later.
- **Cursor is opaque, seq-backed, log-local, ownership-token-guarded.** Consumers only obtain/store/compare/pass cursors back; they never read internals. `cursorsEqual` returns `false` for foreign cursors, never throws; `readSince` throws on a foreign cursor (owner mismatch).
- **At-least-once semantics.** Returned cursor = highest seq successfully included; a consumer that fails before accepting the new cursor retries from the old one. The incremental builder MUST be idempotent for duplicate event sequences.
- **Cursor advances only after successful projection update** (D3a): `readSince(cursor)` → `builder.update(events)` → `checkpoint = { cursor: batch.cursor }`. If `update` throws, the cursor does not advance.
- **One reconciliation engine** (D4): `buildExecutionTrace` is a compatibility wrapper over `createTraceState` + `reconcileEvents` + `materializeTrace`. No second grouping algorithm.
- **Idempotent by event `seq`** (D5); terminal `tr-${firstSequence}` first-wins (duplicate terminal with a different payload does NOT rewrite history).
- **Mutable internal state, immutable published snapshots** (D6): `materializeTrace` always returns freshly-constructed DTOs, never references into internal maps. Snapshot immutability is enforced by a mandatory test.
- **`seenSequences` is bounded by the lifetime of the in-memory projection** (D3) — durable checkpointing/compaction is Phase 5.5+.
- **`recentEvents` is workflow-accounting input owned by `RuntimeCollector`, NOT a second execution projection.**
- **No durable checkpoint persistence in Phase 5** — `ProjectionCheckpoint` is in-memory only.
- NodeNext ESM (`import ... from "./x.js"`), strict TS, vitest.
- Every task ends green: `npx tsc -p tsconfig.json --noEmit` passes and the task's tests pass.

---

### Task 1: `EventLog` cursor — opaque, seq-backed, ownership-token-guarded

**Files:**
- Modify: `src/events/event-log.ts`
- Test: `tests/events/event-log-cursor.vitest.ts` (new)

**Interfaces:**
- Produces: `EventLogCursor` (exported branded type), `EventLog.beginningCursor()`, `EventLog.getCursor()`, `EventLog.readSince(cursor)`, `EventLog.cursorsEqual(a, b)`. Tasks 3-5 consume these.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/events/event-log-cursor.vitest.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../../src/events/event-log.js';
import type { EventLogCursor } from '../../src/events/event-log.js';

async function makeLog(): Promise<EventLog> {
  const dir = mkdtempSync(join(tmpdir(), 'alix-evt-'));
  const log = new EventLog(dir);
  await log.init();
  return log;
}

describe('EventLog cursor', () => {
  it('beginningCursor is before the first event and readSince(beginning) returns all events ascending', async () => {
    const log = await makeLog();
    await log.append({ sessionId: 's', actor: 'system', type: 'a', payload: {} });
    await log.append({ sessionId: 's', actor: 'system', type: 'b', payload: {} });
    const c = log.beginningCursor();
    const batch = await log.readSince(c);
    expect(batch.events.map(e => e.type)).toEqual(['a', 'b']);
    expect(batch.events.map(e => e.seq)).toEqual([1, 2]);
    expect(log.cursorsEqual(batch.cursor, c)).toBe(false); // advanced
  });

  it('readSince(current) returns empty + an equivalent cursor (no new events)', async () => {
    const log = await makeLog();
    await log.append({ sessionId: 's', actor: 'system', type: 'a', payload: {} });
    const first = await log.readSince(log.beginningCursor());
    const second = await log.readSince(first.cursor);
    expect(second.events).toEqual([]);
    expect(log.cursorsEqual(second.cursor, first.cursor)).toBe(true);
  });

  it('returned cursor is the highest seq included; re-reading the same range re-returns the same events (at-least-once)', async () => {
    const log = await makeLog();
    await log.append({ sessionId: 's', actor: 'system', type: 'a', payload: {} });
    await log.append({ sessionId: 's', actor: 'system', type: 'b', payload: {} });
    await log.append({ sessionId: 's', actor: 'system', type: 'c', payload: {} });
    const c = log.beginningCursor();
    const first = await log.readSince(c);
    expect(first.events.map(e => e.seq)).toEqual([1, 2, 3]);
    // Simulate "consumer failed after this read, retries from same cursor".
    const retry = await log.readSince(c);
    expect(retry.events.map(e => e.seq)).toEqual([1, 2, 3]);
  });

  it('getCursor skips existing history when used as a start', async () => {
    const log = await makeLog();
    await log.append({ sessionId: 's', actor: 'system', type: 'a', payload: {} });
    const head = log.getCursor();
    const batch = await log.readSince(head);
    expect(batch.events).toEqual([]);
    await log.append({ sessionId: 's', actor: 'system', type: 'b', payload: {} });
    const after = await log.readSince(head);
    expect(after.events.map(e => e.type)).toEqual(['b']);
  });

  it('readSince throws on a foreign cursor (owner mismatch); cursorsEqual returns false, never throws', async () => {
    const logA = await makeLog();
    const logB = await makeLog();
    await logA.append({ sessionId: 's', actor: 'system', type: 'a', payload: {} });
    const foreign = logA.beginningCursor();
    // Same-shape object built without the owner token is rejected by cursorsEqual.
    expect(logB.cursorsEqual(foreign, foreign)).toBe(false);
    await expect(logB.readSince(foreign)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/events/event-log-cursor.vitest.ts --config vitest.config.mts`
Expected: FAIL — `beginningCursor` / `readSince` / `cursorsEqual` do not exist.

- [ ] **Step 3: Implement the cursor in `src/events/event-log.ts`**

Add the branded type + internal representation + a per-instance owner token at module top:

```typescript
declare const eventLogCursorBrand: unique symbol;

/** Opaque, log-local position marker. Belongs to exactly one EventLog
 *  instance; consumers obtain/store/compare/pass back — never read internals.
 *  A cursor from another log is rejected by `readSince` (owner mismatch) and
 *  `cursorsEqual` returns false for it. */
export type EventLogCursor = { readonly [eventLogCursorBrand]: true };

interface InternalEventLogCursor {
  readonly seq: number;
  readonly owner: symbol;
}
```

Add a private owner token field to the class and the internal helper + public methods:

```typescript
export class EventLog {
  readonly path: string;
  private nextSeq = 1;
  private watchers: EventListener[] = [];
  private readonly owner = Symbol('EventLogCursorOwner');

  constructor(readonly sessionDir: string) {
    this.path = join(sessionDir, "events.jsonl");
  }

  /** The position before the first event — the start for full replay. */
  beginningCursor(): EventLogCursor {
    return this.makeCursor(0);
  }

  /** The current head cursor (for callers that want to skip existing history). */
  getCursor(): EventLogCursor {
    return this.makeCursor(this.nextSeq - 1);
  }

  /** Events with seq > cursor.seq, ascending. Returned cursor = highest seq
   *  successfully included (at-least-once: retrying from the input cursor
   *  re-reads the same events). Throws if the cursor belongs to another log. */
  async readSince(cursor: EventLogCursor): Promise<{
    readonly events: readonly AlixEvent[];
    readonly cursor: EventLogCursor;
  }> {
    const internal = this.unwrap(cursor);
    const events = await this.readAll();
    const newer = events.filter(e => (e.seq ?? 0) > internal.seq);
    const lastSeq = newer.length > 0 ? (newer[newer.length - 1]!.seq ?? internal.seq) : internal.seq;
    return { events: newer, cursor: this.makeCursor(lastSeq) };
  }

  /** Equality helper. Log-local: returns false (never throws) for a foreign
   *  cursor or a cursor this log does not own. */
  cursorsEqual(a: EventLogCursor, b: EventLogCursor): boolean {
    const ia = this.tryUnwrap(a);
    const ib = this.tryUnwrap(b);
    if (!ia || !ib) return false;
    return ia.seq === ib.seq;
  }

  private makeCursor(seq: number): EventLogCursor {
    return { [eventLogCursorBrand]: true, seq, owner: this.owner } as unknown as EventLogCursor;
  }

  /** Throws on a cursor this log does not own. */
  private unwrap(cursor: EventLogCursor): InternalEventLogCursor {
    const internal = this.tryUnwrap(cursor);
    if (!internal) throw new Error('EventLogCursor belongs to a different EventLog instance');
    return internal;
  }

  /** Returns null (not throw) for a foreign cursor — cursorsEqual depends on this. */
  private tryUnwrap(cursor: EventLogCursor): InternalEventLogCursor | null {
    const internal = cursor as unknown as InternalEventLogCursor;
    return internal.owner === this.owner ? internal : null;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/events/event-log-cursor.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Build + full suite + commit**

Run: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/events --config vitest.config.mts`
```bash
git add src/events/event-log.ts tests/events/event-log-cursor.vitest.ts
git commit -m "feat(capabilities): opaque seq-backed EventLog cursor with readSince"
```

---

### Task 2: Reconciliation engine refactor — `createTraceState` / `reconcileEvents` / `materializeTrace`

**Files:**
- Modify: `src/tui/runtime/execution-trace-builder.ts`
- Test: `tests/tui/runtime/execution-trace-builder.vitest.ts` (existing tests must still pass; add state-engine tests)

**Interfaces:**
- Consumes: nothing new (existing `buildExecutionTrace` logic).
- Produces: `ExecutionTraceState`, `MutableLifecycle`, `createTraceState()`, `reconcileEvents(state, events)`, `materializeTrace(state)` — and `buildExecutionTrace` becomes a compatibility wrapper. Tasks 3-5 consume these.

- [ ] **Step 1: Write the failing test**

Add these to `tests/tui/runtime/execution-trace-builder.vitest.ts`:

```typescript
import {
  buildExecutionTrace, createTraceState, reconcileEvents, materializeTrace,
  createExecutionTraceRetention, computeExecutionTrace,
  IncrementalExecutionTraceBuilder,
} from '../../src/tui/runtime/execution-trace-builder.js';

describe('reconciliation engine (createTraceState/reconcileEvents/materializeTrace)', () => {
  it('materializeTrace returns freshly-constructed DTOs, never internal map references', () => {
    const state = createTraceState();
    reconcileEvents(state, [evt('tool.started', { toolCallId: 'tc1', toolName: 'search' })]);
    const materialized = materializeTrace(state);
    // Mutating the returned DTO must not corrupt internal state.
    (materialized[0] as { title: string }).title = 'mutated';
    const again = materializeTrace(state);
    expect(again[0]!.title).toBe('tool.search');
  });

  it('buildExecutionTrace wrapper equals reconcile+materialize over the same input', () => {
    const events = [
      evt('tool.started', { toolCallId: 'tc1', toolName: 'search' }),
      evt('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 10 }),
    ];
    const state = createTraceState();
    reconcileEvents(state, events);
    expect(materializeTrace(state)).toEqual(buildExecutionTrace(events));
  });

  it('reconcileEvents is idempotent by event seq (replaying events does not duplicate)', () => {
    const events = [
      evt('tool.started', { toolCallId: 'tc1', toolName: 'search' }),
      evt('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 10 }),
    ];
    const state = createTraceState();
    reconcileEvents(state, events);
    const once = materializeTrace(state);
    reconcileEvents(state, events); // replay
    expect(materializeTrace(state)).toEqual(once);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/runtime/execution-trace-builder.vitest.ts --config vitest.config.mts`
Expected: FAIL — `createTraceState`/`reconcileEvents`/`materializeTrace`/`IncrementalExecutionTraceBuilder` do not exist.

- [ ] **Step 3: Refactor `execution-trace-builder.ts` into the reconciliation engine**

The current `buildExecutionTrace` loop (lines 122-196) becomes the engine. Replace it with:

```typescript
/** Internal mutable projection state. `readonly` here only prevents
 *  reassignment of the fields, NOT mutation of the Map/Set contents — this
 *  object is intentionally mutable. Never expose references returned from it. */
export interface ExecutionTraceState {
  readonly seenSequences: Set<number>;
  readonly openByKey: Map<string, MutableLifecycle>;
  readonly terminalById: Map<string, ExecutionTraceEntry>;
}

export interface MutableLifecycle {
  kind: ExecutionTraceKind;
  key: string;              // toolCallId / invocationId / timingId / workflowId / phase / approvalId / checkpointId
  title: string;
  /** Detail carried from intermediate events (e.g. tool stdout on tool.output). */
  detail?: string;
  startedAt: number;
  firstSequence: number;
  lastSequence: number;
}

export function createTraceState(): ExecutionTraceState {
  return { seenSequences: new Set(), openByKey: new Map(), terminalById: new Map() };
}

/** Reconcile new events into the projection state. Idempotent by event seq:
 *  an event whose seq is already seen is skipped. Terminal lifecycles are
 *  first-write-wins — a later terminal for the same tr-${firstSequence} does
 *  not rewrite the stored entry (its seq is still marked seen). */
export function reconcileEvents(state: ExecutionTraceState, events: readonly AlixEvent[]): void {
  for (const e of events) {
    const seqNum = e.seq ?? 0;
    if (state.seenSequences.has(seqNum)) continue;
    state.seenSequences.add(seqNum);

    const kind = kindOf(e.type);
    if (!kind) continue;
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    const key = keyOf(e.type, payload, seqNum);
    const ts = Date.parse(e.timestamp) || 0;
    const isTerminal = TERMINAL_TYPES.has(e.type);

    if (!isTerminal) {
      const mapKey = `${kind}:${key}`;
      let o = state.openByKey.get(mapKey);
      if (!o) {
        o = { kind, key, title: titleOf(kind, e.type, payload), startedAt: ts, firstSequence: seqNum, lastSequence: seqNum };
        state.openByKey.set(mapKey, o);
      } else {
        o.lastSequence = Math.max(o.lastSequence, seqNum);
      }
      if (e.type === TOOL_EVENT_TYPES.OUTPUT && o.detail === undefined) {
        const preview = payload.outputPreview;
        if (typeof preview === 'string' && preview.length > 0) o.detail = preview;
      }
      continue;
    }

    const mapKey = `${kind}:${key}`;
    const o = state.openByKey.get(mapKey);
    const status: ExecutionTraceEntry['status'] = STATUS_BY_TYPE[e.type] ?? 'completed';
    const id = o ? traceIdFor(o.firstSequence) : traceIdFor(seqNum);

    // First-write-wins: a duplicate terminal for an already-materialized
    // lifecycle is ignored (the terminal map already holds the winning entry).
    if (state.terminalById.has(id)) continue;

    if (o) {
      state.terminalById.set(id, {
        id, kind, status, title: o.title,
        detail: resolveDetail(payload, o.detail),
        startedAt: o.startedAt, completedAt: ts,
        durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : Math.max(0, ts - o.startedAt),
        sourceEvents: { firstSequence: o.firstSequence, lastSequence: Math.max(o.lastSequence, seqNum) },
      });
      state.openByKey.delete(mapKey);
    } else {
      // A terminal event without a recorded open — synthesize a completed entry.
      state.terminalById.set(id, {
        id, kind, status, title: titleOf(kind, e.type, payload),
        detail: resolveDetail(payload),
        startedAt: ts, completedAt: ts,
        durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : 0,
        sourceEvents: { firstSequence: seqNum, lastSequence: seqNum },
      });
    }
  }
}

/** Emit fresh immutable DTOs. Terminal entries oldest→newest by firstSequence,
 *  then open entries as running (oldest first, NO lastSequence). Never returns
 *  references into state maps. */
export function materializeTrace(state: ExecutionTraceState): ExecutionTraceEntry[] {
  const terminal = [...state.terminalById.values()]
    .sort((a, b) => a.sourceEvents.firstSequence - b.sourceEvents.firstSequence)
    .map(cloneEntry);
  const running = [...state.openByKey.values()]
    .sort((a, b) => a.firstSequence - b.firstSequence)
    .map(o => cloneEntry({
      id: traceIdFor(o.firstSequence), kind: o.kind, status: 'running', title: o.title,
      detail: o.detail, startedAt: o.startedAt,
      sourceEvents: { firstSequence: o.firstSequence },
    }));
  return [...terminal, ...running];
}

function cloneEntry(e: ExecutionTraceEntry): ExecutionTraceEntry {
  return {
    id: e.id, kind: e.kind, status: e.status, title: e.title,
    ...(e.detail !== undefined ? { detail: e.detail } : {}),
    startedAt: e.startedAt,
    ...(e.completedAt !== undefined ? { completedAt: e.completedAt } : {}),
    ...(e.durationMs !== undefined ? { durationMs: e.durationMs } : {}),
    sourceEvents: {
      firstSequence: e.sourceEvents.firstSequence,
      ...(e.sourceEvents.lastSequence !== undefined ? { lastSequence: e.sourceEvents.lastSequence } : {}),
    },
  };
}
```

`buildExecutionTrace` becomes the compatibility wrapper (D4):

```typescript
/** Compatibility wrapper over the shared reconciliation engine. Deterministic
 *  one-shot reconstruction (bootstrap/tests). The incremental builder uses the
 *  SAME engine — no second grouping algorithm. */
export function buildExecutionTrace(events: readonly AlixEvent[]): ExecutionTraceEntry[] {
  const state = createTraceState();
  reconcileEvents(state, events);
  return materializeTrace(state);
}
```

Keep `OpenLifecycle` interface? No — delete it; `MutableLifecycle` replaces it (same fields). The helper functions `kindOf`/`keyOf`/`titleOf`/`resolveDetail` and the sets stay unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tui/runtime/execution-trace-builder.vitest.ts --config vitest.config.mts`
Expected: PASS (existing Phase 4 tests + the 3 new engine tests).

**Note on ordering:** the refactor changes `buildExecutionTrace`'s terminal-entry ordering from "processing order" to "sorted by firstSequence" (via `materializeTrace`). This is a deterministic improvement — the old order was an artifact of the single-pass loop. Existing tests assert per-entry shapes and counts, not cross-entry terminal order, so they should hold; if any ordering-sensitive assertion exists, update it to the deterministic sort.

- [ ] **Step 5: Build + full TUI suite + commit**

Run: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui --config vitest.config.mts`
```bash
git add src/tui/runtime/execution-trace-builder.ts tests/tui/runtime/execution-trace-builder.vitest.ts
git commit -m "refactor(capabilities): extract reconciliation engine shared by pure builder + incremental facade"
```

---

### Task 3: `IncrementalExecutionTraceBuilder` — update/snapshot, idempotent

**Files:**
- Modify: `src/tui/runtime/execution-trace-builder.ts`
- Test: `tests/tui/runtime/execution-trace-builder.vitest.ts` (add incremental tests)

**Interfaces:**
- Consumes: `createTraceState`/`reconcileEvents`/`materializeTrace` (Task 2), `ExecutionTraceRetention`/`createExecutionTraceRetention` (Phase 4).
- Produces: `IncrementalExecutionTraceBuilder` with `update(events)` / `snapshot()`.

- [ ] **Step 1: Write the failing test**

Add to `tests/tui/runtime/execution-trace-builder.vitest.ts`:

```typescript
describe('IncrementalExecutionTraceBuilder', () => {
  it('update+snapshot equals buildExecutionTrace over the same input', () => {
    const events = [
      evt('tool.started', { toolCallId: 'tc1', toolName: 'search' }),
      evt('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 10 }),
    ];
    const builder = new IncrementalExecutionTraceBuilder();
    builder.update(events);
    expect(builder.snapshot()).toEqual(buildExecutionTrace(events));
  });

  it('preserves an open lifecycle across updates, then promotes it to terminal', () => {
    const builder = new IncrementalExecutionTraceBuilder();
    builder.update([evt('tool.started', { toolCallId: 'tc1', toolName: 'search' })]);
    expect(builder.snapshot()[0]!.status).toBe('running');
    builder.update([evt('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 25 })]);
    const after = builder.snapshot();
    expect(after).toHaveLength(1);
    expect(after[0]!.status).toBe('completed');
    expect(after[0]!.durationMs).toBe(25);
  });

  it('snapshot immutability — an earlier snapshot never changes after a later update (MANDATORY D6)', () => {
    const builder = new IncrementalExecutionTraceBuilder();
    builder.update([evt('tool.started', { toolCallId: 'tc1', toolName: 'search' })]);
    const before = builder.snapshot();
    expect(before[0]!.status).toBe('running');
    builder.update([evt('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 25 })]);
    const after = builder.snapshot();
    expect(before[0]!.status).toBe('running');   // earlier snapshot frozen
    expect(after[0]!.status).toBe('completed');  // later snapshot promoted
  });

  it('is idempotent by seq — replaying a batch leaves the projection unchanged', () => {
    const batch = [
      evt('tool.started', { toolCallId: 'tc1', toolName: 'search' }),
      evt('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 10 }),
    ];
    const builder = new IncrementalExecutionTraceBuilder();
    builder.update(batch);
    const once = builder.snapshot();
    builder.update(batch); // replay (e.g. consumer failed before advancing cursor)
    expect(builder.snapshot()).toEqual(once);
  });

  it('terminal first-wins — a later terminal with a different payload does not rewrite history', () => {
    const builder = new IncrementalExecutionTraceBuilder();
    builder.update([
      evt('tool.started', { toolCallId: 'tc1', toolName: 'search' }),
      evt('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 10 }),
    ]);
    const once = builder.snapshot();
    // A NEW seq (not a replay) carrying a conflicting terminal for the same lifecycle.
    builder.update([evt('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 999 })]);
    expect(builder.snapshot()).toEqual(once);
  });

  it('applies retention only after lifecycle reconciliation', () => {
    const retention = createExecutionTraceRetention(1);
    const builder = new IncrementalExecutionTraceBuilder(retention);
    builder.update([
      evt('tool.started', { toolCallId: 'tc1', toolName: 'a' }),
      evt('tool.completed', { toolCallId: 'tc1', toolName: 'a', status: 'success', durationMs: 1 }),
      evt('tool.started', { toolCallId: 'tc2', toolName: 'b' }),
      evt('tool.completed', { toolCallId: 'tc2', toolName: 'b', status: 'success', durationMs: 2 }),
      evt('tool.started', { toolCallId: 'tc3', toolName: 'c' }),
    ]);
    const out = builder.snapshot();
    expect(out.filter(e => e.status === 'completed')).toHaveLength(1); // keep-last-1 terminal
    expect(out.some(e => e.status === 'running')).toBe(true);          // running never evicted
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/runtime/execution-trace-builder.vitest.ts --config vitest.config.mts`
Expected: FAIL — `IncrementalExecutionTraceBuilder` does not exist.

- [ ] **Step 3: Implement the incremental builder**

Add to `execution-trace-builder.ts` (after `createExecutionTraceBuilder`):

```typescript
/** Stateful facade over the shared reconciliation engine. Holds mutable
 *  projection state; publishes fresh immutable snapshots after retention.
 *  Idempotent by event seq — safe against cursor at-least-once replays. */
export class IncrementalExecutionTraceBuilder {
  private readonly state: ExecutionTraceState = createTraceState();
  private readonly retention: ExecutionTraceRetention;

  constructor(retention: ExecutionTraceRetention = createExecutionTraceRetention()) {
    this.retention = retention;
  }

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/runtime/execution-trace-builder.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Build + full TUI suite + commit**

Run: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui --config vitest.config.mts`
```bash
git add src/tui/runtime/execution-trace-builder.ts tests/tui/runtime/execution-trace-builder.vitest.ts
git commit -m "feat(capabilities): incremental execution-trace builder — update/snapshot, idempotent by seq"
```

---

### Task 4: Collector integration — incremental consumption + `ProjectionCheckpoint`

**Files:**
- Modify: `src/tui/runtime-collector.ts`
- Modify: `src/tui/snapshot.ts` (add `RuntimeSnapshot.cursor`-agnostic fields — actually no: keep snapshot shape; see Step 3)
- Test: `tests/tui/runtime/runtime-collector.vitest.ts`

**Interfaces:**
- Consumes: `EventLog.beginningCursor`/`readSince` (Task 1), `IncrementalExecutionTraceBuilder` (Task 3).
- Produces: `ProjectionCheckpoint { cursor, updatedAt }` (in-memory only), incremental `RuntimeCollectorImpl` starting from `beginningCursor`.

- [ ] **Step 1: Write the failing test**

Update `tests/tui/runtime/runtime-collector.vitest.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { RuntimeCollectorImpl } from '../../src/tui/runtime-collector.js';
import type { EventLog, EventLogCursor } from '../../src/events/event-log.js';
import type { AlixEvent } from '../../src/events/types.js';

function makeEventLog(): { log: EventLog; append: (type: string, payload?: Record<string, unknown>) => Promise<void> } {
  let seq = 0;
  const events: AlixEvent[] = [];
  const owner = Symbol('test-owner');
  const makeCursor = (s: number) => ({ seq: s, owner }) as unknown as EventLogCursor;
  const beginning = makeCursor(0);
  const log = {
    beginningCursor: () => beginning,
    getCursor: () => makeCursor(seq),
    readSince: async (c: EventLogCursor) => {
      const internal = c as unknown as { seq: number; owner: symbol };
      if (internal.owner !== owner) throw new Error('foreign');
      const newer = events.filter(e => e.seq > internal.seq);
      const last = newer.length ? newer[newer.length - 1]!.seq : internal.seq;
      return { events: newer, cursor: makeCursor(last) };
    },
    cursorsEqual: (a: EventLogCursor, b: EventLogCursor) =>
      (a as unknown as { seq: number }).seq === (b as unknown as { seq: number }).seq,
  } as unknown as EventLog;
  return {
    log,
    append: async (type, payload = {}) => {
      seq++;
      events.push({ id: `e${seq}`, seq, version: 1, sessionId: 's', timestamp: new Date(seq * 1000).toISOString(), type, actor: 'system', payload });
    },
  };
}

describe('RuntimeCollectorImpl incremental', () => {
  it('starts from beginningCursor and consumes incrementally (no readAll in the loop)', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    const collector = new RuntimeCollectorImpl(log);
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);
    const snap = await collector.snapshot();
    expect(snap?.trace).toHaveLength(1);
    expect(snap?.trace[0]!.status).toBe('running');

    await append('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 10 });
    await sample.call(collector);
    const after = await collector.snapshot();
    expect(after?.trace[0]!.status).toBe('completed');
    expect(after?.trace).toHaveLength(1); // updated in place, not duplicated
  });

  it('builder failure does NOT advance the checkpoint — next sample re-reads the same events (D3a)', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    const collector = new RuntimeCollectorImpl(log);
    // Force builder.update to throw on the next sample.
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    const orig = collector as unknown as { builder: { update(e: unknown): void } };
    const failOnce = vi.spyOn(orig.builder, 'update').mockImplementationOnce(() => { throw new Error('boom'); });
    await sample.call(collector); // throws internally, caught, cache preserved
    const afterFail = await collector.snapshot();
    expect(afterFail?.trace).toHaveLength(0); // first sample failed before populating

    failOnce.mockRestore();
    await sample.call(collector);
    const afterRetry = await collector.snapshot();
    expect(afterRetry?.trace).toHaveLength(1);
    expect(afterRetry?.trace[0]!.status).toBe('running');
  });

  it('keeps the previous snapshot on a LATER readSince failure', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    const collector = new RuntimeCollectorImpl(log);
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);
    const before = await collector.snapshot();
    // Break readSince for the next sample.
    const origRead = log.readSince.bind(log);
    (log as unknown as { readSince: unknown }).readSince = async () => { throw new Error('io'); };
    await sample.call(collector);
    const after = await collector.snapshot();
    expect(after).toEqual(before);
    (log as unknown as { readSince: unknown }).readSince = origRead;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/runtime/runtime-collector.vitest.ts --config vitest.config.mts`
Expected: FAIL — the collector still calls `readAll()` and has no builder field.

- [ ] **Step 3: Rewrite `src/tui/runtime-collector.ts`**

Replace the sample path with incremental consumption. Keep the `RuntimeCollector` interface and the cache/snapshot contract. Add a `builder` field (so the D3a test can spy it) and a `recentEvents` buffer:

```typescript
import type { EventLog, EventLogCursor } from '../events/event-log.js';
import type { AlixEvent } from '../events/types.js';
import { IncrementalExecutionTraceBuilder } from './runtime/execution-trace-builder.js';
import type {
  RuntimeSnapshot,
  WorkflowStateSnapshot,
} from './snapshot.js';

/** In-memory projection checkpoint. NOT persisted (durability is Phase 5.5). */
export interface ProjectionCheckpoint {
  readonly cursor: EventLogCursor;
  readonly updatedAt: number;
}

export class RuntimeCollectorImpl implements RuntimeCollector {
  private cache: RuntimeSnapshot = {
    trace: [],
    workflow: null,
    totalEventCount: 0,
    lastEventAt: null,
  };
  private timer?: ReturnType<typeof setInterval>;
  private readonly eventLog: EventLog;
  private readonly builder = new IncrementalExecutionTraceBuilder();
  private checkpoint: ProjectionCheckpoint;
  /** Workflow-accounting input ONLY (not a second projection). Holds events
   *  since the last workflow.created boundary; trimmed once a workflow completes
   *  or a new one begins. */
  private recentEvents: AlixEvent[] = [];
  private totalEventCount = 0;

  constructor(eventLog: EventLog) {
    this.eventLog = eventLog;
    this.checkpoint = { cursor: eventLog.beginningCursor(), updatedAt: Date.now() };
  }

  start(): void {
    void this.sample();
    this.timer = setInterval(() => void this.sample(), 1_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async snapshot(): Promise<RuntimeSnapshot | null> {
    return this.cache;
  }

  /**
   * Consume the EventLog incrementally via readSince. Cursor advances ONLY
   * after a successful builder.update (D3a) — if update throws, the checkpoint
   * is unchanged and the next sample re-reads the same events (idempotent).
   * On any failure the previous cache is preserved so the dashboard never blanks.
   */
  private async sample(): Promise<void> {
    try {
      const batch = await this.eventLog.readSince(this.checkpoint.cursor);
      this.builder.update(batch.events);
      // Advance the checkpoint ONLY after a successful update.
      this.checkpoint = { cursor: batch.cursor, updatedAt: Date.now() };

      // Workflow accounting: append batch events, then trim to the last
      // workflow.created boundary (computeWorkflow only needs events since then).
      this.recentEvents = this.trimToActiveWorkflow([...this.recentEvents, ...batch.events]);

      const lastEvent = batch.events[batch.events.length - 1];
      if (lastEvent) {
        this.totalEventCount = Math.max(this.totalEventCount, lastEvent.seq ?? 0);
      }
      this.cache = {
        trace: this.builder.snapshot(),
        workflow: computeWorkflow(this.recentEvents),
        totalEventCount: this.totalEventCount,
        lastEventAt: lastEvent ? Date.parse(lastEvent.timestamp) || Date.now() : this.cache.lastEventAt,
      };
    } catch {
      // Keep previous cache on error — dashboard never blanks.
    }
  }

  /** Keep only the events from the most recent workflow.created onward. */
  private trimToActiveWorkflow(events: AlixEvent[]): AlixEvent[] {
    let lastCreated = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]!.type === 'workflow.created') { lastCreated = i; break; }
    }
    return lastCreated === -1 ? events : events.slice(lastCreated);
  }
}
```

Note: `lastEventAt` semantics change — it is now the last NEW event's timestamp (from the batch) rather than the newest of the last-100 flat list. `totalEventCount` is the highest seq seen (seq starts at 1, so it equals the event count). `RuntimeSnapshot` keeps its current shape (`trace`, `workflow`, `totalEventCount`, `lastEventAt`); the deprecated `events?` field is removed in Task 5.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/runtime/runtime-collector.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Build + full TUI suite + commit**

Run: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui --config vitest.config.mts`
```bash
git add src/tui/runtime-collector.ts tests/tui/runtime/runtime-collector.vitest.ts
git commit -m "feat(capabilities): RuntimeCollector consumes EventLog incrementally via cursor + checkpoint"
```

---

### Task 5: Resolve #321 — migrate dashboard-renderer to `trace`, remove the flat projection

**Files:**
- Modify: `src/tui/dashboard-renderer.ts` (RUNTIME panel "Last event:" row → last trace unit)
- Modify: `src/tui/snapshot.ts` (delete `RuntimeEventSnapshot`, remove `events?` from `RuntimeSnapshot`)
- Modify: `src/tui/runtime-collector.ts` (remove the now-dead `events`/`RuntimeEventSnapshot` references — already removed in Task 4's rewrite; verify)
- Test: `tests/tui/dashboard-renderer.vitest.ts` (update the runtime-panel fixture to `trace`)
- Test: `tests/tui/runtime/runtime-collector.vitest.ts` (verify no `events` assertion remains)

**Interfaces:**
- Consumes: `RuntimeSnapshot.trace` (the last trace unit for the dashboard row).
- Produces: zero `RuntimeEventSnapshot`/`RuntimeSnapshot.events` references in `src/` + `tests/`.

- [ ] **Step 1: Verify zero non-deprecated consumers**

Run: `rg "RuntimeEventSnapshot|RuntimeSnapshot\.events|runtime\.events|r\.events" src tests`
Expected: only `src/tui/snapshot.ts` (definitions), `src/tui/runtime-collector.ts` (already rewritten in Task 4 — confirm no flat mapping remains), `src/tui/dashboard-renderer.ts:275` (the row to migrate).

- [ ] **Step 2: Migrate the dashboard RUNTIME panel to `trace`**

In `src/tui/dashboard-renderer.ts`, replace the flat-event read:

```typescript
  const now = Date.now();
  const lastEvent = runtime && runtime.events && runtime.events.length > 0 ? runtime.events[0]! : null;
  const lastKind = lastEvent?.kind ?? "—";
  const lastAgo = lastEvent ? `${formatRelative(lastEvent.timestamp, now)}` : "";
```
with a trace read — the last trace unit is the operator-meaningful summary:

```typescript
  const now = Date.now();
  // "Last event" now means the last trace unit — the operator-meaningful
  // execution summary (e.g. "tool.search ✔ completed"), not a raw event kind.
  const trace = runtime?.trace ?? [];
  const lastTrace = trace.length > 0 ? trace[trace.length - 1]! : null;
  const lastKind = lastTrace ? `${lastTrace.title} ${lastTrace.status}` : "—";
  const lastAgo = lastTrace ? `${formatRelative(lastTrace.startedAt, now)}` : "";
```
The rest of the panel (metadata block, `paintMetaLine(canvas, ..., "Last event:", lastKind, lastAgo)`) is unchanged.

- [ ] **Step 3: Delete the deprecated types/field**

In `src/tui/snapshot.ts`:
- Remove `RuntimeEventSnapshot` interface.
- Remove `events?` from `RuntimeSnapshot` (keep `trace`, `workflow`, `totalEventCount`, `lastEventAt`).

- [ ] **Step 4: Update test fixtures**

`tests/tui/dashboard-renderer.vitest.ts` — any fixture asserting the runtime panel via `events` must switch to `trace` (a `RuntimeSnapshot` literal with `trace: [...]`). `tests/tui/runtime/runtime-collector.vitest.ts` — already trace-based; verify no `events` assertion. Run `npx tsc -p tsconfig.json --noEmit` and fix any fixture still referencing the removed field.

- [ ] **Step 5: Verify zero references + build + commit**

Run: `rg "RuntimeEventSnapshot|RuntimeSnapshot\.events|runtime\.events|r\.events" src tests` → zero. Then `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui --config vitest.config.mts`.
```bash
git add src/tui/dashboard-renderer.ts src/tui/snapshot.ts tests/tui/dashboard-renderer.vitest.ts tests/tui/runtime/runtime-collector.vitest.ts
git commit -m "refactor(capabilities): resolve #321 — dashboard reads trace, remove flat runtime projection"
```

---

### Task 6: Documentation + verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-capability-platform-phase5-design.md` (status → implemented)
- Create: `docs/capability-platform-phase5.md` (consumer note)

- [ ] **Step 1: Full build + full capability + TUI suites**

Run: `npm run build` and `npx vitest run tests/capability tests/tui tests/events --config vitest.config.mts`
Expected: clean, all pass.

- [ ] **Step 2: Update spec status**

Change `**Status:** Approved — Ready for Implementation` → `**Status:** Implemented (Phase 5)`.

- [ ] **Step 3: Write the consumer doc**

```markdown
# ALiX Capability Platform — Phase 5 (EventLog Incremental Projection Foundation)

The Runtime tab's Execution Trace now consumes the EventLog **incrementally**
via an opaque, log-local cursor (`EventLog.readSince`) instead of re-reading the
whole log every poll. The trace builder was refactored into a shared
reconciliation engine (`createTraceState`/`reconcileEvents`/`materializeTrace`)
used by both the pure `buildExecutionTrace` (bootstrap/tests) and the stateful
`IncrementalExecutionTraceBuilder` (update/snapshot). Idempotent by event
sequence, so cursor replays never duplicate entries; open lifecycles survive
across updates.

Issue #321 resolved: the deprecated flat `RuntimeEventSnapshot` /
`RuntimeSnapshot.events` projection is deleted — the dashboard RUNTIME panel now
reads the last trace unit.

The operator timeline (chat) is unchanged. The platform (src/capability/) is
untouched. Durable checkpoint persistence is deferred to a later phase.
```

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs(capabilities): Phase-5 usage note + spec status to implemented"
```

---

## Phase Completion Criteria

- ✅ `EventLog.readSince(cursor)` with opaque, log-local, ownership-token-guarded, at-least-once semantics; `beginningCursor`/`getCursor`/`cursorsEqual`.
- ✅ `IncrementalExecutionTraceBuilder.update/snapshot` shares the `createTraceState`/`reconcileEvents`/`materializeTrace` engine with the pure `buildExecutionTrace` wrapper (one algorithm).
- ✅ Idempotent by event `seq`; terminal `tr-${firstSequence}` first-wins; snapshot-immutability test green.
- ✅ `RuntimeCollectorImpl` starts from `beginningCursor`, consumes incrementally, and advances the cursor only after a successful update (D3a); `recentEvents` buffer feeds `computeWorkflow`; `ProjectionCheckpoint` is in-memory only.
- ✅ #321 resolved: `RuntimeEventSnapshot` + `RuntimeSnapshot.events?` deleted, dashboard-renderer reads `trace`, zero references remain.
- ✅ `timelineEvents[]`, ChatView, AgentView, capability presenter, `src/capability/*` untouched; vitest green; `tsc --noEmit` clean.
