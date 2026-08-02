# Capability Platform Phase 7 — Projection Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the projection pattern into a platform — `ProjectionRuntime` owns registration, generic dispatch, durable state, and reset coordination; the collector becomes blind to projection identity; ApprovalProjection proves a third, non-array snapshot shape lands with zero collector/snapshot changes.

**Architecture:** `RuntimeCollectorImpl` keeps temporal orchestration (polling, cursor, session filter, workflow accounting, snapshot publication) but delegates every per-projection operation to a `ProjectionRuntime` it holds. The runtime registers builders by string id, dispatches `updateAll`, extracts `snapshot<T>(id)`, exports/imports a registry-keyed durable envelope, and resets. The projection contract is generalized so the snapshot shape is arbitrary — `ProjectionBuilder<TSnapshot>` with `snapshot(): TSnapshot` — no longer assuming arrays. Adding a projection = implement `DurableProjectionBuilder`, register it in the composition root (`src/cli/commands/tui.ts`), never touch the collector.

**Tech Stack:** TypeScript (strict, NodeNext ESM `.js` specifiers), vitest (`tests/**/*.vitest.ts`). Files: `src/tui/runtime/projection-runtime.ts` (new), `src/tui/runtime/approval-projection.ts` (new), `src/tui/runtime/projection-builder.ts`, `src/tui/runtime/durable-projection-builder.ts`, `src/tui/runtime/timeline-builder.ts`, `src/tui/runtime/execution-trace-builder.ts`, `src/tui/runtime/projection-checkpoint-store.ts`, `src/tui/runtime-collector.ts`, `src/cli/commands/tui.ts`.

## Global Constraints

- NodeNext ESM (`.js` import specifiers), strict TypeScript.
- vitest tests under `tests/**/*.vitest.ts`.
- `EventLog` API stays additive; `src/capability/*` untouched.
- Checkpoint envelope `version` STAYS `1`. The 6.5 `state` field is renamed `projections`; **dual-shape load** (accept legacy `state` with keys `timeline`/`trace`) keeps existing 6.5 checkpoint files working. Save always writes the new `projections` shape. Keep the `state` field permanently — never "clean up" it while any 6.5-era checkpoint may exist.
- Durable state must be JSON-serializable plain objects only (no Maps/Sets/Date/undefined).
- **Dispatch order deterministic**: registration order is preserved for update/export/import/reset iteration; projections MUST NOT depend on execution order or on each other (D11 — each builder derives only from the EventLog batch).
- Duplicate `register(id)` throws a typed `ProjectionRegistrationError` (configuration corruption, not runtime failure).
- **Deterministic replay**: a builder's `update()` MUST be a pure function of its input events — `Date.now()`/`Math.random()` in an update path breaks replay (same log must produce same state). Event timestamps parsed strictly; a malformed timestamp THROWS rather than falling back to `Date.now()`.
- **Projection batch atomicity (failure isolation)**: if any projection throws during `updateAll`, the update cycle fails, the checkpoint MUST NOT commit, and partially advanced state MUST NOT be persisted. `updateAll` MUST propagate a builder throw (never swallow), so the collector's catch is reachable.
- **Replay-from-`beginningCursor()` remains the ONLY recovery for an invalid cursor**; persisted state never trusted on an invalid cursor (D12).
- The checkpoint layer MUST never know builder-specific state types — only `ProjectionState = Record<string, unknown>` / the opaque envelope.
- Commit convention: `feat(capabilities): ...` / `refactor(capabilities): ...` / `test(capabilities): ...` with `Co-Authored-By: Claude <noreply@anthropic.com>`.

---
---

### Task 1: Generalize the projection contract to arbitrary snapshot shapes

**Files:**
- Modify: `src/tui/runtime/projection-builder.ts` (interface)
- Modify: `src/tui/runtime/durable-projection-builder.ts` (interface)
- Modify: `src/tui/runtime/timeline-builder.ts` (implements clause)
- Modify: `src/tui/runtime/execution-trace-builder.ts` (implements clause)
- Modify: `tests/tui/runtime/timeline-builder-state.vitest.ts`, `tests/tui/runtime/execution-trace-builder-state.vitest.ts` (type-only assertions if any reference the old element generic)

**Interfaces:**
- Consumes: the existing `ProjectionBuilder<T>` / `DurableProjectionBuilder<T>` (current element generic).
- Produces (Task 2+ depend on these):
  ```ts
  // projection-builder.ts
  /** TSnapshot is the projection's snapshot shape — an array (timeline/trace)
   *  or any object (approval). The contract no longer assumes a list. */
  export interface ProjectionBuilder<TSnapshot> {
    update(events: readonly AlixEvent[]): void;
    snapshot(): TSnapshot;
    reset(): void;
  }

  // durable-projection-builder.ts
  export interface DurableProjectionBuilder<TSnapshot> extends ProjectionBuilder<TSnapshot> {
    exportState(): ProjectionState;      // ProjectionState = Record<string, unknown>
    importState(state: ProjectionState): void;
  }
  ```

- [ ] **Step 1: Change the two contract interfaces**

In `src/tui/runtime/projection-builder.ts`, change the generic parameter name and the doc:
```ts
export interface ProjectionBuilder<TSnapshot> {
  update(events: readonly AlixEvent[]): void;
  snapshot(): TSnapshot;
  reset(): void;
}
```
In `src/tui/runtime/durable-projection-builder.ts`:
```ts
export interface DurableProjectionBuilder<TSnapshot> extends ProjectionBuilder<TSnapshot> {
  exportState(): ProjectionState;
  importState(state: ProjectionState): void;
}
```
(Keep `ProjectionState = Record<string, unknown>` unchanged — the checkpoint layer only ever sees this.)

- [ ] **Step 2: Update the two existing builders' implements clauses (type-only)**

In `src/tui/runtime/timeline-builder.ts`, change `class TimelineBuilder implements DurableProjectionBuilder<...>` to:
```ts
export class TimelineBuilder implements DurableProjectionBuilder<readonly TimelineEntry[]> {
```
Its `snapshot(): readonly TimelineEntry[]` is unchanged — only the type argument changed.

In `src/tui/runtime/execution-trace-builder.ts`, change to:
```ts
export class IncrementalExecutionTraceBuilder implements DurableProjectionBuilder<readonly ExecutionTraceEntry[]> {
```
Its `snapshot(): readonly ExecutionTraceEntry[]` is unchanged.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: clean. If any test or file referenced the old element generic (`ProjectionBuilder<TimelineEntry>`), update the reference to the snapshot generic — but the two builders above are the only implementers, so nothing else should change.

- [ ] **Step 4: Run the builder suites (byte-for-byte behavior)**

Run: `npx vitest run tests/tui/runtime`
Expected: ALL pass unchanged — the two builders' behavior is untouched; this was a type-level generalization. Any failure = the generic change altered behavior; fix before committing.

- [ ] **Step 5: Commit**

```bash
git add src/tui/runtime/projection-builder.ts src/tui/runtime/durable-projection-builder.ts src/tui/runtime/timeline-builder.ts src/tui/runtime/execution-trace-builder.ts
git commit -m "refactor(capabilities): generalize projection contract to arbitrary snapshot shapes (Phase 7)"
```

---
---

### Task 2: `ProjectionRuntime` foundation

**Files:**
- Create: `src/tui/runtime/projection-runtime.ts`
- Create: `tests/tui/runtime/projection-runtime.vitest.ts`
- (No collector changes.)

**Interfaces:**
- Consumes: `DurableProjectionBuilder<TSnapshot>` (Task 1), `ProjectionState` (Task 1), `ProjectionStateSnapshot` (`src/tui/runtime/projection-checkpoint-store.ts`, exists), `AlixEvent` (`src/events/types.ts`).
- Produces (Task 3/4/5 depend on these):
  ```ts
  export class ProjectionRegistrationError extends Error { constructor(id: string); }
  export interface RegisteredProjection { readonly id: string; readonly builder: DurableProjectionBuilder<unknown>; }
  export class ProjectionRuntime {
    register(id: string, builder: DurableProjectionBuilder<unknown>): void;
    all(): readonly RegisteredProjection[];
    updateAll(events: readonly AlixEvent[]): void;
    snapshot<TSnapshot>(id: string): TSnapshot | undefined;   // undefined if unregistered
    exportState(): ProjectionStateSnapshot;                    // keyed by registered id
    importState(state: ProjectionStateSnapshot): void;
    resetAll(): void;
  }
  /** Pure tuple factory — the composition root decides what to register.
   *  No builder knowledge inside the helper. */
  export function createProjectionRuntime(
    registrations: ReadonlyArray<readonly [string, DurableProjectionBuilder<unknown>]>,
  ): ProjectionRuntime;
  ```

- [ ] **Step 1: Write the failing test** `tests/tui/runtime/projection-runtime.vitest.ts`

```ts
import { describe, it, expect } from 'vitest';
import { ProjectionRuntime, ProjectionRegistrationError, createProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';
import type { DurableProjectionBuilder, ProjectionState } from '../../../src/tui/runtime/durable-projection-builder.js';
import type { AlixEvent } from '../../../src/events/types.js';

/** Minimal durable builder: appends seqs to an array. */
function makeBuilder(initial: number[] = []): DurableProjectionBuilder<readonly number[]> {
  const entries: number[] = [...initial];
  return {
    update(events) { for (const e of events) entries.push(e.seq); },
    snapshot() { return [...entries]; },
    reset() { entries.length = 0; },
    exportState(): ProjectionState { return { entries: [...entries] }; },
    importState(state) { const s = state as { entries?: unknown }; if (Array.isArray(s.entries)) entries.splice(0, entries.length, ...s.entries as number[]); },
  };
}

/** Minimal OBJECT-shape builder: proves snapshot is not required to be an array. */
function makeObjectBuilder(initial = 0): DurableProjectionBuilder<{ count: number }> {
  let count = initial;
  return {
    update(events) { count += events.length; },
    snapshot() { return { count }; },
    reset() { count = 0; },
    exportState(): ProjectionState { return { count }; },
    importState(state) { const s = state as { count?: unknown }; if (typeof s.count === 'number') count = s.count; },
  };
}

function evt(seq: number): AlixEvent {
  return { id: `e${seq}`, seq, version: 1, sessionId: 's', timestamp: new Date(seq * 1000).toISOString(), type: 'chat.message', actor: 'system', payload: {} };
}

describe('ProjectionRuntime', () => {
  it('dispatches updateAll to every registered builder in registration order', () => {
    const a = makeBuilder(); const b = makeBuilder();
    const r = new ProjectionRuntime();
    r.register('a', a); r.register('b', b);
    r.updateAll([evt(1), evt(2)]);
    expect(a.snapshot()).toEqual([1, 2]);
    expect(b.snapshot()).toEqual([1, 2]);
  });

  it('snapshot returns undefined for an unregistered id', () => {
    const r = new ProjectionRuntime();
    expect(r.snapshot<readonly number[]>('nope')).toBeUndefined();
  });

  it('supports non-array snapshot shapes (object projections)', () => {
    const obj = makeObjectBuilder();
    const r = new ProjectionRuntime();
    r.register('obj', obj);
    r.updateAll([evt(1), evt(2)]);
    expect(r.snapshot<{ count: number }>('obj')).toEqual({ count: 2 });
  });

  it('registering a duplicate id throws ProjectionRegistrationError', () => {
    const r = new ProjectionRuntime();
    r.register('a', makeBuilder());
    expect(() => r.register('a', makeBuilder())).toThrow(ProjectionRegistrationError);
  });

  it('exportState/importState round-trip per-builder durable state keyed by id', () => {
    const r = new ProjectionRuntime();
    r.register('a', makeBuilder([1, 2])); r.register('b', makeBuilder([9]));
    const state = r.exportState();
    expect(state).toEqual({ a: { entries: [1, 2] }, b: { entries: [9] } });
    const r2 = new ProjectionRuntime();
    r2.register('b', makeBuilder()); r2.register('a', makeBuilder());
    r2.importState(state);
    expect(r2.snapshot<readonly number[]>('b')).toEqual([9]);
    expect(r2.snapshot<readonly number[]>('a')).toEqual([1, 2]);
  });

  it('importState ignores state for ids not registered (rolling-upgrade safety)', () => {
    const r = new ProjectionRuntime();
    r.register('a', makeBuilder());
    r.importState({ a: { entries: [1] }, futureProjection: { whatever: true } } as ProjectionStateSnapshot);
    expect(r.snapshot<readonly number[]>('a')).toEqual([1]);
    expect(r.snapshot<readonly unknown[]>('futureProjection')).toBeUndefined();
  });

  it('updateAll propagates a builder throw (never swallows) — batch isolation is the collector\'s job', () => {
    const bad: DurableProjectionBuilder<unknown> = {
      update() { throw new Error('boom'); },
      snapshot: () => undefined as never, reset() {}, exportState: () => ({}), importState() {},
    };
    const ok = makeBuilder();
    const r = new ProjectionRuntime();
    r.register('ok', ok); r.register('bad', bad);
    expect(() => r.updateAll([evt(1)])).toThrow('boom');
    expect(ok.snapshot()).toEqual([1]);   // registration order preserved: ok updated before bad threw
  });

  it('resetAll resets every registered builder', () => {
    const a = makeBuilder([1]); const b = makeBuilder([2]);
    const r = new ProjectionRuntime();
    r.register('a', a); r.register('b', b);
    r.resetAll();
    expect(a.snapshot()).toEqual([]);
    expect(b.snapshot()).toEqual([]);
  });

  it('createProjectionRuntime is a pure tuple factory', () => {
    const r = createProjectionRuntime([
      ['trace', makeBuilder()],
      ['timeline', makeBuilder()],
    ]);
    expect(r.all().map((p) => p.id).sort()).toEqual(['timeline', 'trace']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/runtime/projection-runtime.vitest.ts`
Expected: FAIL — module `../../../src/tui/runtime/projection-runtime.js` not found.

- [ ] **Step 3: Write the implementation** `src/tui/runtime/projection-runtime.ts`

```ts
import type { AlixEvent } from '../../events/types.js';
import type { DurableProjectionBuilder } from './durable-projection-builder.js';
import type { ProjectionStateSnapshot } from './projection-checkpoint-store.js';

export interface RegisteredProjection {
  readonly id: string;
  readonly builder: DurableProjectionBuilder<unknown>;
}

export class ProjectionRegistrationError extends Error {
  constructor(id: string) {
    super(`Projection already registered: ${id}`);
    this.name = 'ProjectionRegistrationError';
  }
}

/**
 * Owns the projection lifecycle: registration, deterministic dispatch,
 * snapshot extraction, durable builder state, and reset coordination.
 *
 * Invariants (Phase 7 spec):
 * - Registration order is preserved for update/export/import/reset iteration
 *   (a Map is insertion-ordered). Projections MUST NOT depend on execution
 *   order or on each other — each derives only from the EventLog batch (D11).
 * - The runtime never interprets a builder's state; it only carries
 *   ProjectionState = Record<string, unknown> through the envelope.
 * - snapshot() supports ANY snapshot shape (array or object); unregistered
 *   ids return undefined.
 */
export class ProjectionRuntime {
  private readonly projections = new Map<string, DurableProjectionBuilder<unknown>>();

  register(id: string, builder: DurableProjectionBuilder<unknown>): void {
    if (this.projections.has(id)) throw new ProjectionRegistrationError(id);
    this.projections.set(id, builder);
  }

  all(): readonly RegisteredProjection[] {
    return [...this.projections.entries()].map(([id, builder]) => ({ id, builder }));
  }

  updateAll(events: readonly AlixEvent[]): void {
    for (const { builder } of this.all()) builder.update(events);
  }

  snapshot<TSnapshot>(id: string): TSnapshot | undefined {
    return this.projections.get(id)?.snapshot() as TSnapshot | undefined;
  }

  exportState(): ProjectionStateSnapshot {
    const out: ProjectionStateSnapshot = {};
    for (const [id, builder] of this.projections) out[id] = builder.exportState();
    return out;
  }

  importState(state: ProjectionStateSnapshot): void {
    for (const [id, builder] of this.projections) {
      const s = state[id];
      if (s !== undefined) builder.importState(s);
    }
    // State for ids not registered is ignored — rolling-upgrade safety: an
    // older runtime reading a checkpoint written by a newer one drops
    // unknown projections.
  }

  resetAll(): void {
    for (const { builder } of this.all()) builder.reset();
  }
}

/** Pure tuple factory — the composition root decides what to register.
 *  The helper knows nothing about TimelineBuilder/TraceBuilder/etc. */
export function createProjectionRuntime(
  registrations: ReadonlyArray<readonly [string, DurableProjectionBuilder<unknown>]>,
): ProjectionRuntime {
  const runtime = new ProjectionRuntime();
  for (const [id, builder] of registrations) runtime.register(id, builder);
  return runtime;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/runtime/projection-runtime.vitest.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tui/runtime/projection-runtime.ts tests/tui/runtime/projection-runtime.vitest.ts
git commit -m "feat(capabilities): ProjectionRuntime registry + generic dispatch + tuple factory (Phase 7)"
```

---
---

### Task 3: Collector migration — blind to projection identity

**Files:**
- Modify: `src/tui/runtime-collector.ts` (options 50-66, fields 71-84, constructor 86-104, initializeCheckpoint 123-158, sample 212-306)
- Modify: `src/cli/commands/tui.ts` (collector construction ~114-138)
- Modify: `tests/tui/runtime/runtime-collector.vitest.ts`, `tests/tui/runtime/runtime-collector-state.vitest.ts`, `tests/tui/runtime/projection-independence.vitest.ts` (mechanical construction change only — assertions unchanged)

**Interfaces:**
- Consumes: `ProjectionRuntime` + `createProjectionRuntime` (Task 2).
- Produces: `RuntimeCollectorOptions.projectionRuntime: ProjectionRuntime` (replaces `timelineBuilder?`/`traceBuilder?`/`buildTimeline?`). Behavior is byte-for-byte equivalent.

- [ ] **Step 1: Change `RuntimeCollectorOptions` + fields + constructor**

In `src/tui/runtime-collector.ts`, replace the option fields (lines 50-66):
```ts
export interface RuntimeCollectorOptions {
  eventLog: EventLog;
  checkpointStore: ProjectionCheckpointStore;
  /** The session this collector projects. Events from other sessions are
   *  filtered out before any builder sees them (D1/D3). */
  sessionId: string;
  /** The projection runtime this collector hosts. Holds every registered
   *  projection (timeline, trace, ...); the collector is blind to their
   *  identity — it only dispatches, snapshots, and coordinates durable
   *  state through this object. */
  projectionRuntime: ProjectionRuntime;
}
```

Replace the fields (lines 71-76) and constructor (lines 86-104) — remove the three builder-specific fields; keep only the runtime:
```ts
  private readonly projectionRuntime: ProjectionRuntime;
```
Constructor: delete `this.buildTimeline = ...`, `this.timelineBuilder = ...`, `this.traceBuilder = ...`; add `this.projectionRuntime = opts.projectionRuntime;`. Add the import `import type { ProjectionRuntime } from './runtime/projection-runtime.js';` and update the options import.

- [ ] **Step 2: Rewrite the per-projection call sites to generic dispatch**

`initializeCheckpoint()` restore block (lines 140-143) becomes:
```ts
      const restored = loaded.projections ?? loaded.state;
      if (restored) this.projectionRuntime.importState(restored);
```
The invalid-cursor catch (lines 154-155) becomes:
```ts
      this.projectionRuntime.resetAll();
      this.resetCheckpoint();
```

`sample()` builder dispatch (lines 220-221) becomes:
```ts
      this.projectionRuntime.updateAll(sessionBatch);
```

`sample()` snapshot assembly (lines 245-246) becomes:
```ts
        trace: this.projectionRuntime.snapshot<readonly ExecutionTraceEntry[]>('trace') ?? [],
        timeline: this.projectionRuntime.snapshot<readonly TimelineEntry[]>('timeline') ?? [],
```
Add explicit type imports to the collector (neither entry type is currently imported directly):
```ts
import type { ExecutionTraceEntry } from './runtime/execution-trace.js';
import type { TimelineEntry } from './runtime/timeline-builder.js';
```
(`?? []` is required because `snapshot` returns `undefined` for an unregistered id — e.g. `buildTimeline:false` leaves timeline unregistered, exactly matching the old `[]`.)

The D12 catch in `sample()` (lines 297-298) becomes:
```ts
        this.projectionRuntime.resetAll();
        this.resetCheckpoint();
```

The durable-state save block (lines 270-279) becomes:
```ts
      await this.checkpointStore.save({
        version: CHECKPOINT_CONTAINER_VERSION,
        cursor: this.eventLog.serializeCursor(nextCheckpoint.cursor),
        committedAt: nextCheckpoint.committedAt,
        projections: this.projectionRuntime.exportState(),
      });
```

- [ ] **Step 3: Update `src/cli/commands/tui.ts` to build runtimes via the tuple factory**

Add `createProjectionRuntime` to the import from `../../tui/runtime/projection-runtime.js`. Replace the three collector constructions (lines 121-138) so the composition root decides what each collector hosts:
```ts
  const runtimeCollector = new RuntimeCollectorImpl({
    eventLog,
    checkpointStore: runtimeCheckpointStore,
    sessionId,
    projectionRuntime: createProjectionRuntime([
      ['trace', new IncrementalExecutionTraceBuilder()],
    ]),
  });
  const chatCollector = new RuntimeCollectorImpl({
    eventLog,
    checkpointStore: chatCheckpointStore,
    sessionId: chatSessionId,
    projectionRuntime: createProjectionRuntime([
      ['timeline', new TimelineBuilder(chatSessionId)],
      ['trace', new IncrementalExecutionTraceBuilder()],
    ]),
  });
  const agentCollector = new RuntimeCollectorImpl({
    eventLog,
    checkpointStore: agentCheckpointStore,
    sessionId: agentSessionId,
    projectionRuntime: createProjectionRuntime([
      ['timeline', new TimelineBuilder(agentSessionId)],
      ['trace', new IncrementalExecutionTraceBuilder()],
    ]),
  });
```
(`TimelineBuilder`/`IncrementalExecutionTraceBuilder` are imported in tui.ts already. The outer runtime collector registers trace only — no timeline, matching the old `buildTimeline:false`.)

- [ ] **Step 4: Update the collector tests' construction (mechanical)**

In each of `tests/tui/runtime/runtime-collector.vitest.ts`, `runtime-collector-state.vitest.ts`, and `projection-independence.vitest.ts`, replace constructions of the form:
```ts
new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, timelineBuilder: ..., buildTimeline: ..., traceBuilder: ... })
```
with:
```ts
new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder(SESSION_ID)], ['trace', new IncrementalExecutionTraceBuilder()]]) })
```
Add `import { createProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';` (and the builder value imports if not present) to each file. **Do NOT change any assertion** — behavior must be byte-for-byte equivalent. Use a `buildCollector(...)` helper per file if the same options repeat.

- [ ] **Step 5: Add a batch-atomicity test — a throwing projection must NOT commit the checkpoint**

In `tests/tui/runtime/runtime-collector.vitest.ts`, add a test. **Lifecycle note:** `start()` runs `initializeCheckpoint()` then an immediate `sample()`. The collector SWALLOWS a non-`EventLogCursorError` throw in `sample()` (the operational-failure catch keeps the old checkpoint + cache), so `start()` completes without throwing. The test asserts the durable commit never happened:
```ts
import { ProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';
import type { DurableProjectionBuilder } from '../../../src/tui/runtime/durable-projection-builder.js';

  it('a throwing projection does not commit the checkpoint (batch atomicity)', async () => {
    const { log, append } = makeEventLog();
    await append('chat.message', { text: 'hi' });
    const store = makeCheckpointStore();
    const throwing: DurableProjectionBuilder<unknown> = {
      update() { throw new Error('boom'); },
      snapshot: () => undefined as never, reset() {}, exportState: () => ({}), importState() {},
    };
    const runtime = new ProjectionRuntime();
    runtime.register('bad', throwing);
    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, projectionRuntime: runtime });
    await collector.start();             // initializeCheckpoint + first sample; the sample's update throws and is swallowed
    expect(store.saved.length).toBe(0);  // no durable commit
    expect((collector as unknown as { checkpoint: { committedAt: number } }).checkpoint.committedAt).toBe(0);
    collector.stop();
  });
```
> Use the file's existing `makeEventLog`/`makeCheckpointStore` helpers and the `checkpoint` access pattern already present in that file.

- [ ] **Step 6: Run the full runtime suite**

Run: `npx vitest run tests/tui/runtime`
Expected: ALL pass — including the D12 beyond-head test, the Phase-6.5 invalid-cursor-with-state test, and the new batch-atomicity test. Any failure = a behavior regression from the migration; fix before committing.

- [ ] **Step 7: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: clean.

- [ ] **Step 8: Static acceptance check — ProjectionRuntime is the ONLY owner of projection ops**

Run:
```bash
grep -nE '\.(update|reset|exportState|importState)\(' src/tui/runtime-collector.ts
grep -nE 'snapshot\(' src/tui/runtime-collector.ts
```
Expected: the ONLY matches are `this.projectionRuntime.updateAll(` / `this.projectionRuntime.resetAll(` / `this.projectionRuntime.exportState(` / `this.projectionRuntime.importState(` / `this.projectionRuntime.snapshot<...>(...)`. There MUST be no bare `this.timelineBuilder.`, `this.traceBuilder.`, or a per-id `if`/`switch`. (A hidden `this.traceBuilder.reset()` would pass tests but violates the platform goal — grep catches it.)

- [ ] **Step 9: Commit**

```bash
git add src/tui/runtime-collector.ts src/cli/commands/tui.ts tests/tui/runtime/runtime-collector.vitest.ts tests/tui/runtime/runtime-collector-state.vitest.ts tests/tui/runtime/projection-independence.vitest.ts
git commit -m "refactor(capabilities): collector hosts ProjectionRuntime, blind to projection identity (Phase 7)"
```

---
---

### Task 4: Registry-keyed durable envelope (`state` → `projections`)

**Files:**
- Modify: `src/tui/runtime/projection-checkpoint-store.ts` (envelope 19-29, load 54-75)
- Modify: `tests/tui/runtime/projection-checkpoint-store.vitest.ts`, `tests/tui/runtime/runtime-collector-state.vitest.ts`
- (The collector's restore already reads both shapes from Task 3 Step 2 — verify.)

**Interfaces:**
- Consumes: `ProjectionStateSnapshot` (existing), `ProjectionRuntime.exportState/importState` (Task 2).
- Produces: `PersistedProjectionCheckpoint` gains `readonly projections?: ProjectionStateSnapshot` and keeps `readonly state?: ProjectionStateSnapshot` (legacy 6.5). Version STAYS `1`.

- [ ] **Step 1: Document the version-1 dual-shape contract on the envelope**

In `src/tui/runtime/projection-checkpoint-store.ts`, update the `PersistedProjectionCheckpoint` doc (lines 19-29):
```ts
/**
 * Version 1 contains two historical shapes:
 *   Phase 6.5: state: { timeline?, trace? }            (read-only legacy)
 *   Phase 7:   projections: { <id>: ProjectionState }  (always written)
 * load() accepts BOTH; save() always writes `projections`. The `state` field
 * is kept permanently — never "clean it up" while any 6.5-era checkpoint file
 * may still exist.
 */
export interface PersistedProjectionCheckpoint {
  readonly version: 1;
  readonly cursor: string;
  readonly committedAt: number;
  readonly projections?: ProjectionStateSnapshot;   // Phase 7
  readonly state?: ProjectionStateSnapshot;          // Phase 6.5 legacy
}
```
Also add the boundary doc to `ProjectionStateSnapshot` (lines 13-17):
```ts
/**
 * The projection-state portion of the checkpoint envelope ONLY. Cursor and
 * commit metadata belong to PersistedProjectionCheckpoint — a consumer of
 * ProjectionRuntime.exportState() gets projection state, never a full
 * checkpoint envelope.
 */
export type ProjectionStateSnapshot = Record<string, ProjectionState>;
```

- [ ] **Step 2: Write the failing test** — add to `tests/tui/runtime/projection-checkpoint-store.vitest.ts`

```ts
  it('loads both the Phase-7 (projections) and Phase-6.5 legacy (state) shapes, version 1', async () => {
    // Phase 7 shape round-trips
    await store7.save({ version: 1, cursor: '{"version":1,"seq":3}', committedAt: 1, projections: { trace: { seenSequences: [] } } });
    const loaded7 = await store7.load();
    expect(loaded7?.projections).toEqual({ trace: { seenSequences: [] } });
    expect(loaded7?.version).toBe(1);

    // Phase 6.5 legacy shape still loads (state preserved, version 1)
    const loadedLegacy = await legacyStore.load();
    expect(loadedLegacy?.state).toEqual({ timeline: { version: 1, entries: [] } });
    expect(loadedLegacy?.version).toBe(1);

    // both present → projections wins (save always writes projections)
    // (covered by a dual-present fixture if the implementer wants; otherwise skip)
  });
```
> Use the file's existing `mkdtemp`-per-store pattern; write the legacy file directly (`writeFile`) with a `state` key and assert it loads. This snippet is a shape guide — the real assertions that matter: (1) `projections` save→load round-trips; (2) a legacy `state` file loads with `state` preserved + `version === 1`; (3) a non-object envelope still returns null.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/tui/runtime/projection-checkpoint-store.vitest.ts`
Expected: FAIL — `PersistedProjectionCheckpoint` has no `projections` field (type error) and `load` rejects it.

- [ ] **Step 4: Extend the envelope + load**

Envelope (lines 24-29): add `readonly projections?: ProjectionStateSnapshot;` alongside `state`.

`load()` (lines 54-75): after the existing `state` validation block, add:
```ts
    if (parsed.projections !== undefined) {
      if (typeof parsed.projections !== 'object' || parsed.projections === null || Array.isArray(parsed.projections)) return null;
    }
```
and in the return object, preserve whichever is present:
```ts
    return {
      version: CHECKPOINT_CONTAINER_VERSION,
      cursor: parsed.cursor,
      committedAt: parsed.committedAt,
      ...(parsed.state !== undefined ? { state: parsed.state } : {}),
      ...(parsed.projections !== undefined ? { projections: parsed.projections } : {}),
    };
```

- [ ] **Step 5: Update `runtime-collector-state.vitest.ts` for the new save shape**

Change the test seeds that call `store.save({ ..., state: ... })` to `store.save({ ..., projections: ... })`, and the assertions reading `lastSave.state` to `lastSave.projections`. Add one legacy-compat test: seed a checkpoint with `state: { timeline: { version: 1, entries: [...] }, trace: {...} }` and assert a fresh collector restores the timeline entries (legacy envelope still honored). Keep the invalid-cursor-with-persisted-state test but seed via `projections`.

- [ ] **Step 6: Run the runtime + store suites**

Run: `npx vitest run tests/tui/runtime`
Expected: ALL pass (store dual-shape, collector legacy + new shape, invalid-cursor-discards-state).

- [ ] **Step 7: Commit**

```bash
git add src/tui/runtime/projection-checkpoint-store.ts tests/tui/runtime/projection-checkpoint-store.vitest.ts tests/tui/runtime/runtime-collector-state.vitest.ts
git commit -m "feat(capabilities): registry-keyed durable envelope, dual-shape legacy load (Phase 7)"
```

---
---

### Task 5: ApprovalProjection — first registry-native projection

**Files:**
- Create: `src/tui/runtime/approval-projection.ts`
- Create: `tests/tui/runtime/approval-projection.vitest.ts`
- Modify: `src/cli/commands/tui.ts` (register approval on the runtime collector's runtime only)
- **No changes to `RuntimeCollectorImpl`, `RuntimeSnapshot`, or the checkpoint transaction flow** (acceptance criterion).

**Interfaces:**
- Consumes: `DurableProjectionBuilder<TSnapshot>` (Task 1), `ProjectionState`, `AlixEvent`, `ProjectionRuntime` (via the composition root).
- Produces:
  ```ts
  export interface ApprovalProjectionEntry {
    readonly approvalId: string;               // identity
    readonly prompt?: string;
    readonly toolName?: string;
    readonly status: 'pending' | 'approved' | 'denied' | 'edited'
      | 'expired' | 'revoked' | 'consumed' | 'resumed';
    readonly requestedAt: number;              // Date.parse(e.timestamp), throws on malformed
    readonly completedAt?: number;             // set on terminal; Date.parse(e.timestamp)
  }
  export interface ApprovalProjectionSnapshot {
    readonly pending: readonly ApprovalProjectionEntry[];
    readonly completed: readonly ApprovalProjectionEntry[];
  }
  export const MAX_COMPLETED = 50;
  export class ApprovalProjection implements DurableProjectionBuilder<ApprovalProjectionSnapshot> {
    update(events: readonly AlixEvent[]): void;
    snapshot(): ApprovalProjectionSnapshot;    // { pending, completed }, NOT a flat array
    reset(): void;
    exportState(): ProjectionState;            // { pending, completed }
    importState(state: ProjectionState): void;
  }
  ```

- [ ] **Step 1: Write the failing test** `tests/tui/runtime/approval-projection.vitest.ts`

```ts
import { describe, it, expect } from 'vitest';
import { ApprovalProjection, MAX_COMPLETED } from '../../../src/tui/runtime/approval-projection.js';
import type { AlixEvent } from '../../../src/events/types.js';

function evt(type: string, payload: Record<string, unknown>, seq: number, ts = seq * 1000): AlixEvent {
  return { id: `e${seq}`, seq, version: 1, sessionId: 's', timestamp: new Date(ts).toISOString(), type, actor: 'system', payload };
}
function requested(seq: number, approvalId: string, prompt = 'run?', toolName?: string): AlixEvent {
  return evt('approval.requested', { approvalId, prompt, ...(toolName ? { toolCallId: 't1', toolName } : {}) }, seq);
}
function resolved(seq: number, approvalId: string, decision: 'approved' | 'denied' | 'edited'): AlixEvent {
  return evt('approval.resolved', { approvalId, decision }, seq);
}

describe('ApprovalProjection', () => {
  it('requested creates a pending entry; resolved moves it to completed', () => {
    const p = new ApprovalProjection();
    p.update([requested(1, 'a1', 'run?', 'search')]);
    expect(p.snapshot().pending).toHaveLength(1);
    expect(p.snapshot().pending[0]!.status).toBe('pending');
    p.update([resolved(2, 'a1', 'approved')]);
    expect(p.snapshot().pending).toHaveLength(0);
    expect(p.snapshot().completed).toHaveLength(1);
    expect(p.snapshot().completed[0]!.status).toBe('approved');
    expect(p.snapshot().completed[0]!.completedAt).toBe(2 * 1000);
  });

  it('completed is bounded by MAX_COMPLETED (FIFO drop of oldest)', () => {
    const p = new ApprovalProjection();
    const ids = Array.from({ length: MAX_COMPLETED + 5 }, (_, i) => `a${i}`);
    const events: AlixEvent[] = [];
    ids.forEach((id, i) => { events.push(requested(i * 2 + 1, id)); events.push(resolved(i * 2 + 2, id, 'approved')); });
    p.update(events);
    const completed = p.snapshot().completed;
    expect(completed).toHaveLength(MAX_COMPLETED);
    expect(completed.some((e) => e.approvalId === 'a0')).toBe(false);      // oldest 5 dropped
    expect(completed.some((e) => e.approvalId === `a${MAX_COMPLETED + 4}`)).toBe(true);
  });

  it('ignores non-approval events and unknown approval ids', () => {
    const p = new ApprovalProjection();
    p.update([evt('chat.message', { text: 'hi' }, 1), resolved(2, 'nope', 'denied')]);
    expect(p.snapshot()).toEqual({ pending: [], completed: [] });
  });

  it('resumed marks a pending entry resumed and stays pending; resume.failed is ignored', () => {
    const p = new ApprovalProjection();
    p.update([requested(1, 'a1'), evt('approval.resumed', { approvalId: 'a1' }, 2)]);
    expect(p.snapshot().pending).toHaveLength(1);
    expect(p.snapshot().pending[0]!.status).toBe('resumed');
    p.update([evt('approval.resume.failed', { approvalId: 'a1' }, 3)]);
    expect(p.snapshot().pending).toHaveLength(1);          // still pending
    expect(p.snapshot().pending[0]!.status).toBe('resumed');
  });

  it('requested after a completed lifecycle with the same id starts a NEW lifecycle', () => {
    const p = new ApprovalProjection();
    p.update([requested(1, 'a1'), resolved(2, 'a1', 'approved')]);
    p.update([requested(3, 'a1')]);
    expect(p.snapshot().pending).toHaveLength(1);
    expect(p.snapshot().pending[0]!.requestedAt).toBe(3 * 1000);   // NEW lifecycle
    expect(p.snapshot().completed).toHaveLength(1);               // old completed retained
  });

  it('throws on a malformed event timestamp (deterministic replay)', () => {
    const p = new ApprovalProjection();
    const bad = { ...requested(1, 'a1'), timestamp: 'not-a-date' };
    expect(() => p.update([bad])).toThrow(/timestamp/);
  });

  it('exportState/importState round-trips pending + completed', () => {
    const p = new ApprovalProjection();
    p.update([requested(1, 'a1'), requested(2, 'a2'), resolved(3, 'a1', 'denied')]);
    const state = p.exportState();
    const p2 = new ApprovalProjection();
    p2.importState(state);
    expect(p2.snapshot().pending.find((e) => e.approvalId === 'a2')?.status).toBe('pending');
    expect(p2.snapshot().completed.find((e) => e.approvalId === 'a1')?.status).toBe('denied');
  });

  it('reset clears pending and completed', () => {
    const p = new ApprovalProjection();
    p.update([requested(1, 'a1'), resolved(2, 'a1', 'approved')]);
    p.reset();
    expect(p.snapshot()).toEqual({ pending: [], completed: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/runtime/approval-projection.vitest.ts`
Expected: FAIL — module `../../../src/tui/runtime/approval-projection.js` not found.

- [ ] **Step 3: Write the implementation** `src/tui/runtime/approval-projection.ts`

```ts
import type { AlixEvent } from '../../events/types.js';
import type { DurableProjectionBuilder, ProjectionState } from './durable-projection-builder.js';

/** A single approval's projection entry. Immutable DTO. */
export interface ApprovalProjectionEntry {
  readonly approvalId: string;
  readonly prompt?: string;
  readonly toolName?: string;
  readonly status: 'pending' | 'approved' | 'denied' | 'edited'
    | 'expired' | 'revoked' | 'consumed' | 'resumed';
  readonly requestedAt: number;
  readonly completedAt?: number;
}

/** The projection's explicit snapshot shape — an object, NOT an array. */
export interface ApprovalProjectionSnapshot {
  readonly pending: readonly ApprovalProjectionEntry[];
  readonly completed: readonly ApprovalProjectionEntry[];
}

/** Deterministic cap on completed history — NOT a time window (clock/replay-safe). */
export const MAX_COMPLETED = 50;

/** Events that close a pending approval (move it to completed). */
const TERMINAL_TYPES = new Set([
  'approval.resolved', 'approval.expired', 'approval.consumed', 'approval.revoked',
]);

/** Strict timestamp parse — a malformed event timestamp breaks determinism. */
function parseTimestamp(e: AlixEvent): number {
  const t = Date.parse(e.timestamp);
  if (!Number.isFinite(t)) throw new Error(`approval projection: invalid event timestamp on seq ${e.seq}`);
  return t;
}

function entryFrom(e: AlixEvent): { approvalId?: string; prompt?: string; toolName?: string } {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  return {
    approvalId: typeof p.approvalId === 'string' ? p.approvalId : undefined,
    prompt: typeof p.prompt === 'string' ? p.prompt : undefined,
    toolName: typeof p.toolName === 'string' ? p.toolName : undefined,
  };
}

/**
 * State-machine / active-state projection — a third distinct style alongside
 * append-only (timeline) and lifecycle-reconciliation (trace). Tracks pending
 * approvals and a bounded completed history. Hosted on the outer (runtime)
 * collector because approval.* events carry the outer sessionId.
 *
 * Identity/reconciliation (deterministic, spec): identity = approvalId.
 * - requested(id): new pending entry unless one is already pending (a
 *   completed entry with the same id does NOT block a new lifecycle).
 * - terminal event (resolved/expired/consumed/revoked): acts ONLY on a pending
 *   entry; marks it + completedAt and moves to completed (newest→oldest,
 *   bounded by MAX_COMPLETED). Unknown id → no-op.
 * - resumed (Option A): a pending entry's status is set to 'resumed'; it STAYS
 *   pending. resume.failed is NOT terminal (a failed resume is transient).
 * - update() is a pure function of its input events (deterministic replay).
 */
export class ApprovalProjection implements DurableProjectionBuilder<ApprovalProjectionSnapshot> {
  private pending = new Map<string, ApprovalProjectionEntry>();
  private completed: ApprovalProjectionEntry[] = [];

  update(events: readonly AlixEvent[]): void {
    for (const e of events) {
      const { approvalId, prompt, toolName } = entryFrom(e);
      if (!approvalId) continue;
      if (e.type === 'approval.requested') {
        if (!this.pending.has(approvalId)) {
          this.pending.set(approvalId, {
            approvalId, prompt, toolName,
            status: 'pending',
            requestedAt: parseTimestamp(e),
          });
        }
        // id already pending → idempotent replay of the same request, no-op
      } else if (e.type === 'approval.resumed') {
        const existing = this.pending.get(approvalId);
        if (existing) this.pending.set(approvalId, { ...existing, status: 'resumed' });
        // resume.failed is ignored — not a terminal event
      } else if (TERMINAL_TYPES.has(e.type)) {
        const existing = this.pending.get(approvalId);
        if (!existing) continue;                    // unknown id → no-op
        const p = (e.payload ?? {}) as Record<string, unknown>;
        const status: ApprovalProjectionEntry['status'] = e.type === 'approval.resolved'
          ? (typeof p.decision === 'string' && ['approved', 'denied', 'edited'].includes(p.decision) ? p.decision as ApprovalProjectionEntry['status'] : 'resolved')
          : e.type === 'approval.expired' ? 'expired'
          : e.type === 'approval.consumed' ? 'consumed'
          : 'revoked';
        const done: ApprovalProjectionEntry = { ...existing, status, completedAt: parseTimestamp(e) };
        this.pending.delete(approvalId);
        this.completed = [done, ...this.completed].slice(0, MAX_COMPLETED);
      }
    }
  }

  /** Object snapshot shape: pending (request order), completed (newest→oldest). */
  snapshot(): ApprovalProjectionSnapshot {
    return {
      pending: [...this.pending.values()],
      completed: [...this.completed],
    };
  }

  reset(): void {
    this.pending.clear();
    this.completed = [];
  }

  exportState(): ProjectionState {
    return {
      pending: [...this.pending.values()],
      completed: [...this.completed],
    };
  }

  importState(state: ProjectionState): void {
    // Validate before mutating (mirrors TimelineBuilder/TraceBuilder).
    const s = state as Partial<ApprovalProjectionSnapshot>;
    if (!Array.isArray(s.pending) || !Array.isArray(s.completed)) throw new Error('approval projection state: malformed pending/completed');
    for (const list of [s.pending, s.completed]) {
      for (const entry of list) {
        const e = entry as Partial<ApprovalProjectionEntry>;
        if (typeof e !== 'object' || e === null || typeof e.approvalId !== 'string' || typeof e.status !== 'string') {
          throw new Error('approval projection state: malformed entry');
        }
      }
    }
    this.pending = new Map(s.pending.map((e) => [e.approvalId, e as ApprovalProjectionEntry]));
    this.completed = [...s.completed as ApprovalProjectionEntry[]].slice(0, MAX_COMPLETED);
  }
}
```
> Note: the `'resolved'` fallback for `approval.resolved` with an unrecognized decision is retained defensively (a malformed `decision` still resolves the approval) but is not part of the exported status union — an `approval.resolved` always carries a recognized decision in practice.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/runtime/approval-projection.vitest.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Register approval on the runtime collector in `src/cli/commands/tui.ts`**

Add `import { ApprovalProjection } from '../../tui/runtime/approval-projection.js';`. In the runtime-collector construction (Task-3 version), add approval to the tuple factory:
```ts
  const runtimeCollector = new RuntimeCollectorImpl({
    eventLog,
    checkpointStore: runtimeCheckpointStore,
    sessionId,
    projectionRuntime: createProjectionRuntime([
      ['trace', new IncrementalExecutionTraceBuilder()],
      ['approval', new ApprovalProjection()],
    ]),
  });
```
**This is the ONLY change to the running system for the new projection. The collector, RuntimeSnapshot, and checkpoint flow are untouched.**

- [ ] **Step 6: Run the full runtime suite + typecheck**

Run: `npx vitest run tests/tui/runtime` and `npx tsc -p tsconfig.json --noEmit`
Expected: ALL pass, tsc clean.

- [ ] **Step 7: Verify the acceptance bar — no collector/snapshot/checkpoint-flow changes in this commit**

Run: `git diff HEAD --stat` and confirm `src/tui/runtime-collector.ts`, `src/tui/snapshot.ts`, and `src/tui/runtime/projection-checkpoint-store.ts` are NOT in the changed set for THIS task's commit. (The collector changes happened in Task 3; Task 5 must touch only the new builder + its test + `tui.ts`.)

- [ ] **Step 8: Commit**

```bash
git add src/tui/runtime/approval-projection.ts tests/tui/runtime/approval-projection.vitest.ts src/cli/commands/tui.ts
git commit -m "feat(capabilities): ApprovalProjection — first registry-native projection (Phase 7)"
```

---
---

## Self-Review Checklist (controller runs before execution)

1. **Spec coverage** — every Phase-7 spec section has a task: generalized projection contract with arbitrary snapshot shape (T1), ProjectionRuntime contract + `snapshot<T>(): T | undefined` + tuple factory (T2), collector blind + batch-atomicity + grep-only-owner (T3), registry-keyed envelope + dual-shape load + version-1 doc (T4), ApprovalProjection {pending, completed} object snapshot + identity/reconciliation + resumed Option A + deterministic timestamps + MAX_COMPLETED (T5), frozen durable contract (T1), acceptance bar (T3 Step 8, T5 Step 7).
2. **Placeholder scan** — all steps carry real code; the one "illustrative" note in T4 Step 2 tells the implementer the real fixture shape and the 3 required assertions, not a vague directive.
3. **Type consistency** — `ProjectionBuilder<TSnapshot>` / `DurableProjectionBuilder<TSnapshot>` with `snapshot(): TSnapshot` flows through all tasks; `ProjectionRuntime.snapshot<TSnapshot>(id): TSnapshot | undefined` is used identically in T2 tests and T3 assembly (`?? []`); `ProjectionStateSnapshot` flows T2→T3→T4; `ApprovalProjection implements DurableProjectionBuilder<ApprovalProjectionSnapshot>` matches T1's contract (assignable to the `unknown` snapshot param). `RuntimeCollectorOptions.projectionRuntime` is the single seam between T3 and T5.
