import { describe, it, expect, vi } from 'vitest';
import { RuntimeCollectorImpl } from '../../../src/tui/runtime-collector.js';
import { EventLogCursorError } from '../../../src/events/event-log.js';
import type { EventLog, EventLogCursor } from '../../../src/events/event-log.js';
import type { AlixEvent } from '../../../src/events/types.js';
import type { PersistedProjectionCheckpoint, ProjectionCheckpointStore } from '../../../src/tui/runtime/projection-checkpoint-store.js';
import { TimelineBuilder } from '../../../src/tui/runtime/timeline-builder.js';
import { IncrementalExecutionTraceBuilder } from '../../../src/tui/runtime/execution-trace-builder.js';
import { CapabilityProjection } from '../../../src/tui/runtime/capability-projection.js';
import { MetricsProjection } from '../../../src/tui/runtime/metrics-projection.js';
import { createProjectionRuntime, ProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';
import { ProjectionIds } from '../../../src/tui/runtime/projection-ids.js';
import type { DurableProjectionBuilder } from '../../../src/tui/runtime/durable-projection-builder.js';

/** Default session stamped by makeEventLog's append when no sessionId is
 *  passed (the pre-Task-2 tests all used this single-session world). */
const SESSION_ID = 's';

function makeTimeline(sessionId: string): TimelineBuilder {
  return new TimelineBuilder(sessionId);
}

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
      // Mirror the real EventLog (event-log.ts): a cursor whose seq lies past
      // the current head is invalid — throw EventLogCursorError so the
      // collector discriminates the beyond-head fallback.
      if (internal.seq > seq) throw new EventLogCursorError('Cursor position beyond current EventLog head');
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
      // Mirror the real EventLog: a serialized seq beyond the current head is
      // invalid — throw EventLogCursorError so recovery resets to
      // beginningCursor() and re-replays.
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

describe('RuntimeCollectorImpl incremental', () => {
  it('starts from beginningCursor and consumes incrementally (no readAll in the loop)', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: makeCheckpointStore(), sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder(SESSION_ID)], ['trace', new IncrementalExecutionTraceBuilder()]]) });
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

  // `sample.call(collector)` does NOT throw outward because sample() has its own
  // try/catch; the assertion that afterFail.trace is empty is what proves the
  // first sample didn't populate. The test holds the trace builder instance (the
  // collector no longer owns builders — it hosts the ProjectionRuntime) so the
  // spy can force it to throw.
  it('builder failure does NOT advance the checkpoint — next sample re-reads the same events (D3a)', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    const traceBuilder = new IncrementalExecutionTraceBuilder();
    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: makeCheckpointStore(), sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder(SESSION_ID)], ['trace', traceBuilder]]) });
    // Force the trace builder's update to throw on the next sample.
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    const failOnce = vi.spyOn(traceBuilder, 'update').mockImplementationOnce(() => { throw new Error('boom'); });
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
    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: makeCheckpointStore(), sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder(SESSION_ID)], ['trace', new IncrementalExecutionTraceBuilder()]]) });
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

    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder(SESSION_ID)], ['trace', new IncrementalExecutionTraceBuilder()]]) });
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
    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder(SESSION_ID)], ['trace', new IncrementalExecutionTraceBuilder()]]) });
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
    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: rejecting, sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder(SESSION_ID)], ['trace', new IncrementalExecutionTraceBuilder()]]) });
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
    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder(SESSION_ID)], ['trace', new IncrementalExecutionTraceBuilder()]]) });
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

    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder(SESSION_ID)], ['trace', new IncrementalExecutionTraceBuilder()]]) });
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
    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: makeCheckpointStore(), sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder(SESSION_ID)], ['trace', new IncrementalExecutionTraceBuilder()]]) });
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
    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder(SESSION_ID)], ['trace', new IncrementalExecutionTraceBuilder()]]) });
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    await sample.call(collector);
    expect(store.saved.length).toBeGreaterThanOrEqual(2);
  });
});

describe('RuntimeCollectorImpl timeline projection (D1/D6/D12)', () => {
  it('snapshot.timeline contains chat events for this collector session (D1)', async () => {
    const { log, append } = makeEventLog();
    await append('chat.message', { text: 'hi' }, 'chat-1');
    await append('tool.started', { toolCallId: 't1', toolName: 'x' }, 'chat-1');
    await append('agent.message', { text: 'thinking' }, 'agent-1');   // wrong session → filtered out
    const chat = new RuntimeCollectorImpl({
      eventLog: log, checkpointStore: makeCheckpointStore(), sessionId: 'chat-1', projectionRuntime: createProjectionRuntime([['timeline', makeTimeline('chat-1')], ['trace', new IncrementalExecutionTraceBuilder()]]),
    });
    await chat.start();
    const snap = await chat.snapshot();
    expect(snap?.timeline.map(e => e.kind)).toEqual(['chat.message']);
    expect(snap?.sessionId).toBe('chat-1');
    chat.stop();
  });

  // Task 3.5 regression fix: an OUTER-scoped collector (sessionId = the outer
  // session, not a sub-session) projects the execution trace from outer-session
  // runtime/tool events. Capability/tool/runtime events are stamped with the
  // OUTER sessionId, so this is the collector that must feed SnapshotBuilder's
  // `runtime` arg (snapshot.runtime.trace → the Phase 4 Runtime tab).
  it('OUTER-scoped collector projects trace from outer-session events and filters sub-session events', async () => {
    const { log, append } = makeEventLog();
    // Runtime/tool events carry the OUTER sessionId; chat/agent tab events
    // carry their sub-session ids (`${outer}-chat` / `${outer}-agent`).
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' }, 'outer');
    await append('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 10 }, 'outer');
    await append('chat.message', { text: 'hi' }, 'outer-chat');     // sub-session → filtered out
    await append('agent.message', { text: 'thinking' }, 'outer-agent'); // sub-session → filtered out

    const outer = new RuntimeCollectorImpl({
      eventLog: log, checkpointStore: makeCheckpointStore(), sessionId: 'outer', projectionRuntime: createProjectionRuntime([['timeline', makeTimeline('outer')], ['trace', new IncrementalExecutionTraceBuilder()]]),
    });
    await outer.start();
    const snap = await outer.snapshot();

    // The trace sees ONLY the outer-session tool lifecycle (reconciled to its
    // terminal status) — sub-session events never reach the trace.
    expect(snap?.sessionId).toBe('outer');
    expect(snap?.trace).toHaveLength(1);
    expect(snap?.trace[0]!.kind).toBe('tool');
    expect(snap?.trace[0]!.status).toBe('completed');
    // Sub-session chat/agent events are NOT projected into the outer timeline.
    expect(snap?.timeline.map(e => e.kind)).toEqual([]);
    outer.stop();
  });

  it('snapshot.timeline + trace coexist (one read, two projections)', async () => {
    const { log, append } = makeEventLog();
    await append('chat.message', { text: 'hi' }, 'chat-1');
    await append('tool.started', { toolCallId: 't1', toolName: 'x' }, 'chat-1');
    await append('tool.completed', { toolCallId: 't1', toolName: 'x', status: 'success', durationMs: 5 }, 'chat-1');
    const c = new RuntimeCollectorImpl({
      eventLog: log, checkpointStore: makeCheckpointStore(), sessionId: 'chat-1', projectionRuntime: createProjectionRuntime([['timeline', makeTimeline('chat-1')], ['trace', new IncrementalExecutionTraceBuilder()]]),
    });
    await c.start();
    const snap = await c.snapshot();
    expect(snap?.timeline).toHaveLength(1);
    expect(snap?.timeline[0]!.kind).toBe('chat.message');
    expect(snap?.trace).toHaveLength(1);
    expect(snap?.trace[0]!.kind).toBe('tool');          // lifecycle kind
    expect(snap?.trace[0]!.status).toBe('completed');   // terminal status
    c.stop();
  });

  // MANDATORY — the highest-risk recovery path. A stale checkpoint must NOT
  // leave the timeline empty or the trace stale; both builders reset so replay
  // from `beginningCursor()` reconstructs both projections independently.
  it('beyond-head fallback resets BOTH builders and rebuilds both projections (D12)', async () => {
    const { log, append } = makeEventLog();
    await append('chat.message', { text: 'hi' }, 'chat-1');
    await append('tool.started', { toolCallId: 't1', toolName: 'x' }, 'chat-1');
    await append('tool.completed', { toolCallId: 't1', toolName: 'x', status: 'success', durationMs: 5 }, 'chat-1');

    // Corrupt the checkpoint: persist a cursor at seq=999 (beyond the head).
    const corruptStore = makeCheckpointStore();
    await corruptStore.save({
      version: 1,
      cursor: log.serializeCursor({ seq: 999, owner: Symbol('x') } as never),   // beyond-head
      committedAt: Date.now(),
    });

    const collector = new RuntimeCollectorImpl({
      eventLog: log, checkpointStore: corruptStore, sessionId: 'chat-1', projectionRuntime: createProjectionRuntime([['timeline', makeTimeline('chat-1')], ['trace', new IncrementalExecutionTraceBuilder()]]),
    });
    await collector.start();
    const snap = await collector.snapshot();

    // The timeline is REBUILT from beginningCursor (chat.message present),
    // and the trace is REBUILT too (completed tool present) — NOT stale/empty.
    expect(snap?.timeline.map(e => e.kind)).toEqual(['chat.message']);
    expect(snap?.trace).toHaveLength(1);
    expect(snap?.trace[0]!.kind).toBe('tool');          // lifecycle kind
    expect(snap?.trace[0]!.status).toBe('completed');   // terminal status
    // Replay must not rebuild ANOTHER session's projection.
    expect(snap?.sessionId).toBe('chat-1');
    collector.stop();
  });

  it('trace-only collector (no timeline registered) projects the trace, timeline is []', async () => {
    const { log, append } = makeEventLog();
    await append('chat.message', { text: 'hi' });
    await append('tool.started', { toolCallId: 't1', toolName: 'x' });
    // The outer (runtime) collector projects the trace only — no view consumes
    // its timeline, so the composition root registers trace only (no timeline
    // projection).
    const collector = new RuntimeCollectorImpl({
      eventLog: log, checkpointStore: makeCheckpointStore(), sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['trace', new IncrementalExecutionTraceBuilder()]]),
    });
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);
    const snap = await collector.snapshot();
    expect(snap!.timeline).toEqual([]);   // timeline never built
    expect(snap!.trace).toHaveLength(1);  // trace still projected
    collector.stop();
  });

  it('optional projections degrade to [] (not undefined) in both directions (trace-only and timeline-only collectors)', async () => {
    const { log, append } = makeEventLog();
    await append('chat.message', { text: 'hi' });
    // trace-only collector (outer runtime): timeline is [], not undefined
    const traceOnly = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: makeCheckpointStore(), sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['trace', new IncrementalExecutionTraceBuilder()]]) });
    const sampleTrace = (traceOnly as unknown as { sample(): Promise<void> }).sample;
    await sampleTrace.call(traceOnly);
    const traceSnap = await traceOnly.snapshot();
    expect(traceSnap!.timeline).toEqual([]);
    traceOnly.stop();

    // timeline-only collector: trace is [], not undefined — the platform must
    // prove BOTH optional projections behave identically (pre-7, a collector
    // with buildTimeline=true but no traceBuilder tolerated snapshot.trace).
    const timelineOnly = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: makeCheckpointStore(), sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder(SESSION_ID)]]) });
    const sampleTimeline = (timelineOnly as unknown as { sample(): Promise<void> }).sample;
    await sampleTimeline.call(timelineOnly);
    const timelineSnap = await timelineOnly.snapshot();
    expect(timelineSnap!.trace).toEqual([]);
    timelineOnly.stop();
  });

  it('lastEventAt / totalEventCount are session-scoped, not log-global (D1/D3)', async () => {
    const { log, append } = makeEventLog();
    await append('chat.message', { text: 'hi' }, 'chat-1');         // seq 1
    await append('agent.message', { text: 'thinking' }, 'agent-1'); // seq 2 — unrelated session, later in the log
    const chat = new RuntimeCollectorImpl({
      eventLog: log, checkpointStore: makeCheckpointStore(), sessionId: 'chat-1', projectionRuntime: createProjectionRuntime([['timeline', makeTimeline('chat-1')], ['trace', new IncrementalExecutionTraceBuilder()]]),
    });
    const sample = (chat as unknown as { sample(): Promise<void> }).sample;
    await sample.call(chat);
    const snap = await chat.snapshot();
    expect(snap!.sessionId).toBe('chat-1');
    // "Last activity" reflects THIS session's events only — not the agent
    // event that shares the log at a later seq.
    expect(snap!.totalEventCount).toBe(1);
    expect(snap!.lastEventAt).toBe(Date.parse('1970-01-01T00:00:01.000Z'));
    expect(snap!.timeline).toHaveLength(1);
    expect(snap!.timeline[0]!.kind).toBe('chat.message');
    chat.stop();
  });

  it('D12 beyond-head recovery mid-lifetime resets the event-count watermark (no stale carryover)', async () => {
    // Bespoke log that lets the test move the head backwards (truncation).
    let head = 0;
    const events: AlixEvent[] = [];
    const owner = Symbol('t');
    const makeCursor = (s: number) => ({ seq: s, owner }) as unknown as EventLogCursor;
    const log = {
      beginningCursor: () => makeCursor(0),
      readSince: async (c: EventLogCursor) => {
        const internal = c as unknown as { seq: number; owner: symbol };
        if (internal.seq > head) throw new EventLogCursorError('Cursor position beyond current EventLog head');
        const newer = events.filter((e) => e.seq > internal.seq && e.seq <= head);
        const last = newer.length ? newer[newer.length - 1]!.seq : internal.seq;
        return { events: newer, cursor: makeCursor(last) };
      },
      serializeCursor: (c: EventLogCursor) => JSON.stringify({ version: 1, seq: (c as unknown as { seq: number }).seq }),
      deserializeCursor: (s: string) => makeCursor(JSON.parse(s).seq),
    } as unknown as EventLog;
    let seq = 0;
    const evt = (type: string) => { seq++; events.push({ id: `e${seq}`, seq, version: 1, sessionId: SESSION_ID, timestamp: new Date(seq * 1000).toISOString(), type, actor: 'system', payload: {} }); };
    evt('workflow.created'); evt('tool.started'); evt('tool.completed');
    head = 3;

    const collector = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: makeCheckpointStore(), sessionId: SESSION_ID, projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder(SESSION_ID)], ['trace', new IncrementalExecutionTraceBuilder()]]) });
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);
    expect((await collector.snapshot())!.totalEventCount).toBe(3); // watermark at 3

    // Truncate the log: the head moves back to 1, so the persisted checkpoint
    // (seq 3) is now beyond-head. The D12 catch resets builders + accounting;
    // the cache is preserved for THIS sample.
    head = 1;
    await sample.call(collector);  // readSince throws EventLogCursorError → D12 reset
    expect((await collector.snapshot())!.totalEventCount).toBe(3); // cache preserved

    // Next sample re-reads from beginningCursor — only seq 1 remains. If the
    // event-count watermark (and workflow window) were NOT reset, the stale
    // pre-truncation count (3) would leak through.
    await sample.call(collector);
    expect((await collector.snapshot())!.totalEventCount).toBe(1);
    collector.stop();
  });
});

describe('RuntimeCollectorImpl capability projection (Increment A)', () => {
  it('snapshot.capabilities is populated from a registered CapabilityProjection', async () => {
    const { log, append } = makeEventLog();
    await append('capability.InvocationStarted', { invocationId: 'inv-1', capabilityId: 'research', at: 1000 });
    await append('capability.InvocationCompleted', { invocationId: 'inv-1', at: 4000 });
    const collector = new RuntimeCollectorImpl({
      eventLog: log, checkpointStore: makeCheckpointStore(), sessionId: SESSION_ID,
      projectionRuntime: createProjectionRuntime([[ProjectionIds.capability, new CapabilityProjection()]]),
    });
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);
    const snap = await collector.snapshot();
    expect(snap?.capabilities).not.toBeNull();
    expect(snap!.capabilities!.capabilities['research']!.invocationCount).toBe(1);
    expect(snap!.capabilities!.capabilities['research']!.invocationSucceeded).toBe(1);
    expect(snap!.capabilities!.activeInvocations).toBe(0);
    collector.stop();
  });

  it('snapshot.capabilities is null when the projection is not registered', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    const collector = new RuntimeCollectorImpl({
      eventLog: log, checkpointStore: makeCheckpointStore(), sessionId: SESSION_ID,
      projectionRuntime: createProjectionRuntime([['trace', new IncrementalExecutionTraceBuilder()]]),
    });
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);
    const snap = await collector.snapshot();
    expect(snap?.capabilities).toBeNull();
    collector.stop();
  });
});

describe('RuntimeCollectorImpl metrics projection (Increment B)', () => {
  it('snapshot.metrics is populated from a registered MetricsProjection', async () => {
    const { log, append } = makeEventLog();
    // Tool events carry their timestamp at the event level; capability events
    // carry `at` (ms) in the payload — mirrors the projection test helper.
    await append('tool.requested', { toolCallId: 't1', toolName: 'read' });
    await append('tool.completed', { toolCallId: 't1', toolName: 'read', status: 'success', durationMs: 500 });
    await append('capability.InvocationStarted', { invocationId: 'inv-1', capabilityId: 'research', at: 3000 });
    const collector = new RuntimeCollectorImpl({
      eventLog: log, checkpointStore: makeCheckpointStore(), sessionId: SESSION_ID,
      projectionRuntime: createProjectionRuntime([[ProjectionIds.metrics, new MetricsProjection()]]),
    });
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);
    const snap = await collector.snapshot();
    expect(snap?.metrics).not.toBeNull();
    expect(snap!.metrics!.toolCalls).toBe(1);
    expect(snap!.metrics!.toolFailures).toBe(0);
    expect(snap!.metrics!.toolDuration).toEqual({ count: 1, totalMs: 500, minMs: 500, maxMs: 500, averageMs: 500 });
    expect(snap!.metrics!.capabilityInvocations).toBe(1);
    expect(snap!.metrics!.eventsProcessed).toBe(3);
    expect(snap!.metrics!.startedAt).toBe(1000);
    expect(snap!.metrics!.lastEventAt).toBe(3000);
    collector.stop();
  });

  it('snapshot.metrics is null when the projection is not registered', async () => {
    const { log, append } = makeEventLog();
    await append('tool.started', { toolCallId: 'tc1', toolName: 'search' });
    const collector = new RuntimeCollectorImpl({
      eventLog: log, checkpointStore: makeCheckpointStore(), sessionId: SESSION_ID,
      projectionRuntime: createProjectionRuntime([['trace', new IncrementalExecutionTraceBuilder()]]),
    });
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);
    const snap = await collector.snapshot();
    expect(snap?.metrics).toBeNull();
    collector.stop();
  });
});
