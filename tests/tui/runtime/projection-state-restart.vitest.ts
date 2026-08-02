import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../../../src/events/event-log.js';
import { FileProjectionCheckpointStore } from '../../../src/tui/runtime/projection-checkpoint-store.js';
import { RuntimeCollectorImpl } from '../../../src/tui/runtime-collector.js';
import { TimelineBuilder } from '../../../src/tui/runtime/timeline-builder.js';
import { IncrementalExecutionTraceBuilder } from '../../../src/tui/runtime/execution-trace-builder.js';
import { createProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';

async function makeEnv(sessionId: string) {
  const dir = mkdtempSync(join(tmpdir(), 'alix-restart-'));
  const log = new EventLog(join(dir, 'events'));
  await log.init();
  const store = new FileProjectionCheckpointStore(join(dir, 'projections', sessionId));
  return { dir, log, store };
}

describe('projection state survives a restart (Phase 6.5)', () => {
  it('a new collector on the same store restores timeline + trace without replaying the log', async () => {
    const { log, store } = await makeEnv('chat-1');

    // "First process": start, append, sample.
    const first = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: 'chat-1', projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder('chat-1')], ['trace', new IncrementalExecutionTraceBuilder()]]) });
    await first.start();
    await log.append({ sessionId: 'chat-1', actor: 'user', type: 'chat.message', payload: { text: 'hello' } });
    const sample = (first as unknown as { sample(): Promise<void> }).sample;
    await sample.call(first);
    first.stop();

    // "Second process": a fresh collector, same EventLog + store.
    const second = new RuntimeCollectorImpl({ eventLog: log, checkpointStore: store, sessionId: 'chat-1', projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder('chat-1')], ['trace', new IncrementalExecutionTraceBuilder()]]) });
    await second.start();
    const snap = await second.snapshot();
    expect(snap?.timeline.map((e) => e.text)).toEqual(['hello']);
    second.stop();
  });
});
