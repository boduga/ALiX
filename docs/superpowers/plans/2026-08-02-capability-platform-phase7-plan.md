# Capability Platform Phase 7 — Projection Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the projection pattern into a platform — `ProjectionRuntime` owns registration, generic dispatch, durable state, and reset coordination; the collector becomes blind to projection identity; ApprovalProjection proves a third projection style lands with zero collector/snapshot changes.

**Architecture:** `RuntimeCollectorImpl` keeps temporal orchestration (polling, cursor, session filter, workflow accounting, snapshot publication) but delegates every per-projection operation to a `ProjectionRuntime` it holds. The runtime registers builders by string id, dispatches `updateAll`, extracts `snapshot(id)`, exports/imports a registry-keyed durable envelope, and resets. Adding a projection = implement `DurableProjectionBuilder`, register it in the composition root (`src/cli/commands/tui.ts`), never touch the collector.

**Tech Stack:** TypeScript (strict, NodeNext ESM `.js` specifiers), vitest (`tests/**/*.vitest.ts`). Files: `src/tui/runtime/projection-runtime.ts` (new), `src/tui/runtime/approval-projection.ts` (new), `src/tui/runtime-collector.ts`, `src/tui/runtime/projection-checkpoint-store.ts`, `src/cli/commands/tui.ts`.

## Global Constraints

- NodeNext ESM (`.js` import specifiers), strict TypeScript.
- vitest tests under `tests/**/*.vitest.ts`.
- `EventLog` API stays additive; `src/capability/*` untouched.
- Checkpoint envelope `version` STAYS `1`. The 6.5 `state` field is renamed `projections`; **dual-shape load** (accept legacy `state` with keys `timeline`/`trace`) keeps existing 6.5 checkpoint files working. Save always writes the new `projections` shape.
- Durable state must be JSON-serializable plain objects only (no Maps/Sets/Date/undefined).
- **Dispatch order deterministic**: registration order is preserved for update/export/import/reset iteration; projections MUST NOT depend on execution order or on each other (D11 — each builder derives only from the EventLog batch).
- Duplicate `register(id)` throws a typed `ProjectionRegistrationError` (configuration corruption, not runtime failure).
- **Replay-from-`beginningCursor()` remains the ONLY recovery for an invalid cursor**; persisted state never trusted on an invalid cursor (D12).
- The checkpoint layer MUST never know builder-specific state types — only `ProjectionState = Record<string, unknown>` / the opaque envelope.
- Commit convention: `feat(capabilities): ...` / `refactor(capabilities): ...` / `test(capabilities): ...` with `Co-Authored-By: Claude <noreply@anthropic.com>`.

---
---

### Task 1: `ProjectionRuntime` foundation

**Files:**
- Create: `src/tui/runtime/projection-runtime.ts`
- Create: `tests/tui/runtime/projection-runtime.vitest.ts`
- (No collector changes.)

**Interfaces:**
- Consumes: `DurableProjectionBuilder<T>` (`src/tui/runtime/durable-projection-builder.ts`, already exists), `ProjectionState = Record<string, unknown>` (same file), `ProjectionStateSnapshot = Record<string, ProjectionState>` (`src/tui/runtime/projection-checkpoint-store.ts`, already exists), `AlixEvent` (`src/events/types.ts`).
- Produces (Task 2/3/4 depend on these):
  ```ts
  export class ProjectionRegistrationError extends Error { constructor(id: string); }
  export interface RegisteredProjection { readonly id: string; readonly builder: DurableProjectionBuilder<unknown>; }
  export class ProjectionRuntime {
    register(id: string, builder: DurableProjectionBuilder<unknown>): void;
    all(): readonly RegisteredProjection[];
    updateAll(events: readonly AlixEvent[]): void;
    snapshot<T>(id: string): readonly T[];          // [] if not registered
    exportState(): ProjectionStateSnapshot;         // keyed by registered id
    importState(state: ProjectionStateSnapshot): void;
    resetAll(): void;
  }
  export function createProjectionRuntime(opts: {
    sessionId: string;
    buildTimeline?: boolean;
    timelineBuilder?: TimelineBuilder;
    traceBuilder?: IncrementalExecutionTraceBuilder;
  }): ProjectionRuntime;
  ```

- [ ] **Step 1: Write the failing test** `tests/tui/runtime/projection-runtime.vitest.ts`

```ts
import { describe, it, expect } from 'vitest';
import { ProjectionRuntime, ProjectionRegistrationError, createProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';
import type { DurableProjectionBuilder, ProjectionState } from '../../../src/tui/runtime/durable-projection-builder.js';
import type { AlixEvent } from '../../../src/events/types.js';

/** Minimal durable builder: appends seqs to an array. */
function makeBuilder(initial: number[] = []): DurableProjectionBuilder<number> {
  const entries: number[] = [...initial];
  return {
    update(events) { for (const e of events) entries.push(e.seq); },
    snapshot() { return [...entries]; },
    reset() { entries.length = 0; },
    exportState(): ProjectionState { return { entries: [...entries] }; },
    importState(state) { const s = state as { entries?: unknown }; if (Array.isArray(s.entries)) entries.splice(0, entries.length, ...s.entries as number[]); },
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

  it('snapshot returns [] for an unregistered id', () => {
    const r = new ProjectionRuntime();
    expect(r.snapshot<number>('nope')).toEqual([]);
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
    // fresh runtime, same ids, different order-independent: import restores
    const r2 = new ProjectionRuntime();
    r2.register('b', makeBuilder()); r2.register('a', makeBuilder());
    r2.importState(state);
    expect(r2.snapshot<number>('b')).toEqual([9]);
    expect(r2.snapshot<number>('a')).toEqual([1, 2]);
  });

  it('exportState produces a JSON-stringifiable plain object', () => {
    const r = new ProjectionRuntime();
    r.register('a', makeBuilder([1, 2]));
    const json = JSON.parse(JSON.stringify(r.exportState()));
    expect(json).toEqual({ a: { entries: [1, 2] } });
  });

  it('updateAll propagates a builder throw (never swallows) — batch isolation is the collector\'s job', () => {
    const bad: DurableProjectionBuilder<number> = {
      update() { throw new Error('boom'); },
      snapshot: () => [], reset() {}, exportState: () => ({}), importState() {},
    };
    const ok = makeBuilder();
    const r = new ProjectionRuntime();
    r.register('ok', ok); r.register('bad', bad);
    expect(() => r.updateAll([evt(1)])).toThrow('boom');
    // registration order preserved: ok updated before bad threw
    expect(ok.snapshot()).toEqual([1]);
  });

  it('resetAll resets every registered builder', () => {
    const a = makeBuilder([1]); const b = makeBuilder([2]);
    const r = new ProjectionRuntime();
    r.register('a', a); r.register('b', b);
    r.resetAll();
    expect(a.snapshot()).toEqual([]);
    expect(b.snapshot()).toEqual([]);
  });

  it('createProjectionRuntime registers timeline (unless buildTimeline:false) + trace', () => {
    const withTimeline = createProjectionRuntime({ sessionId: 's', buildTimeline: true });
    expect(withTimeline.all().map((p) => p.id).sort()).toEqual(['timeline', 'trace']);
    const traceOnly = createProjectionRuntime({ sessionId: 's', buildTimeline: false });
    expect(traceOnly.all().map((p) => p.id)).toEqual(['trace']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/runtime/projection-runtime.vitest.ts`
Expected: FAIL — module `../../../src/tui/runtime/projection-runtime.js` not found.

- [ ] **Step 3: Write the implementation** `src/tui/runtime/projection-runtime.ts`

```ts
import type { AlixEvent } from '../../events/types.js';
import type { ProjectionState } from './durable-projection-builder.js';
import type { DurableProjectionBuilder } from './durable-projection-builder.js';
import type { ProjectionStateSnapshot } from './projection-checkpoint-store.js';
import { TimelineBuilder } from './timeline-builder.js';
import { IncrementalExecutionTraceBuilder } from './execution-trace-builder.js';

/**
 * A registered projection. `builder` is typed over `unknown` so the runtime
 * stays generic; the typed surface is the consumer's `snapshot<T>(id)`.
 */
export interface RegisteredProjection {
  readonly id: string;
  readonly builder: DurableProjectionBuilder<unknown>;
}

/**
 * Duplicate registration is a configuration-corruption condition (ids are the
 * durable-state keys; ambiguity is corruption), not a runtime failure.
 */
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
 *   `ProjectionState = Record<string, unknown>` through the envelope.
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

  snapshot<T>(id: string): readonly T[] {
    return (this.projections.get(id)?.snapshot() as readonly T[]) ?? [];
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
  }

  resetAll(): void {
    for (const { builder } of this.all()) builder.reset();
  }
}

/** Composition helper: build a runtime for the legacy builder-input shape.
 *  `buildTimeline:false` (the outer runtime collector) omits timeline — its
 *  snapshot('timeline') then returns [] exactly as pre-7 behavior. */
export function createProjectionRuntime(opts: {
  sessionId: string;
  buildTimeline?: boolean;
  timelineBuilder?: TimelineBuilder;
  traceBuilder?: IncrementalExecutionTraceBuilder;
}): ProjectionRuntime {
  const runtime = new ProjectionRuntime();
  if (opts.buildTimeline ?? true) {
    runtime.register('timeline', opts.timelineBuilder ?? new TimelineBuilder(opts.sessionId));
  }
  runtime.register('trace', opts.traceBuilder ?? new IncrementalExecutionTraceBuilder());
  return runtime;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/runtime/projection-runtime.vitest.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Verify the durable contract is frozen (no code change expected)**

Run: `grep -n "exportState\|importState" src/tui/runtime/durable-projection-builder.ts src/tui/runtime/timeline-builder.ts src/tui/runtime/execution-trace-builder.ts`
Confirm: `DurableProjectionBuilder<T>` declares `exportState(): ProjectionState; importState(state: ProjectionState): void` and both builders implement `importState(state: Record<string, unknown>)`. The checkpoint layer only ever sees `ProjectionState` / `ProjectionStateSnapshot`. If any builder signature drifted to a concrete state type, stop and fix it back to `ProjectionState` before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/tui/runtime/projection-runtime.ts tests/tui/runtime/projection-runtime.vitest.ts
git commit -m "feat(capabilities): ProjectionRuntime registry + generic dispatch (Phase 7)"
```

---
---

### Task 2: Collector migration — blind to projection identity

**Files:**
- Modify: `src/tui/runtime-collector.ts` (options 50-66, fields 71-84, constructor 86-104, initializeCheckpoint 123-158, sample 212-306)
- Modify: `src/cli/commands/tui.ts` (collector construction ~114-138)
- Modify: `tests/tui/runtime/runtime-collector.vitest.ts`, `tests/tui/runtime/runtime-collector-state.vitest.ts`, `tests/tui/runtime/projection-independence.vitest.ts` (mechanical construction change only — assertions unchanged)

**Interfaces:**
- Consumes: `ProjectionRuntime` + `createProjectionRuntime` (Task 1).
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
   *  state through this object. Built via createProjectionRuntime(). */
  projectionRuntime: ProjectionRuntime;
}
```

Replace the fields (lines 71-76) and constructor (lines 86-104) — remove the three builder-specific fields; keep only the runtime:
```ts
  private readonly projectionRuntime: ProjectionRuntime;
```
Constructor: delete `this.buildTimeline = ...`, `this.timelineBuilder = ...`, `this.traceBuilder = ...`; add `this.projectionRuntime = opts.projectionRuntime;`. Add the import `import { ProjectionRuntime } from './runtime/projection-runtime.js';` and update the `import type` line for the options to reference it.

- [ ] **Step 2: Rewrite the per-projection call sites to generic dispatch**

`initializeCheckpoint()` restore block (lines 140-143) becomes:
```ts
      if (loaded.state) this.projectionRuntime.importState(loaded.state);
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
        trace: this.projectionRuntime.snapshot<ExecutionTraceEntry>('trace'),
        timeline: this.projectionRuntime.snapshot<TimelineEntry>('timeline'),
```
Add explicit type imports to the collector (neither entry type is currently imported directly — they come through `RuntimeSnapshot`):
```ts
import type { ExecutionTraceEntry } from './runtime/execution-trace.js';
import type { TimelineEntry } from './runtime/timeline-builder.js';
```
(`IncrementalExecutionTraceBuilder`/`TimelineBuilder` value imports already exist for `createProjectionRuntime` usage — keep them if still referenced, drop if the helper owns construction.)

The D12 catch in `sample()` (lines 297-298) becomes:
```ts
        this.projectionRuntime.resetAll();
        this.resetCheckpoint();
```

The durable-state save block (lines 270-279) becomes:
```ts
      const state: ProjectionStateSnapshot = this.projectionRuntime.exportState();
```
The `ProjectionStateSnapshot` type import stays.

- [ ] **Step 3: Update `src/cli/commands/tui.ts` to build runtimes**

Add `createProjectionRuntime` to the import from `../../tui/runtime/projection-runtime.js` (or add the import if not present). Replace the three collector constructions (lines 121-138):
```ts
  const runtimeCollector = new RuntimeCollectorImpl({
    eventLog,
    checkpointStore: runtimeCheckpointStore,
    sessionId,
    projectionRuntime: createProjectionRuntime({ sessionId, buildTimeline: false }),
  });
  const chatCollector = new RuntimeCollectorImpl({
    eventLog,
    checkpointStore: chatCheckpointStore,
    sessionId: chatSessionId,
    projectionRuntime: createProjectionRuntime({ sessionId: chatSessionId, timelineBuilder: new TimelineBuilder(chatSessionId) }),
  });
  const agentCollector = new RuntimeCollectorImpl({
    eventLog,
    checkpointStore: agentCheckpointStore,
    sessionId: agentSessionId,
    projectionRuntime: createProjectionRuntime({ sessionId: agentSessionId, timelineBuilder: new TimelineBuilder(agentSessionId) }),
  });
```

- [ ] **Step 4: Update the collector tests' construction (mechanical)**

In each of `tests/tui/runtime/runtime-collector.vitest.ts`, `runtime-collector-state.vitest.ts`, and `projection-independence.vitest.ts`, replace constructions of the form:
```ts
new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, timelineBuilder: ..., buildTimeline: ..., traceBuilder: ... })
```
with:
```ts
new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime({ sessionId: SESSION_ID, timelineBuilder: ..., buildTimeline: ..., traceBuilder: ... }) })
```
Add `import { createProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';` to each file. **Do NOT change any assertion** — behavior must be byte-for-byte equivalent. Use a `buildCollector(...)` helper per file if the same options repeat.

- [ ] **Step 5: Add a batch-atomicity test — a throwing projection must NOT commit the checkpoint**

In `tests/tui/runtime/runtime-collector.vitest.ts`, add a test that registers a throwing projection on the runtime passed to the collector, and asserts the checkpoint is not advanced and the previous cache is preserved:
```ts
import { ProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';
import type { DurableProjectionBuilder } from '../../../src/tui/runtime/durable-projection-builder.js';
import type { ProjectionState } from '../../../src/tui/runtime/durable-projection-builder.js';

  it('a throwing projection does not commit the checkpoint (batch atomicity)', async () => {
    const { log, append } = makeEventLog();
    await append('chat.message', { text: 'hi' });
    const store = makeCheckpointStore();
    const throwing: DurableProjectionBuilder<unknown> = {
      update() { throw new Error('boom'); },
      snapshot: () => [], reset() {}, exportState: (): ProjectionState => ({}), importState() {},
    };
    const runtime = new ProjectionRuntime();
    runtime.register('bad', throwing);
    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, projectionRuntime: runtime });
    await collector.start();                 // initializeCheckpoint + first sample
    await collector.sample();                // throws inside updateAll → caught
    expect(store.saved.length).toBe(0);      // no durable commit happened
    expect((collector as unknown as { checkpoint: { committedAt: number } }).checkpoint.committedAt).toBe(0);
    collector.stop();
  });
```
> (Use the file's existing `makeEventLog`/`makeCheckpointStore` helpers and the `sample`/`checkpoint` access pattern already present in that file.)

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
Expected: the ONLY matches are `this.projectionRuntime.updateAll(` / `this.projectionRuntime.resetAll(` / `this.projectionRuntime.exportState(` / `this.projectionRuntime.importState(` / `this.projectionRuntime.snapshot<...>('trace'|'timeline')`. There MUST be no bare `this.timelineBuilder.`, `this.traceBuilder.`, or a per-id `if`/`switch`. (A hidden `this.traceBuilder.reset()` would pass tests but violates the platform goal — grep catches it.)

- [ ] **Step 9: Commit**

```bash
git add src/tui/runtime-collector.ts src/cli/commands/tui.ts tests/tui/runtime/runtime-collector.vitest.ts tests/tui/runtime/runtime-collector-state.vitest.ts tests/tui/runtime/projection-independence.vitest.ts
git commit -m "refactor(capabilities): collector hosts ProjectionRuntime, blind to projection identity (Phase 7)"
```

---
---

### Task 3: Registry-keyed durable envelope (`state` → `projections`)

**Files:**
- Modify: `src/tui/runtime/projection-checkpoint-store.ts` (envelope 19-29, load 54-75)
- Modify: `src/tui/runtime-collector.ts` (load/restore path already generic from Task 2 — verify)
- Modify: `tests/tui/runtime/projection-checkpoint-store.vitest.ts`, `tests/tui/runtime/runtime-collector-state.vitest.ts`

**Interfaces:**
- Consumes: `ProjectionStateSnapshot` (existing), `ProjectionRuntime.exportState/importState` (Task 1).
- Produces: `PersistedProjectionCheckpoint` gains `readonly projections?: ProjectionStateSnapshot` and keeps `readonly state?: ProjectionStateSnapshot` (legacy 6.5). Version STAYS `1`.

- [ ] **Step 1: Write the failing test** — add to `tests/tui/runtime/projection-checkpoint-store.vitest.ts`

```ts
  it('loads a Phase-7 envelope (projections key) and a legacy 6.5 envelope (state key)', async () => {
    // Phase-7 shape: save writes projections
    const store7 = new FileProjectionCheckpointStore(tmpdir);
    await store7.save({ version: 1, cursor: '{"version":1,"seq":3}', committedAt: 1, projections: { trace: { seenSequences: [] } } });
    const loaded7 = await store7.load();
    expect(loaded7?.projections).toEqual({ trace: { seenSequences: [] } });

    // Legacy 6.5 shape: load must still accept a state key
    const legacyFile = join(tmpdir, 'legacy.json');
    await writeFile(legacyFile, JSON.stringify({ version: 1, cursor: '{"version":1,"seq":2}', committedAt: 2, state: { timeline: { version: 1, entries: [] } } }));
    const storeLegacy = new FileProjectionCheckpointStore(tmpdir2);
    // (tmpdir2 points at the directory containing legacy.json — adjust the fixture to reuse one dir)
    expect(loaded7?.version).toBe(1);
  });
```
> Note: this snippet is illustrative — the implementer writes the real fixture using the existing temp-dir pattern in this file (mkdtemp per store, one dir shared so both shapes load from the same directory). The assertions that matter: (1) a save with `projections` round-trips through load; (2) a legacy file with `state` loads with `state` preserved and `version === 1`; (3) `load()` still rejects a non-object envelope.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/runtime/projection-checkpoint-store.vitest.ts`
Expected: FAIL — `PersistedProjectionCheckpoint` has no `projections` field (type error) and `save` with `projections` is rejected.

- [ ] **Step 3: Extend the envelope + load in `projection-checkpoint-store.ts`**

Envelope (lines 24-29):
```ts
export interface PersistedProjectionCheckpoint {
  readonly version: 1;
  readonly cursor: string;
  readonly committedAt: number;
  /** Phase 7 — registry-keyed durable projection state. Replaces the 6.5
   *  `state` field; save always writes this shape. */
  readonly projections?: ProjectionStateSnapshot;
  /** Phase 6.5 legacy — still accepted on load (dual-shape), never written. */
  readonly state?: ProjectionStateSnapshot;
}
```

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

- [ ] **Step 4: Collector writes `projections`, reads either**

In `src/tui/runtime-collector.ts` `sample()` save (Task-2 rewritten block), change the save object key from `state` to `projections`:
```ts
      await this.checkpointStore.save({
        version: CHECKPOINT_CONTAINER_VERSION,
        cursor: this.eventLog.serializeCursor(nextCheckpoint.cursor),
        committedAt: nextCheckpoint.committedAt,
        projections: this.projectionRuntime.exportState(),
      });
```
(The earlier `const state: ProjectionStateSnapshot = ...` line can be inlined.)

In `initializeCheckpoint()` restore (Task-2 rewritten block), read BOTH shapes:
```ts
      const restored = loaded.projections ?? loaded.state;
      if (restored) this.projectionRuntime.importState(restored);
```

- [ ] **Step 5: Update `runtime-collector-state.vitest.ts` for the new save shape**

Change the test seeds that call `store.save({ ..., state: ... })` to `store.save({ ..., projections: ... })`, and the assertions reading `lastSave.state` to `lastSave.projections`. Add one legacy-compat test: seed a checkpoint with `state: { timeline: { version: 1, entries: [...] }, trace: {...} }` and assert a fresh collector restores the timeline entries (legacy envelope still honored). Keep the invalid-cursor-with-persisted-state test but seed via `projections`.

- [ ] **Step 6: Run the runtime + store suites**

Run: `npx vitest run tests/tui/runtime`
Expected: ALL pass (store dual-shape, collector legacy + new shape, invalid-cursor-discards-state).

- [ ] **Step 7: Commit**

```bash
git add src/tui/runtime/projection-checkpoint-store.ts src/tui/runtime-collector.ts tests/tui/runtime/projection-checkpoint-store.vitest.ts tests/tui/runtime/runtime-collector-state.vitest.ts
git commit -m "feat(capabilities): registry-keyed durable envelope, dual-shape legacy load (Phase 7)"
```

---
---

### Task 4: ApprovalProjection — first registry-native projection

**Files:**
- Create: `src/tui/runtime/approval-projection.ts`
- Create: `tests/tui/runtime/approval-projection.vitest.ts`
- Modify: `src/cli/commands/tui.ts` (register approval on the runtime collector's runtime only)
- **No changes to `RuntimeCollectorImpl`, `RuntimeSnapshot`, or the checkpoint transaction flow** (acceptance criterion).

**Interfaces:**
- Consumes: `DurableProjectionBuilder<T>`, `ProjectionState`, `AlixEvent`, `RuntimeCollectorImpl` (as a black box).
- Produces:
  ```ts
  export interface ApprovalProjectionEntry {
    readonly approvalId: string;              // identity
    readonly prompt?: string;
    readonly toolName?: string;
    readonly status: 'pending' | 'approved' | 'denied' | 'edited'
      | 'expired' | 'revoked' | 'consumed' | 'resumed'
      | 'resolved';   // fallback: approval.resolved w/o recognized decision
    readonly requestedAt: number;
    readonly completedAt?: number;            // set on terminal
  }
  export interface ApprovalProjectionSnapshot {
    readonly pending: readonly ApprovalProjectionEntry[];
    readonly completed: readonly ApprovalProjectionEntry[];
  }
  export const MAX_COMPLETED = 50;
  export class ApprovalProjection implements DurableProjectionBuilder<ApprovalProjectionEntry> {
    update(events: readonly AlixEvent[]): void;
    snapshot(): readonly ApprovalProjectionEntry[];   // pending first, then completed (newest→oldest)
    reset(): void;
    exportState(): ProjectionState;           // { pending, completed }
    importState(state: ProjectionState): void;
  }
  ```
  **Identity/reconciliation (deterministic):** identity = `approvalId`. `requested` creates a new pending entry if none is pending (a completed entry with the same id does NOT block a new lifecycle). A terminal event acts only on a pending entry; unknown id → no-op. See the spec's reconciliation rules.

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
    expect(p.snapshot()).toHaveLength(1);
    expect(p.snapshot()[0]!.status).toBe('pending');
    p.update([resolved(2, 'a1', 'approved')]);
    const all = p.snapshot();
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe('approved');
    expect(all[0]!.completedAt).toBe(2 * 1000);
  });

  it('completed is bounded by MAX_COMPLETED (FIFO drop of oldest)', () => {
    const p = new ApprovalProjection();
    const ids = Array.from({ length: MAX_COMPLETED + 5 }, (_, i) => `a${i}`);
    const events: AlixEvent[] = [];
    ids.forEach((id, i) => { events.push(requested(i * 2 + 1, id)); events.push(resolved(i * 2 + 2, id, 'approved')); });
    p.update(events);
    const all = p.snapshot();
    expect(all).toHaveLength(MAX_COMPLETED);
    // the 5 oldest completed approvals were dropped
    expect(all.some((e) => e.approvalId === 'a0')).toBe(false);
    expect(all.some((e) => e.approvalId === `a${MAX_COMPLETED + 4}`)).toBe(true);
  });

  it('ignores non-approval events and unknown approval ids', () => {
    const p = new ApprovalProjection();
    p.update([evt('chat.message', { text: 'hi' }, 1), resolved(2, 'nope', 'denied')]);
    expect(p.snapshot()).toEqual([]);
  });

  it('exportState/importState round-trips pending + completed', () => {
    const p = new ApprovalProjection();
    p.update([requested(1, 'a1'), requested(2, 'a2'), resolved(3, 'a1', 'denied')]);
    const state = p.exportState();
    const p2 = new ApprovalProjection();
    p2.importState(state);
    const all = p2.snapshot();
    expect(all.find((e) => e.approvalId === 'a2')?.status).toBe('pending');
    expect(all.find((e) => e.approvalId === 'a1')?.status).toBe('denied');
  });

  it('requested after a completed lifecycle with the same id starts a NEW lifecycle', () => {
    const p = new ApprovalProjection();
    p.update([requested(1, 'a1'), resolved(2, 'a1', 'approved')]);
    p.update([requested(3, 'a1')]);              // re-request of an id already completed
    const all = p.snapshot();
    const pending = all.filter((e) => e.status === 'pending');
    const completed = all.filter((e) => e.status === 'approved');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.requestedAt).toBe(3 * 1000);   // the NEW lifecycle, not the old
    expect(completed).toHaveLength(1);                // old completed entry retained
  });

  it('reset clears pending and completed', () => {
    const p = new ApprovalProjection();
    p.update([requested(1, 'a1'), resolved(2, 'a1', 'approved')]);
    p.reset();
    expect(p.snapshot()).toEqual([]);
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
    | 'expired' | 'revoked' | 'consumed' | 'resumed'
    | 'resolved';   // fallback: approval.resolved w/o recognized decision
  readonly requestedAt: number;
  readonly completedAt?: number;
}

/** The projection's explicit state view (also its durable shape). */
export interface ApprovalProjectionSnapshot {
  readonly pending: readonly ApprovalProjectionEntry[];
  readonly completed: readonly ApprovalProjectionEntry[];
}

/** Deterministic cap on completed history — NOT a time window (clock/replay-safe). */
export const MAX_COMPLETED = 50;

/** Events that close a pending approval (move it to completed). */
const TERMINAL_TYPES = new Set([
  'approval.resolved', 'approval.expired', 'approval.consumed',
  'approval.revoked', 'approval.resume.failed',
]);

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
 * Identity/reconciliation (deterministic): identity = approvalId. `requested`
 * creates a NEW pending entry unless one is already pending (a completed entry
 * with the same id does NOT block a new lifecycle). A terminal event acts only
 * on a pending entry; unknown id → no-op (replay of a resolve without its
 * request). See spec reconciliation rules.
 */
export class ApprovalProjection implements DurableProjectionBuilder<ApprovalProjectionEntry> {
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
            requestedAt: Date.parse(e.timestamp) || Date.now(),
          });
        }
        // id already pending → idempotent replay of the same request, no-op
      } else if (e.type === 'approval.resumed') {
        const existing = this.pending.get(approvalId);
        if (existing) this.pending.set(approvalId, { ...existing, status: 'resumed' });
      } else if (TERMINAL_TYPES.has(e.type)) {
        const existing = this.pending.get(approvalId);
        if (!existing) continue;                    // unknown id → no-op
        const p = (e.payload ?? {}) as Record<string, unknown>;
        const status: ApprovalProjectionEntry['status'] = e.type === 'approval.resolved'
          ? (typeof p.decision === 'string' && ['approved', 'denied', 'edited'].includes(p.decision) ? p.decision as ApprovalProjectionEntry['status'] : 'resolved')
          : e.type === 'approval.resume.failed' ? 'resumed'
          : e.type === 'approval.expired' ? 'expired'
          : e.type === 'approval.consumed' ? 'consumed'
          : 'revoked';
        const done: ApprovalProjectionEntry = { ...existing, status, completedAt: Date.parse(e.timestamp) || Date.now() };
        this.pending.delete(approvalId);
        this.completed = [done, ...this.completed].slice(0, MAX_COMPLETED);
      }
    }
  }

  /** Pending first (in request order), then completed (newest→oldest). */
  snapshot(): readonly ApprovalProjectionEntry[] {
    return [...this.pending.values(), ...this.completed];
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/runtime/approval-projection.vitest.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Register approval on the runtime collector in `src/cli/commands/tui.ts`**

Add `import { ApprovalProjection } from '../../tui/runtime/approval-projection.js';`. In the runtime-collector construction (Task-2 version), replace `createProjectionRuntime({ sessionId, buildTimeline: false })` with an explicit runtime that also registers approval — OR extend `createProjectionRuntime` (composition helper, NOT the collector):
```ts
  import { ProjectionRuntime } from '../../tui/runtime/projection-runtime.js';
  // ...
  const runtimeProjectionRuntime = new ProjectionRuntime();
  runtimeProjectionRuntime.register('trace', new IncrementalExecutionTraceBuilder());
  runtimeProjectionRuntime.register('approval', new ApprovalProjection());
  const runtimeCollector = new RuntimeCollectorImpl({
    eventLog,
    checkpointStore: runtimeCheckpointStore,
    sessionId,
    projectionRuntime: runtimeProjectionRuntime,
  });
```
(`IncrementalExecutionTraceBuilder` is imported in tui.ts already; add `ProjectionRuntime` to the projection-runtime import and `ApprovalProjection` to its own import.)

**This is the ONLY change to the running system for the new projection. The collector, RuntimeSnapshot, and checkpoint flow are untouched.**

- [ ] **Step 6: Run the full runtime suite + typecheck**

Run: `npx vitest run tests/tui/runtime` and `npx tsc -p tsconfig.json --noEmit`
Expected: ALL pass, tsc clean.

- [ ] **Step 7: Verify the acceptance bar — no collector/snapshot/checkpoint-flow changes in this commit**

Run: `git diff HEAD --stat` and confirm `src/tui/runtime-collector.ts` and `src/tui/snapshot.ts` are NOT in the changed set for THIS task's commit. (The collector changes happened in Task 2; Task 4 must touch only the new builder + its test + `tui.ts`.)

- [ ] **Step 8: Commit**

```bash
git add src/tui/runtime/approval-projection.ts tests/tui/runtime/approval-projection.vitest.ts src/cli/commands/tui.ts
git commit -m "feat(capabilities): ApprovalProjection — first registry-native projection (Phase 7)"
```

---
---

## Self-Review Checklist (controller runs before execution)

1. **Spec coverage** — every Phase-7 spec section has a task: ProjectionRuntime contract (T1), collector blind (T2), registry-keyed envelope + dual-shape load (T3), ApprovalProjection {pending, completed} bounded MAX_COMPLETED + identity/reconciliation rules (T4), deterministic ordering + typed ProjectionRegistrationError (T1), frozen durable contract (T1 Step 5), **batch atomicity / failure isolation (T1 updateAll-propagates-throw test + T2 batch-atomicity collector test)**, **grep-only-owner acceptance (T2 Step 8, T4 Step 7)**, acceptance bar (T2, T4 Step 7).
2. **Placeholder scan** — all steps carry real code; the one "illustrative" note in T3 Step 1 tells the implementer the real fixture shape and the 3 required assertions, not a vague directive.
3. **Type consistency** — `ProjectionRuntime.snapshot<T>(id): readonly T[]` is used identically in T1 tests and T2 assembly; `ProjectionStateSnapshot` flows T1→T2→T3; `ApprovalProjection` implements `DurableProjectionBuilder<ApprovalProjectionEntry>` matching T1's `register(id, builder: DurableProjectionBuilder<unknown>)` (ApprovalProjection is assignable via the `unknown`-typed builder field). `RuntimeCollectorOptions.projectionRuntime` is the single seam between T2 and T4.
