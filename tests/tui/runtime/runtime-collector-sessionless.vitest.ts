import { describe, expect, it, vi } from 'vitest';
import { RuntimeCollectorImpl, splitSessionless } from '../../../src/tui/runtime-collector.js';
import { EventLogCursorError } from '../../../src/events/event-log.js';
import type { EventLog, EventLogCursor } from '../../../src/events/event-log.js';
import type { AlixEvent } from '../../../src/events/types.js';
import type { PersistedProjectionCheckpoint, ProjectionCheckpointStore } from '../../../src/tui/runtime/projection-checkpoint-store.js';
import type { ProjectionBuilder } from '../../../src/tui/runtime/projection-builder.js';
import { ProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';

/** Default session stamped by makeEventLog's append when no sessionId is
 *  passed (mirrors the single-session world of the existing collector tests). */
const SESSION_ID = 's';

function ev(seq: number, sessionId: string): any {
  return { seq, sessionId, type: 'test.event', timestamp: '', payload: {} };
}

describe('splitSessionless', () => {
  it('partitions a batch into session-matching and sessionless events', () => {
    const batch = [ev(1, 'sess-1'), ev(2, ''), ev(3, 'sess-1'), ev(4, '')];
    const { session, sessionless } = splitSessionless(batch, 'sess-1');
    expect(session.map((e) => e.seq)).toEqual([1, 3]);
    expect(sessionless.map((e) => e.seq)).toEqual([2, 4]);
  });

  it('keeps the full batch when everything matches the session', () => {
    const batch = [ev(1, 'a'), ev(2, 'a')];
    const { session, sessionless } = splitSessionless(batch, 'a');
    expect(session).toHaveLength(2);
    expect(sessionless).toHaveLength(0);
  });
});

// ---- Collector-level relay contract (Q-C4) — reuses the in-memory EventLog
// + ProjectionCheckpointStore harness from runtime-collector.vitest.ts.

/** In-memory EventLog fake. `readSince` mirrors the real EventLog: a cursor
 *  whose seq lies past the current head throws EventLogCursorError (so the
 *  collector discriminates the beyond-head fallback); serialized cursors
 *  round-trip through the same versioned JSON envelope. */
function makeEventLog(): { log: EventLog; append: (type: string, payload?: Record<string, unknown>, sessionId?: string) => Promise<void> } {
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
      if (internal.seq > seq) throw new EventLogCursorError('Cursor position beyond current EventLog head');
      const newer = events.filter(e => e.seq > internal.seq);
      const last = newer.length ? newer[newer.length - 1]!.seq : internal.seq;
      return { events: newer, cursor: makeCursor(last) };
    },
    cursorsEqual: (a: EventLogCursor, b: EventLogCursor) =>
      (a as unknown as { seq: number }).seq === (b as unknown as { seq: number }).seq,
    serializeCursor: (c: EventLogCursor) => JSON.stringify({ version: 1, seq: (c as unknown as { seq: number }).seq }),
    deserializeCursor: (s: string) => {
      const p = JSON.parse(s) as { version: number; seq: number };
      if (p.version !== 1) throw new Error('unknown version');
      if (p.seq > seq) throw new EventLogCursorError('Serialized cursor position is beyond the current EventLog head');
      return makeCursor(p.seq);
    },
  } as unknown as EventLog;
  return {
    log,
    append: async (type, payload = {}, sessionId = SESSION_ID) => {
      seq++;
      events.push({ id: `e${seq}`, seq, version: 1, sessionId, timestamp: new Date(seq * 1000).toISOString(), type, actor: 'system', payload });
    },
  };
}

/** In-memory ProjectionCheckpointStore. `saved` records every successful
 *  save() so tests can assert write cadence / commit-marker behavior. */
function makeCheckpointStore(): ProjectionCheckpointStore & { saved: Array<{ cursor: string; committedAt: number }> } {
  let stored: PersistedProjectionCheckpoint | null = null;
  const saved: Array<{ cursor: string; committedAt: number }> = [];
  return {
    saved,
    async load() { return stored; },
    async save(cp) { stored = cp; saved.push(cp); },
  };
}

/** A no-op projection builder — these relay tests assert which events reach
 *  `updateAll` / the relay, not the projection outputs, so no real builder is
 *  needed (a real trace/timeline builder would also reject the synthetic
 *  `test.event` type). */
function makeDummyBuilder(): ProjectionBuilder<unknown> {
  return { update: () => {}, snapshot: () => ({}), reset: () => {} };
}

/** Build a collector whose `updateAll` is spied (call-through — the dummy
 *  builder is a no-op, so the spy's mock.calls expose exactly the session
 *  batch each sample dispatched). */
function makeCollector(overrides: { log: EventLog; store: ProjectionCheckpointStore; relay?: (events: readonly AlixEvent[]) => void }) {
  const runtime = new ProjectionRuntime();
  runtime.register('trace', makeDummyBuilder());
  const updateAllSpy = vi.spyOn(runtime, 'updateAll');
  const collector = new RuntimeCollectorImpl({
    eventLog: overrides.log,
    checkpointStore: overrides.store,
    sessionId: SESSION_ID,
    projectionRuntime: runtime,
    ...(overrides.relay ? { sessionlessEvents: overrides.relay } : {}),
  });
  const sample = (collector as unknown as { sample(): Promise<void> }).sample;
  return { collector, runtime, updateAllSpy, sample };
}

describe('RuntimeCollectorImpl Q-C4 sessionless relay', () => {
  it('WITHOUT sessionlessEvents: session-matching events still reach updateAll (existing behavior preserved)', async () => {
    const { log, append } = makeEventLog();
    await append('test.event', {}, SESSION_ID);
    await append('test.event', {}, '');          // sessionless — dropped as today
    const store = makeCheckpointStore();
    const { collector, updateAllSpy, sample } = makeCollector({ log, store });
    await sample.call(collector);

    // Only the session-matching event reached the projections.
    expect(updateAllSpy).toHaveBeenCalledTimes(1);
    expect(updateAllSpy.mock.calls[0]![0]!.map((e) => e.seq)).toEqual([1]);
    // The sessionless event did not leak into the session projection state.
    const snap = await collector.snapshot();
    expect(snap!.totalEventCount).toBe(1);
    // Checkpoint still advanced over the FULL batch (sessionless events are
    // consumed from the log cursor, not re-read).
    expect(store.saved).toHaveLength(1);
    collector.stop();
  });

  it('WITH sessionlessEvents: calls the relay once per sample with exactly the current batch sessionId === "" events', async () => {
    const { log, append } = makeEventLog();
    await append('test.event', {}, SESSION_ID);   // seq 1 — session
    await append('test.event', {}, '');            // seq 2 — sessionless
    await append('test.event', {}, SESSION_ID);    // seq 3 — session
    await append('test.event', {}, '');            // seq 4 — sessionless
    const relay = vi.fn<(events: readonly AlixEvent[]) => void>();
    const { collector, updateAllSpy, sample } = makeCollector({ log, store: makeCheckpointStore(), relay });
    await sample.call(collector);

    // Session events → projections; sessionless events → relay (once).
    expect(updateAllSpy).toHaveBeenCalledTimes(1);
    expect(updateAllSpy.mock.calls[0]![0]!.map((e) => e.seq)).toEqual([1, 3]);
    expect(relay).toHaveBeenCalledTimes(1);
    expect(relay.mock.calls[0]![0]!.map((e) => e.seq)).toEqual([2, 4]);

    // A second sample relays ONLY that sample's newly-read sessionless events.
    await append('test.event', {}, '');            // seq 5 — sessionless
    await sample.call(collector);
    expect(relay).toHaveBeenCalledTimes(2);
    expect(relay.mock.calls[1]![0]!.map((e) => e.seq)).toEqual([5]);
    collector.stop();
  });

  it('sessionless events NEVER reach updateAll', async () => {
    const { log, append } = makeEventLog();
    await append('test.event', {}, SESSION_ID);   // seq 1 — session
    await append('test.event', {}, '');            // seq 2 — sessionless
    await append('test.event', {}, SESSION_ID);    // seq 3 — session
    await append('test.event', {}, '');            // seq 4 — sessionless
    const relay = vi.fn<(events: readonly AlixEvent[]) => void>();
    const { collector, updateAllSpy, sample } = makeCollector({ log, store: makeCheckpointStore(), relay });
    await sample.call(collector);

    expect(updateAllSpy).toHaveBeenCalledTimes(1);
    expect(updateAllSpy.mock.calls[0]![0]!.map((e) => e.seq)).toEqual([1, 3]); // ONLY session events
    expect(relay.mock.calls[0]![0]!.map((e) => e.seq)).toEqual([2, 4]);        // ONLY sessionless
    collector.stop();
  });

  it('on a checkpoint save rejection the next sample re-reads the same batch and the relay is called AGAIN with the same sessionless events', async () => {
    const { log, append } = makeEventLog();
    await append('test.event', {}, SESSION_ID);    // seq 1 — session
    await append('test.event', {}, '');             // seq 2 — sessionless
    const store = makeCheckpointStore();
    const relay = vi.fn<(events: readonly AlixEvent[]) => void>();
    const { collector, sample } = makeCollector({ log, store, relay });
    await sample.call(collector);
    expect(relay.mock.calls[0]![0]!.map((e) => e.seq)).toEqual([2]);   // first relay of the sessionless batch

    // Next sample: read succeeds, relay fires, but the save rejects → the
    // checkpoint does not advance, so the next sample re-reads the same batch.
    await append('test.event', {}, '');             // seq 3 — sessionless (newly-read)
    const failing = vi.spyOn(store, 'save').mockImplementationOnce(async () => { throw new Error('io'); });
    await sample.call(collector);
    expect(relay).toHaveBeenCalledTimes(2);
    expect(relay.mock.calls[1]![0]!.map((e) => e.seq)).toEqual([3]);

    failing.mockRestore();
    await sample.call(collector);
    // Same batch re-read (seq 3 still the only uncommitted event) → relay called
    // AGAIN with the identical sessionless events. The consumer dedupes (Task 5).
    expect(relay).toHaveBeenCalledTimes(3);
    expect(relay.mock.calls[2]![0]!.map((e) => e.seq)).toEqual([3]);
    expect(store.saved.length).toBeGreaterThanOrEqual(2);   // retry eventually committed
  });
});
