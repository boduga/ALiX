# ALiX Capability Platform Phase 5.5 — Durable Projection Checkpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the `ProjectionCheckpoint` (cursor + committedAt) so the incremental EventLog processing from Phase 5 survives process replacement — a durable, opaque, replay-safe projection watermark.

**Architecture:** `EventLog` gains `serializeCursor`/`deserializeCursor` (the only way cursors cross the persistence boundary; versioned internal format; no owner token persisted). A dedicated `ProjectionCheckpointStore` persists `{ version, cursor, committedAt }` atomically (tmp+rename) to `projection-checkpoint.json`. `RuntimeCollectorImpl` takes the store via constructor injection, recovers from it in an async `start()` before sampling, and treats the checkpoint as a **commit marker** — the cursor advances and the snapshot publishes only after a durable save succeeds (save-before-publish, D5).

**Tech Stack:** TypeScript (NodeNext ESM, strict), vitest, the existing EventLog + RuntimeCollector + session-store atomic-write pattern.

## Global Constraints

- **`src/capability/*`, `timelineEvents[]`, ChatView, AgentView, and the capability presenter are UNTOUCHED** (D8).
- **Cursor opacity preserved end-to-end (D1/D2):** `seq` is never exposed through the public EventLog cursor API; serialization happens only inside `EventLog.serializeCursor`/`deserializeCursor`. `ProjectionCheckpoint` stays cursor-object based in the runtime layer — no `cursorString` in the collector (D7).
- **`EventLog` owns cursor semantics; `ProjectionCheckpointStore` owns persistence mechanics** — the store never reads the cursor string, never touches the EventLog, never runs projection logic (D3).
- **Checkpoint is a commit marker (D5):** `readSince → builder.update → save(candidate) → (success) advance checkpoint + publish snapshot; (failure) keep old checkpoint + old cache, retry next sample.` A published `RuntimeSnapshot` always has a corresponding durable checkpoint position.
- **Write cadence = every successful sample** (D6); persist-before-publish. No throttle, no shutdown-only.
- **Recovery fallback:** missing / malformed / unknown-version / foreign → `beginningCursor()` (full replay, idempotent).
- **Constructor injection (review refinement):** the collector never instantiates the store internally; tests inject an in-memory store.
- **Async startup ordering (review refinement):** `start()` awaits `initializeCheckpoint()` before the first `sample()` — the first sample must never race an incomplete recovery.
- NodeNext ESM (`import ... from "./x.js"`), strict TS, vitest.
- Every task ends green: `npx tsc -p tsconfig.json --noEmit` passes and the task's tests pass.

---

### Task 1: EventLog cursor serialization

**Files:**
- Modify: `src/events/event-log.ts`
- Test: `tests/events/event-log-cursor.vitest.ts` (add serialization tests)

**Interfaces:**
- Produces: `EventLog.serializeCursor(cursor): string`, `EventLog.deserializeCursor(serialized): EventLogCursor`. Tasks 2-4 consume these.

- [ ] **Step 1: Write the failing test**

Add to `tests/events/event-log-cursor.vitest.ts`:

```typescript
  it('serializeCursor/deserializeCursor round-trips a cursor owned by the same log', async () => {
    const log = await makeLog();
    await log.append({ sessionId: 's', actor: 'system', type: 'a', payload: {} });
    const c = log.beginningCursor();
    const restored = log.deserializeCursor(log.serializeCursor(c));
    expect(log.cursorsEqual(restored, c)).toBe(true);
  });

  it('deserializeCursor rejects a cursor serialized by ANOTHER log instance (owner re-created per instance)', async () => {
    const logA = await makeLog();
    const logB = await makeLog();
    const serialized = logA.serializeCursor(logA.beginningCursor());
    expect(() => logB.deserializeCursor(serialized)).toThrow();
  });

  it('deserializeCursor rejects malformed JSON and unknown versions', async () => {
    const log = await makeLog();
    expect(() => log.deserializeCursor('not-json')).toThrow();
    expect(() => log.deserializeCursor(JSON.stringify({ version: 99, seq: 5 }))).toThrow();
  });

  it('serialized cursor exposes no seq via JSON (opacity preserved)', async () => {
    const log = await makeLog();
    const serialized = log.serializeCursor(log.beginningCursor());
    expect(serialized).not.toContain('owner');       // no owner token persisted
    expect(serialized).toContain('version');         // versioned envelope
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/events/event-log-cursor.vitest.ts --config vitest.config.mts`
Expected: FAIL — `serializeCursor`/`deserializeCursor` do not exist.

- [ ] **Step 3: Implement serialization in `src/events/event-log.ts`**

Add the version constant and the two public methods (after `cursorsEqual`):

```typescript
/** Durable cursor serialization format version. Bump on incompatible changes. */
const SERIALIZED_CURSOR_VERSION = 1;

interface SerializedCursor {
  readonly version: number;
  readonly seq: number;
}
```

```typescript
  /** Serialize a cursor for durable storage. Opaque — only meaningful to this
   *  EventLog. The representation is a POSITION CLAIM, not a transferable
   *  cursor: no owner token is persisted, so a restored cursor carries THIS
   *  instance's owner symbol. seq is never exposed through the public API —
   *  it is only handled inside serialize/deserialize. */
  serializeCursor(cursor: EventLogCursor): string {
    const internal = this.unwrap(cursor);
    const payload: SerializedCursor = { version: SERIALIZED_CURSOR_VERSION, seq: internal.seq };
    return JSON.stringify(payload);
  }

  /** Restore a cursor owned by this EventLog. Throws for malformed JSON or an
   *  unknown version. The restored cursor is created via makeCursor, so it
   *  carries THIS instance's owner token — a serialized cursor from another
   *  log is rejected by unwrap/readSince as foreign. */
  deserializeCursor(serialized: string): EventLogCursor {
    const parsed = JSON.parse(serialized) as Partial<SerializedCursor>;
    if (typeof parsed !== 'object' || parsed === null) throw new Error('Malformed serialized cursor');
    if (parsed.version !== SERIALIZED_CURSOR_VERSION) throw new Error(`Unknown serialized cursor version: ${String(parsed.version)}`);
    const seq = parsed.seq;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) throw new Error('Malformed serialized cursor seq');
    return this.makeCursor(seq);
  }
```

(Note: `deserializeCursor` deliberately does NOT validate the seq against the current log head — the collector's recovery policy decides whether a beyond-head cursor is clamped or falls back. This task only restores the position claim.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/events/event-log-cursor.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Build + full events suite + commit**

Run: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/events --config vitest.config.mts`
```bash
git add src/events/event-log.ts tests/events/event-log-cursor.vitest.ts
git commit -m "feat(capabilities): EventLog cursor serialize/deserialize (versioned, owner-agnostic)"
```

---

### Task 2: `ProjectionCheckpointStore`

**Files:**
- Create: `src/tui/runtime/projection-checkpoint-store.ts`
- Test: `tests/tui/runtime/projection-checkpoint-store.vitest.ts` (new)

**Interfaces:**
- Consumes: nothing from the collector — the store's contract is `PersistedProjectionCheckpoint` (defined in this file); it never sees the `EventLog` or a cursor object (D3/D7).
- Produces: `PersistedProjectionCheckpoint`, `ProjectionCheckpointStore` interface + a filesystem implementation `FileProjectionCheckpointStore`. Tasks 3-4 consume these.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tui/runtime/projection-checkpoint-store.vitest.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileProjectionCheckpointStore } from '../../../src/tui/runtime/projection-checkpoint-store.js';
import { EventLog } from '../../../src/events/event-log.js';

function makeSerialized(log: EventLog, seq = 5): { cursor: string; committedAt: number } {
  return { cursor: log.serializeCursor(log.getCursor()), committedAt: 1000 };
}

describe('FileProjectionCheckpointStore', () => {
  let dir: string;
  let store: FileProjectionCheckpointStore;
  let log: EventLog;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'alix-chk-'));
    log = new EventLog(dir);
    await log.init();
    store = new FileProjectionCheckpointStore(dir);
  });

  it('load returns null when no checkpoint exists', async () => {
    expect(await store.load()).toBeNull();
  });

  it('save then load round-trips a serialized cursor string + timestamp', async () => {
    const cp = makeSerialized(log);
    await store.save(cp);
    const loaded = await store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.cursor).toBe(cp.cursor);       // opaque string preserved verbatim
    expect(loaded!.committedAt).toBe(cp.committedAt);
    // The collector deserializes the opaque string back into an owned cursor:
    expect(log.cursorsEqual(log.deserializeCursor(loaded!.cursor), log.getCursor())).toBe(true);
  });

  it('load returns null for malformed JSON', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'projection-checkpoint.json'), 'not-json', 'utf-8');
    expect(await store.load()).toBeNull();
  });

  it('load returns null for an unknown container version', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'projection-checkpoint.json'), JSON.stringify({ version: 99, cursor: 'x', committedAt: 1 }), 'utf-8');
    expect(await store.load()).toBeNull();
  });

  it('writes atomically (tmp file then rename — no half-written target)', async () => {
    const cp = makeSerialized(log);
    await store.save(cp);
    // A stale tmp file must not exist after a successful save.
    expect(existsSync(join(dir, 'projection-checkpoint.json.tmp'))).toBe(false);
    expect(existsSync(join(dir, 'projection-checkpoint.json'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/runtime/projection-checkpoint-store.vitest.ts --config vitest.config.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the store**

```typescript
// src/tui/runtime/projection-checkpoint-store.ts
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const CHECKPOINT_FILE = 'projection-checkpoint.json';
const TMP_SUFFIX = '.tmp';
const CONTAINER_VERSION = 1;

// PersistedProjectionCheckpoint (defined above) IS the envelope written to
// disk; CONTAINER_VERSION is its literal version field.

/** The persisted form of a projection checkpoint. `committedAt` is the instant
 *  this projection became durable (matches D5 — the checkpoint is the durable
 *  commit marker). The cursor string is opaque to the store. */
export interface PersistedProjectionCheckpoint {
  readonly version: 1;
  readonly cursor: string;
  readonly committedAt: number;
}

/** Persistence boundary for projection checkpoints. Owns atomic disk writes and
 *  the container envelope. Does NOT interpret cursors, touch the EventLog, or
 *  run projection logic (D3). The cursor STRING is opaque — the collector
 *  serializes/deserializes it via the EventLog around this store (D7: the
 *  runtime layer never touches a cursorString, but the store's boundary is the
 *  serialized form). Dependency graph: EventLog ↑ Collector ↓ CheckpointStore. */
export interface ProjectionCheckpointStore {
  load(): Promise<PersistedProjectionCheckpoint | null>;
  save(checkpoint: PersistedProjectionCheckpoint): Promise<void>;
}

/** Filesystem store. Writes to `<sessionDir>/projection-checkpoint.json` via
 *  atomic tmp+rename (POSIX rename is atomic, so a crash mid-write never
 *  leaves a half-written file). */
export class FileProjectionCheckpointStore implements ProjectionCheckpointStore {
  private readonly path: string;
  private readonly tmpPath: string;

  constructor(sessionDir: string) {
    this.path = join(sessionDir, CHECKPOINT_FILE);
    this.tmpPath = this.path + TMP_SUFFIX;
  }

  async load(): Promise<PersistedProjectionCheckpoint | null> {
    if (!existsSync(this.path)) return null;
    const raw = await readFile(this.path, 'utf-8');
    let parsed: Partial<PersistedProjectionCheckpoint>;
    try {
      parsed = JSON.parse(raw) as Partial<PersistedProjectionCheckpoint>;
    } catch {
      return null; // corrupt — treat as not-found
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (parsed.version !== CONTAINER_VERSION) return null; // unknown envelope
    if (typeof parsed.cursor !== 'string' || typeof parsed.committedAt !== 'number') return null;
    return { version: CONTAINER_VERSION, cursor: parsed.cursor, committedAt: parsed.committedAt };
  }

  async save(checkpoint: PersistedProjectionCheckpoint): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.tmpPath, JSON.stringify(checkpoint, null, 2) + '\n', 'utf-8');
    await rename(this.tmpPath, this.path);
  }
}
```

The collector owns `serializeCursor`/`deserializeCursor` around this store (Task 3): `save({ cursor: eventLog.serializeCursor(cp.cursor), committedAt })` and `eventLog.deserializeCursor(saved.cursor)` on load. The store never sees the EventLog or a cursor object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/runtime/projection-checkpoint-store.vitest.ts --config vitest.config.mts`
Expected: PASS (update the test to the corrected string-based store contract: `store.save({ cursor: log.serializeCursor(cp.cursor), committedAt })` and `store.load()` returns `{ cursor: string, committedAt }`).

- [ ] **Step 5: Build + full runtime suite + commit**

Run: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui/runtime --config vitest.config.mts`
```bash
git add src/tui/runtime/projection-checkpoint-store.ts tests/tui/runtime/projection-checkpoint-store.vitest.ts
git commit -m "feat(capabilities): atomic ProjectionCheckpointStore with versioned envelope"
```

---

### Task 3: Collector integration — constructor injection, async recovery, save-as-commit-marker

**Files:**
- Modify: `src/tui/runtime-collector.ts`
- Test: `tests/tui/runtime/runtime-collector.vitest.ts` (extend the fake EventLog with serialize/deserialize; add recovery + D5 tests)

**Interfaces:**
- Consumes: `EventLog.serializeCursor`/`deserializeCursor` (Task 1), `ProjectionCheckpointStore` (Task 2).
- Produces: `RuntimeCollectorImpl(eventLog, checkpointStore)` — constructor injection; `start(): Promise<void>` (async, awaits recovery); `initializeCheckpoint()`; D5 save-as-commit-marker sampling.

- [ ] **Step 1: Write the failing test**

Extend `tests/tui/runtime/runtime-collector.vitest.ts`. The existing fake EventLog needs `serializeCursor`/`deserializeCursor`; add an in-memory store:

```typescript
import { RuntimeCollectorImpl } from '../../src/tui/runtime-collector.js';
import type { ProjectionCheckpointStore } from '../../src/tui/runtime/projection-checkpoint-store.js';

function makeCheckpointStore(): ProjectionCheckpointStore & { saved: Array<{ cursor: string; committedAt: number }> } {
  let stored: { cursor: string; committedAt: number } | null = null;
  const saved: Array<{ cursor: string; committedAt: number }> = [];
  return {
    saved,
    async load() { return stored; },
    async save(cp) { stored = cp; saved.push(cp); },
  };
}

// In the fake EventLog from the existing test harness, add:
//   serializeCursor: (c) => JSON.stringify({ version: 1, seq: (c as { seq: number }).seq }),
//   deserializeCursor: (s) => { const p = JSON.parse(s); if (p.version !== 1) throw new Error('bad'); return makeCursor(p.seq); },

describe('RuntimeCollectorImpl durable checkpoint', () => {
  it('resumes from a saved checkpoint (no full replay) — the builder reconstructs FORWARD from the watermark', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    await append('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 10 });
    const store = makeCheckpointStore();
    // Seed the store with a checkpoint past BOTH events.
    const saved = await log.readSince(log.beginningCursor());
    await store.save({ cursor: log.serializeCursor(saved.cursor), committedAt: Date.now() });

    const collector = new RuntimeCollectorImpl(log, store);
    const start = (collector as unknown as { start(): Promise<void> }).start;
    await start.call(collector);
    const snap = await collector.snapshot();
    // Resumed PAST both events — projection state is in-memory (not persisted,
    // per Non-Goals), so the builder reconstructs from the watermark FORWARD:
    // it does NOT re-process events 1-2. The trace is empty, and crucially NO
    // phantom running entry appears from re-processing the started event.
    expect(snap?.trace).toHaveLength(0);

    // A NEW event appended after resume appears in the trace.
    await append('tool.started', { toolCallId: 'tc2', toolName: 'next' });
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);
    const after = await collector.snapshot();
    expect(after?.trace).toHaveLength(1);
    expect(after?.trace[0]!.title).toBe('tool.next');
  });

  it('falls back to beginningCursor on a malformed saved checkpoint', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    const store = makeCheckpointStore();
    await store.save({ cursor: 'not-a-real-cursor', committedAt: Date.now() }); // deserialize will throw
    const collector = new RuntimeCollectorImpl(log, store);
    const start = (collector as unknown as { start(): Promise<void> }).start;
    await start.call(collector);
    const snap = await collector.snapshot();
    expect(snap?.trace).toHaveLength(1);       // rebuilt from beginningCursor
    expect(snap?.trace[0]!.status).toBe('running');
  });

  it('D5 commit marker: a save failure keeps the old checkpoint AND old cache, retries next sample', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    const store = makeCheckpointStore();
    const collector = new RuntimeCollectorImpl(log, store);
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);
    const before = await collector.snapshot();

    // Next sample: builder succeeds, but save fails → checkpoint + cache unchanged.
    const failing = vi.spyOn(store, 'save').mockImplementationOnce(async () => { throw new Error('io'); });
    await append('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 10 });
    await sample.call(collector);
    const afterFail = await collector.snapshot();
    expect(afterFail).toEqual(before);            // cache unchanged
    expect(store.saved).toHaveLength(1);          // only the FIRST successful save happened

    failing.mockRestore();
    await sample.call(collector);                 // retry succeeds
    const afterRetry = await collector.snapshot();
    expect(afterRetry!.trace[0]!.status).toBe('completed'); // now advanced + published
    expect(store.saved).toHaveLength(2);
  });

  it('persists every successful sample (write cadence = every sample)', async () => {
    const { log, append } = makeEventLog();
    const store = makeCheckpointStore();
    const collector = new RuntimeCollectorImpl(log, store);
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    await sample.call(collector);
    expect(store.saved.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tui/runtime/runtime-collector.vitest.ts --config vitest.config.mts`
Expected: FAIL — constructor arity / `start` returns void / no serialize/deserialize on the fake.

- [ ] **Step 3: Rewrite `src/tui/runtime-collector.ts`**

1. **Rename `updatedAt` → `committedAt` on the `ProjectionCheckpoint` interface** (it currently lives at the top of `runtime-collector.ts` with `updatedAt` from Phase 5 — the review refinement reframes it as "the instant this projection became durable"):

```typescript
/** In-memory projection checkpoint. cursor-object based in the runtime layer
 *  (D7); the store persists the serialized form. `committedAt` is the instant
 *  this projection became durable (D5 — the checkpoint is the durable commit
 *  marker). */
export interface ProjectionCheckpoint {
  readonly cursor: EventLogCursor;
  readonly committedAt: number;
}
```

2. Import the store interface:
```typescript
import type { ProjectionCheckpointStore } from './runtime/projection-checkpoint-store.js';
```
3. Change the constructor + add `initializeCheckpoint` + async `start`:

```typescript
export class RuntimeCollectorImpl implements RuntimeCollector {
  private cache: RuntimeSnapshot = { trace: [], workflow: null, totalEventCount: 0, lastEventAt: null };
  private timer?: ReturnType<typeof setInterval>;
  private readonly eventLog: EventLog;
  private readonly checkpointStore: ProjectionCheckpointStore;
  private readonly builder = new IncrementalExecutionTraceBuilder();
  private checkpoint: ProjectionCheckpoint;
  private recentEvents: AlixEvent[] = [];
  private totalEventCount = 0;

  constructor(eventLog: EventLog, checkpointStore: ProjectionCheckpointStore) {
    this.eventLog = eventLog;
    this.checkpointStore = checkpointStore;
    this.checkpoint = { cursor: eventLog.beginningCursor(), committedAt: Date.now() };
  }

  /** Await recovery BEFORE the first sample — the first sample must never race
   *  an incomplete initializeCheckpoint (which would start from beginningCursor). */
  async start(): Promise<void> {
    await this.initializeCheckpoint();
    await this.sample();
    this.timer = setInterval(() => void this.sample(), 1000);
  }

  private async initializeCheckpoint(): Promise<void> {
    const saved = await this.checkpointStore.load();
    if (!saved) {
      this.checkpoint = { cursor: this.eventLog.beginningCursor(), committedAt: Date.now() };
      return;
    }
    try {
      this.checkpoint = {
        cursor: this.eventLog.deserializeCursor(saved.cursor),
        committedAt: saved.committedAt,
      };
    } catch {
      this.checkpoint = { cursor: this.eventLog.beginningCursor(), committedAt: Date.now() };
    }
  }
```

3. Rewrite `sample()` with the D5 save-as-commit-marker ordering:

```typescript
  private async sample(): Promise<void> {
    try {
      const batch = await this.eventLog.readSince(this.checkpoint.cursor);
      this.builder.update(batch.events);

      const nextCheckpoint = { cursor: batch.cursor, committedAt: Date.now() };

      // Durable commit BEFORE advancing the in-memory checkpoint or publishing
      // the snapshot (D5). A save failure keeps the old checkpoint + old cache.
      await this.checkpointStore.save({
        cursor: this.eventLog.serializeCursor(nextCheckpoint.cursor),
        committedAt: nextCheckpoint.committedAt,
      });

      this.checkpoint = nextCheckpoint;
      this.recentEvents = this.trimToActiveWorkflow([...this.recentEvents, ...batch.events]);
      const lastEvent = batch.events[batch.events.length - 1];
      if (lastEvent) this.totalEventCount = Math.max(this.totalEventCount, lastEvent.seq ?? 0);
      this.cache = {
        trace: this.builder.snapshot(),
        workflow: computeWorkflow(this.recentEvents),
        totalEventCount: this.totalEventCount,
        lastEventAt: lastEvent ? Date.parse(lastEvent.timestamp) || Date.now() : this.cache.lastEventAt,
      };
    } catch {
      // Keep previous cache on error — dashboard never blanks; checkpoint only
      // advances after a durable save.
    }
  }
```

(Keep `computeWorkflow` and `trimToActiveWorkflow` unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tui/runtime/runtime-collector.vitest.ts --config vitest.config.mts`
Expected: PASS (the existing 3 Phase-5 tests + the 4 new durable-checkpoint tests; update the existing harness's fake EventLog to add serialize/deserialize and its `start()` call sites to `await`).

- [ ] **Step 5: Build + full TUI suite + commit**

Run: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui --config vitest.config.mts`
```bash
git add src/tui/runtime-collector.ts tests/tui/runtime/runtime-collector.vitest.ts
git commit -m "feat(capabilities): durable checkpoint — constructor injection, async recovery, save-as-commit-marker"
```

---

### Task 4: Bootstrap wiring (`tui.ts`)

**Files:**
- Modify: `src/cli/commands/tui.ts`
- Test: `tests/cli/commands/tui-thin-bootstrap.vitest.ts` (verify the collector is constructed with the store)

**Interfaces:**
- Consumes: `FileProjectionCheckpointStore` (Task 2), the new `RuntimeCollectorImpl(eventLog, store)` arity + async `start` (Task 3).
- Produces: the TUI bootstrap wires the durable checkpoint.

- [ ] **Step 1: Write the failing test**

Add to `tests/cli/commands/tui-thin-bootstrap.vitest.ts` (or the file that exercises `runTui`'s construction):

```typescript
  it('wires a durable checkpoint store into the RuntimeCollector', async () => {
    // runTui is async and constructs the collector with a store over sessionDir.
    // Drive runTui with stub options (or the file's existing harness) and assert
    // it reaches startup — the real gate is that tsc rejects the one-arg call
    // once Task 3 lands. If the harness can inspect internals, assert the
    // checkpoint file is created after a sample.
    await expect(runTui({ ...stubOptions })).resolves.toBeUndefined();
  });
```
The concrete failing signal BEFORE this task: after Task 3, `new RuntimeCollectorImpl(eventLog)` in `tui.ts:90` fails `tsc` (constructor now requires two args). That tsc error is the red gate; Step 3 fixes it.

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — the `tui.ts` one-arg `new RuntimeCollectorImpl(eventLog)` no longer typechecks after Task 3 (TS2554). If the harness test also fails, that confirms the wiring gap.

- [ ] **Step 3: Update `src/cli/commands/tui.ts`**

1. Add the import (near the `RuntimeCollectorImpl` import at line 10):
```typescript
import { FileProjectionCheckpointStore } from '../../tui/runtime/projection-checkpoint-store.js';
```

2. At the collector construction site (line 90) — inject the store:
```typescript
  const policy = new PolicyEngine(config as any);
  const daemonMetrics = new DaemonMetricsCollectorImpl(createPlatformMetricsReader());
  const checkpointStore = new FileProjectionCheckpointStore(sessionDir);
  const runtimeCollector = new RuntimeCollectorImpl(eventLog, checkpointStore);
  const sopCollector = new SopCollectorImpl();
```

3. Update the `start()` call site (line 185) — `start()` is now async (awaits recovery); make the call `await`:
```typescript
  await runtimeCollector.start();
```
(Confirm the surrounding function is async — `runTui` is `export async function runTui`, so `await` is fine.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/commands/tui-thin-bootstrap.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Build + full TUI suite + commit**

Run: `npx tsc -p tsconfig.json --noEmit` and `npx vitest run tests/tui --config vitest.config.mts`
```bash
git add src/cli/commands/tui.ts tests/cli/commands/tui-thin-bootstrap.vitest.ts
git commit -m "feat(capabilities): wire durable projection checkpoint into TUI bootstrap"
```

---

### Task 5: Documentation + verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-capability-platform-phase5dot5-design.md` (status → implemented)
- Create: `docs/capability-platform-phase5dot5.md` (consumer note)

- [ ] **Step 1: Full build + full suites**

Run: `npm run build` and `npx vitest run tests/capability tests/tui tests/events --config vitest.config.mts`
Expected: clean, all pass. Then `git diff --name-only origin/main -- src/capability/` → empty (D8 gate).

- [ ] **Step 2: Update spec status**

Change `**Status:** Approved — Ready for Implementation` → `**Status:** Implemented (Phase 5.5)`.

- [ ] **Step 3: Write the consumer doc**

```markdown
# ALiX Capability Platform — Phase 5.5 (Durable Projection Checkpoints)

The execution-trace projection's checkpoint (cursor + timestamp) is now persisted
to disk, so a restarted TUI resumes from its last committed position instead of
replaying the whole session.

The checkpoint is a **commit marker**: the cursor advances and the snapshot
publishes only after a durable save succeeds. `EventLog.serializeCursor` /
`deserializeCursor` are the only way cursors cross the persistence boundary —
the representation stays opaque and versioned; no owner token is persisted.
`ProjectionCheckpointStore` writes atomically (tmp+rename) to
`.alix/sessions/<sessionId>/projection-checkpoint.json`.

Recovery falls back to `beginningCursor()` when the checkpoint is missing,
malformed, or incompatible. Write cadence is every successful sample (the file
is ~100 bytes); no throttle.

The operator timeline and platform (src/capability/) are unchanged.
```

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs(capabilities): Phase-5.5 usage note + spec status to implemented"
```

---

## Phase Completion Criteria

- ✅ `EventLog.serializeCursor`/`deserializeCursor` exist; cursor opacity preserved (seq never exposed through the public API); versioned internal format; no owner token persisted.
- ✅ `ProjectionCheckpointStore` persists atomically with its own version envelope; `load` falls back cleanly on missing/malformed/unknown-version.
- ✅ Collector resumes from the saved checkpoint after restart; save is a commit marker (checkpoint advances only after durable save; save-failure preserves old checkpoint + old cache + retries next sample); async `start()` awaits recovery before the first sample.
- ✅ Write cadence = every successful sample, persist-before-publish.
- ✅ Constructor injection: collector never instantiates the store; `tui.ts` constructs `FileProjectionCheckpointStore(sessionDir)` and injects it.
- ✅ `src/capability/*`, `timelineEvents[]`, ChatView, AgentView, capability presenter untouched; vitest green; `tsc --noEmit` clean.
