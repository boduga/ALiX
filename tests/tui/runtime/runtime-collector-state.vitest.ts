import { describe, it, expect } from 'vitest';
import { RuntimeCollectorImpl } from '../../../src/tui/runtime-collector.js';
import { TimelineBuilder } from '../../../src/tui/runtime/timeline-builder.js';
import { CHECKPOINT_CONTAINER_VERSION } from '../../../src/tui/runtime/projection-checkpoint-store.js';
import type { EventLog, EventLogCursor } from '../../../src/events/event-log.js';
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
    deserializeCursor: (s: string) => makeCursor(JSON.parse(s).seq),
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
    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, timelineBuilder: makeTimeline(SESSION_ID) });
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);

    const lastSave = store.saved[store.saved.length - 1]!;
    expect(lastSave.version).toBe(CHECKPOINT_CONTAINER_VERSION);
    expect(lastSave.state).toBeDefined();
    expect(lastSave.state!.timeline).toBeDefined();
    expect(lastSave.state!.timeline!.entries).toHaveLength(1);
    expect(lastSave.state!.trace).toBeDefined();
  });

  it('restores timeline + trace state from the envelope on load (no replay of old events)', async () => {
    const { log, append } = makeEventLog();
    await append('chat.message', { text: 'hi' });
    await append('tool.started', { toolCallId: 't1', toolName: 'x' });
    const store = makeCheckpointStore();
    const first = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, timelineBuilder: makeTimeline(SESSION_ID) });
    const sample = (first as unknown as { sample(): Promise<void> }).sample;
    await sample.call(first);

    // New collector, same store — should restore state directly.
    const second = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, timelineBuilder: makeTimeline(SESSION_ID) });
    await second.start();
    const snap = await second.snapshot();
    expect(snap?.timeline).toHaveLength(1);
    expect(snap?.timeline[0]!.text).toBe('hi');
    expect(snap?.trace).toHaveLength(1);
    expect(snap?.trace[0]!.status).toBe('running');
    second.stop();
  });

  it('falls back to replay-from-cursor when the envelope has no state (legacy checkpoint)', async () => {
    const { log, append } = makeEventLog();
    await append('chat.message', { text: 'hi' });
    const store = makeCheckpointStore();
    // Seed a legacy checkpoint (no state) at seq=1.
    await store.save({ version: CHECKPOINT_CONTAINER_VERSION, cursor: log.serializeCursor({ seq: 1, owner: Symbol('x') } as never), committedAt: 5 });

    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, timelineBuilder: makeTimeline(SESSION_ID) });
    await collector.start();
    const snap = await collector.snapshot();
    // Cursor at 1 means event 1 is NOT re-read; state was absent, so timeline is empty.
    expect(snap?.timeline).toEqual([]);
    collector.stop();
  });

  it('buildTimeline:false collector does NOT persist timeline state (trace only)', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 't1', toolName: 'x' });
    const store = makeCheckpointStore();
    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, buildTimeline: false });
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);
    const lastSave = store.saved[store.saved.length - 1]!;
    expect(lastSave.state!.timeline).toBeUndefined();
    expect(lastSave.state!.trace).toBeDefined();
    collector.stop();
  });
});
