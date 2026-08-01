import { describe, it, expect, vi } from 'vitest';
import { RuntimeCollectorImpl } from '../../../src/tui/runtime-collector.js';
import type { EventLog, EventLogCursor } from '../../../src/events/event-log.js';
import type { AlixEvent } from '../../../src/events/types.js';

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

  // Note: `builder` is `private readonly` (TS private, not #private) so it IS
  // reachable via the cast at runtime — the spy works. `sample.call(collector)`
  // does NOT throw outward because sample() has its own try/catch; the assertion
  // that afterFail.trace is empty is what proves the first sample didn't populate.
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
