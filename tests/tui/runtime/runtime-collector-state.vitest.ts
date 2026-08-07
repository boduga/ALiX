import { describe, it, expect } from 'vitest';
import { RuntimeCollectorImpl } from '../../../src/tui/runtime-collector.js';
import { TimelineBuilder } from '../../../src/tui/runtime/timeline-builder.js';
import { IncrementalExecutionTraceBuilder } from '../../../src/tui/runtime/execution-trace-builder.js';
import { createProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';
import { CHECKPOINT_CONTAINER_VERSION } from '../../../src/tui/runtime/projection-checkpoint-store.js';
import { EventLogCursorError, type EventLog, type EventLogCursor } from '../../../src/events/event-log.js';
import type { AlixEvent } from '../../../src/events/types.js';
import type { PersistedProjectionCheckpoint, ProjectionCheckpointStore } from '../../../src/tui/runtime/projection-checkpoint-store.js';

const SESSION_ID = 's';
function makeTimeline(sessionId: string): TimelineBuilder { return new TimelineBuilder(sessionId); }

function makeEventLog(): { log: EventLog; append: (type: string, payload?: Record<string, unknown>, sessionId?: string) => Promise<void> } {
  let seq = 0;
  const events: AlixEvent[] = [];
  const owner = Symbol('test-owner');
  const makeCursor = (s: number) => ({ seq: s, owner }) as unknown as EventLogCursor;
  const beginning = makeCursor(0);
  const log = {
    beginningCursor: () => beginning,
    readSince: async (c: EventLogCursor) => {
      const internal = c as unknown as { seq: number; owner: symbol };
      if (internal.owner !== owner) throw new Error('foreign');
      const newer = events.filter((e) => e.seq > internal.seq);
      const last = newer.length ? newer[newer.length - 1]!.seq : internal.seq;
      return { events: newer, cursor: makeCursor(last) };
    },
    serializeCursor: (c: EventLogCursor) => JSON.stringify({ version: 1, seq: (c as unknown as { seq: number }).seq }),
    deserializeCursor: (s: string) => {
      const p = JSON.parse(s) as { version: number; seq: number };
      if (p.version !== 1) throw new EventLogCursorError('unknown version');
      // Mirror real EventLog (event-log.ts): a serialized seq beyond the
      // current head is an invalid cursor — throw so the collector
      // discriminates the beyond-head recovery path and never trusts state.
      if (p.seq > seq) throw new EventLogCursorError('Cursor position beyond current EventLog head');
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

function makeCheckpointStore(): ProjectionCheckpointStore & { saved: PersistedProjectionCheckpoint[] } {
  let stored: PersistedProjectionCheckpoint | null = null;
  const saved: PersistedProjectionCheckpoint[] = [];
  return {
    saved,
    async load() { return stored; },
    async save(cp) { stored = cp; saved.push(cp); },
  };
}

describe('RuntimeCollectorImpl durable projection state (Phase 6.5)', () => {
  it('persists builder state in the checkpoint envelope on save', async () => {
    const { log, append } = makeEventLog();
    await append('chat.message', { text: 'hi' });
    const store = makeCheckpointStore();
    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', makeTimeline(SESSION_ID)], ['trace', new IncrementalExecutionTraceBuilder()]]) });
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);

    const lastSave = store.saved[store.saved.length - 1]!;
    expect(lastSave.version).toBe(CHECKPOINT_CONTAINER_VERSION);
    expect(lastSave.projections).toBeDefined();
    expect(lastSave.projections!.timeline).toBeDefined();
    expect(lastSave.projections!.timeline!.entries).toHaveLength(1);
    expect(lastSave.projections!.trace).toBeDefined();
  });

  it('restores timeline + trace state from the envelope on load (no replay of old events)', async () => {
    const { log, append } = makeEventLog();
    await append('chat.message', { text: 'hi' });
    await append('tool.started', { toolCallId: 't1', toolName: 'x' });
    const store = makeCheckpointStore();
    const first = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', makeTimeline(SESSION_ID)], ['trace', new IncrementalExecutionTraceBuilder()]]) });
    const sample = (first as unknown as { sample(): Promise<void> }).sample;
    await sample.call(first);

    // New collector, same store — should restore state directly.
    const second = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', makeTimeline(SESSION_ID)], ['trace', new IncrementalExecutionTraceBuilder()]]) });
    await second.start();
    const snap = await second.snapshot();
    expect(snap?.timeline).toHaveLength(2);
    expect(snap?.timeline[0]!.text).toBe('hi');
    expect(snap?.timeline[0]!.text).toBe('hi');
    expect(snap?.trace).toHaveLength(1);
    expect(snap?.trace[0]!.status).toBe('running');
    second.stop();
  });

  it('restores timeline from a legacy Phase-6.5 `state` envelope (legacy checkpoint honored)', async () => {
    const { log, append } = makeEventLog();
    await append('chat.message', { text: 'hi' }); // current head seq = 1
    const store = makeCheckpointStore();
    // Seed a legacy checkpoint carrying `state` (Phase 6.5 shape), no
    // `projections` — the collector's `loaded.projections ?? loaded.state`
    // must fall back to the legacy shape and restore the timeline entry.
    // Cursor at seq 1 (valid, at head) so the restore path runs; event 1 is
    // then NOT re-read, proving the timeline comes from persisted state.
    await store.save({
      version: CHECKPOINT_CONTAINER_VERSION,
      cursor: log.serializeCursor({ seq: 1, owner: Symbol('x') } as never),
      committedAt: 5,
      state: {
        timeline: {
          version: 1,
          entries: [
            { id: 'tl-legacy', kind: 'chat.message', sessionId: SESSION_ID, startedAt: 1000, text: 'legacy hi', sourceEvents: { firstSequence: 1 } },
          ],
        },
      },
    });

    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', makeTimeline(SESSION_ID)], ['trace', new IncrementalExecutionTraceBuilder()]]) });
    await collector.start();
    const snap = await collector.snapshot();
    // Legacy state honored: timeline entry restored without replay.
    expect(snap?.timeline).toHaveLength(1);
    expect(snap?.timeline[0]!.text).toBe('legacy hi');
    collector.stop();
  });

  it('falls back to replay-from-cursor when the envelope has no state (legacy checkpoint)', async () => {
    const { log, append } = makeEventLog();
    await append('chat.message', { text: 'hi' });
    const store = makeCheckpointStore();
    // Seed a legacy checkpoint (no state) at seq=1.
    await store.save({ version: CHECKPOINT_CONTAINER_VERSION, cursor: log.serializeCursor({ seq: 1, owner: Symbol('x') } as never), committedAt: 5 });

    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', makeTimeline(SESSION_ID)], ['trace', new IncrementalExecutionTraceBuilder()]]) });
    await collector.start();
    const snap = await collector.snapshot();
    // Cursor at 1 means event 1 is NOT re-read; state was absent, so timeline is empty.
    expect(snap?.timeline).toEqual([]);
    collector.stop();
  });

  it('trace-only collector does NOT persist timeline state (trace only)', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 't1', toolName: 'x' });
    const store = makeCheckpointStore();
    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['trace', new IncrementalExecutionTraceBuilder()]]) });
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);
    const lastSave = store.saved[store.saved.length - 1]!;
    expect(lastSave.projections!.timeline).toBeUndefined();
    expect(lastSave.projections!.trace).toBeDefined();
    collector.stop();
  });

  it('invalid (beyond-head) cursor discards persisted state and replays from beginningCursor', async () => {
    const { log, append } = makeEventLog();
    await append('chat.message', { text: 'hi' }); // current head seq = 1
    const store = makeCheckpointStore();
    // Seed a checkpoint whose cursor (seq 999) lies beyond the current head —
    // invalid per the EventLog contract — while its `state` block IS present.
    // The collector must NOT trust that state: it has to reset all projections
    // and replay from beginningCursor() (D12 / global constraint).
    await store.save({
      version: CHECKPOINT_CONTAINER_VERSION,
      cursor: log.serializeCursor({ seq: 999, owner: Symbol('x') } as never),
      committedAt: 5,
      state: {
        timeline: {
          version: 1,
          entries: [
            // A stale entry that replay could never produce — only visible if
            // the collector wrongly imported persisted state.
            { id: 'tl-stale', kind: 'chat.message', sessionId: SESSION_ID, startedAt: 1000, text: 'STALE', sourceEvents: { firstSequence: 1 } },
          ],
        },
      },
    });

    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', makeTimeline(SESSION_ID)], ['trace', new IncrementalExecutionTraceBuilder()]]) });
    await collector.start();
    const snap = await collector.snapshot();
    // State discarded: the timeline is rebuilt by replaying event 1, not the
    // seeded stale entry. (If persisted state had been trusted, the cursor
    // would sit at 999 and event 1 would never be re-read.)
    expect(snap?.timeline.map((e) => e.text)).toEqual(['hi']);
    // Recovery re-saved a fresh checkpoint: valid cursor at the replayed head,
    // stale state gone.
    const lastSave = store.saved[store.saved.length - 1]!;
    expect((JSON.parse(lastSave.cursor) as { seq: number }).seq).toBe(1);
    const timeline = lastSave.projections!.timeline as { entries: Array<{ text?: string }> };
    expect(timeline.entries.map((e) => e.text)).toEqual(['hi']);
    collector.stop();
  });
});
