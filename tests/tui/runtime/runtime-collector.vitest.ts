import { describe, it, expect, vi } from 'vitest';
import { RuntimeCollectorImpl } from '../../../src/tui/runtime-collector.js';
import type { EventLog } from '../../../src/events/event-log.js';

function makeEventLog(readAll: () => Promise<unknown[]>): EventLog {
  return { readAll } as unknown as EventLog;
}

describe('RuntimeCollectorImpl trace integration', () => {
  it('populates snapshot.trace from the EventLog via the builder', async () => {
    const events = [
      { id: 'e1', seq: 1, version: 1, sessionId: 's', timestamp: new Date(1000).toISOString(), type: 'tool.started', actor: 'system', payload: { toolCallId: 'tc1', toolName: 'search' } },
      { id: 'e2', seq: 2, version: 1, sessionId: 's', timestamp: new Date(2000).toISOString(), type: 'tool.completed', actor: 'system', payload: { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 100 } },
    ];
    const log = makeEventLog(async () => events);
    const collector = new RuntimeCollectorImpl(log);
    await (collector as unknown as { sample(): Promise<void> }).sample();
    const snap = await collector.snapshot();
    expect(snap?.trace).toHaveLength(1);
    expect(snap?.trace[0]!.kind).toBe('tool');
    expect(snap?.trace[0]!.status).toBe('completed');
  });

  it('keeps the previous snapshot on a LATER readAll failure (poll-failure invariant)', async () => {
    let shouldFail = false;
    const log = makeEventLog(async () => {
      if (shouldFail) throw new Error('io');
      return [{ id: 'e1', seq: 1, version: 1, sessionId: 's', timestamp: new Date(1000).toISOString(), type: 'tool.started', actor: 'system', payload: { toolCallId: 'tc1', toolName: 'search' } }];
    });
    const collector = new RuntimeCollectorImpl(log);
    const sample = (collector as unknown as { sample(): Promise<void> }).sample;
    await sample.call(collector);
    const before = await collector.snapshot();
    expect(before?.trace).toHaveLength(1);

    // Same collector, now failing — must preserve the previous snapshot.
    shouldFail = true;
    await sample.call(collector);
    const after = await collector.snapshot();
    expect(after).toEqual(before);
  });
});
