import { describe, it, expect, vi } from 'vitest';
import { RuntimeCollectorImpl } from '../../../src/tui/runtime-collector.js';
import { EventLogCursorError } from '../../../src/events/event-log.js';
import type { EventLog, EventLogCursor } from '../../../src/events/event-log.js';
import type { AlixEvent } from '../../../src/events/types.js';
import type { PersistedProjectionCheckpoint, ProjectionCheckpointStore } from '../../../src/tui/runtime/projection-checkpoint-store.js';

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
    // Task 1 surface: serialize/deserialize round-trip the fake cursor via the
    // same versioned JSON envelope the real EventLog uses (seq is the only
    // durable field; owner is NOT persisted).
    serializeCursor: (c: EventLogCursor) => JSON.stringify({ version: 1, seq: (c as unknown as { seq: number }).seq }),
    deserializeCursor: (s: string) => {
      const p = JSON.parse(s) as { version: number; seq: number };
      if (p.version !== 1) throw new Error('unknown version');
      return makeCursor(p.seq);
    },
  } as unknown as EventLog;
  return {
    log,
    append: async (type, payload = {}) => {
      seq++;
      events.push({ id: `e${seq}`, seq, version: 1, sessionId: 's', timestamp: new Date(seq * 1000).toISOString(), type, actor: 'system', payload });
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

describe('RuntimeCollectorImpl incremental', () => {
  it('starts from beginningCursor and consumes incrementally (no readAll in the loop)', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    const collector = new RuntimeCollectorImpl(log, makeCheckpointStore());
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

  // Note: `builder` is `private readonly` (TS private, not #private) so it IS
  // reachable via the cast at runtime — the spy works. `sample.call(collector)`
  // does NOT throw outward because sample() has its own try/catch; the assertion
  // that afterFail.trace is empty is what proves the first sample didn't populate.
  it('builder failure does NOT advance the checkpoint — next sample re-reads the same events (D3a)', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    const collector = new RuntimeCollectorImpl(log, makeCheckpointStore());
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
    const collector = new RuntimeCollectorImpl(log, makeCheckpointStore());
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

describe('RuntimeCollectorImpl durable checkpoint', () => {
  it('resumes from a saved checkpoint (no full replay) — the builder reconstructs FORWARD from the watermark', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    await append('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 10 });
    const store = makeCheckpointStore();
    // Seed the store with a checkpoint past BOTH events.
    const saved = await log.readSince(log.beginningCursor());
    await store.save({ version: 1, cursor: log.serializeCursor(saved.cursor), committedAt: Date.now() });

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
    collector.stop();
  });

  it('falls back to beginningCursor on a malformed saved checkpoint', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    const store = makeCheckpointStore();
    await store.save({ version: 1, cursor: 'not-a-real-cursor', committedAt: Date.now() }); // deserialize will throw
    const collector = new RuntimeCollectorImpl(log, store);
    const start = (collector as unknown as { start(): Promise<void> }).start;
    await start.call(collector);
    const snap = await collector.snapshot();
    expect(snap?.trace).toHaveLength(1);       // rebuilt from beginningCursor
    expect(snap?.trace[0]!.status).toBe('running');
    collector.stop();
  });

  it('a rejecting checkpointStore.load() falls back to beginningCursor and start() still resolves', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    const rejecting = {
      saved: [] as Array<{ cursor: string; committedAt: number }>,
      async load() { throw new Error('io'); },                 // fs read rejection
      async save(cp: { cursor: string; committedAt: number }) { this.saved.push(cp); },
    };
    const collector = new RuntimeCollectorImpl(log, rejecting);
    const start = (collector as unknown as { start(): Promise<void> }).start;
    await expect(start.call(collector)).resolves.toBeUndefined();  // must NOT reject
    const snap = await collector.snapshot();
    expect(snap?.trace).toHaveLength(1);   // sampled from beginningCursor (the tool.started is visible)
    expect(snap?.trace[0]!.status).toBe('running');
    collector.stop();
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
    // D5a sentinel invariant: a successful sample overwrites the in-memory
    // checkpoint with a real `committedAt` (not the 0 sentinel that the
    // constructor sets when no checkpoint has been durably saved yet).
    // The retry's save must have a real timestamp on the last persisted
    // checkpoint, NOT 0.
    const lastSaved = store.saved[store.saved.length - 1]!;
    expect(lastSaved.committedAt).toBeGreaterThan(0);
  });

  // Whole-branch review fix (Option A): a checkpoint whose `seq` lies past
  // the active EventLog head must NOT silently skip events. The real
  // EventLog.deserializeCursor throws `EventLogCursorError` for that case;
  // we replicate the behavior on the mock and verify the collector falls
  // back to `beginningCursor()` and the projection re-replays the events.
  it('Beyond-head checkpoint (EventLogCursorError) → falls back to beginningCursor and re-replays', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    await append('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 10 });
    // Mock's current head is seq=2 (two events). A checkpoint at seq=999 is
    // beyond-head. Mirror the real EventLog: throw EventLogCursorError.
    (log as unknown as { deserializeCursor: (s: string) => EventLogCursor }).deserializeCursor = (s: string) => {
      const p = JSON.parse(s) as { version: number; seq: number };
      if (p.version !== 1) throw new EventLogCursorError('unknown version');
      if (p.seq > 2) throw new EventLogCursorError('Serialized cursor position is beyond the current EventLog head');
      return { seq: p.seq, owner: Symbol('mock') } as unknown as EventLogCursor;
    };
    const store = makeCheckpointStore();
    // Persist a checkpoint whose seq (999) is well past the current head (2).
    await store.save({ version: 1, cursor: JSON.stringify({ version: 1, seq: 999 }), committedAt: 1_700_000_000_000 });

    const collector = new RuntimeCollectorImpl(log, store);
    const start = (collector as unknown as { start(): Promise<void> }).start;
    await start.call(collector);
    const snap = await collector.snapshot();
    // Must have re-replayed from beginningCursor: the tool.started event is
    // visible in the trace, and the subsequent tool.completed reconciled it
    // to 'completed' (the first sample after reset consumes BOTH events).
    expect(snap?.trace).toHaveLength(1);
    expect(snap?.trace[0]!.status).toBe('completed');
    expect(snap?.totalEventCount).toBe(2);
    // And the on-disk checkpoint must have been overwritten with a valid
    // (non-beyond-head) position.
    expect(store.saved.length).toBeGreaterThanOrEqual(2);
    const lastSaved = store.saved[store.saved.length - 1]!;
    expect(JSON.parse(lastSaved.cursor).seq).toBeLessThanOrEqual(2);
    collector.stop();
  });

  // Operational vs invalid-cursor discrimination: a plain Error from
  // readSince (e.g., a transient disk read) must NOT trigger resetCheckpoint
  // — the previous cache and checkpoint are preserved so the dashboard
  // never blanks. The next successful sample advances both.
  it('Operational readSince error (non-EventLogCursorError) preserves the previous cache and checkpoint', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    const collector = new RuntimeCollectorImpl(log, makeCheckpointStore());
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);
    const before = await collector.snapshot();

    // Force a plain (operational) readSince rejection — NOT an EventLogCursorError.
    const origRead = log.readSince.bind(log);
    (log as unknown as { readSince: unknown }).readSince = async () => { throw new Error('disk read failed'); };
    await sample.call(collector);
    const after = await collector.snapshot();
    expect(after).toEqual(before);              // cache unchanged — dashboard never blanks
    (log as unknown as { readSince: unknown }).readSince = origRead;

    // Subsequent successful sample advances the cache normally.
    await append('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 10 });
    await sample.call(collector);
    const afterRetry = await collector.snapshot();
    expect(afterRetry!.trace[0]!.status).toBe('completed');
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
