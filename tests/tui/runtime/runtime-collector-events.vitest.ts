import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EventLog } from '../../../src/events/event-log.js';
import { RuntimeCollectorImpl } from '../../../src/tui/runtime-collector.js';
import { FileProjectionCheckpointStore } from '../../../src/tui/runtime/projection-checkpoint-store.js';
import { createProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';
import { IncrementalExecutionTraceBuilder } from '../../../src/tui/runtime/execution-trace-builder.js';
import { ProjectionIds } from '../../../src/tui/runtime/projection-ids.js';

describe('RuntimeCollector event-triggered sampling', () => {
  it('publishes an appended event before the one-second fallback tick', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'alix-collector-event-'));
    const log = new EventLog(dir);
    await log.init();
    const collector = new RuntimeCollectorImpl({
      eventLog: log,
      checkpointStore: new FileProjectionCheckpointStore(join(dir, 'projection')),
      sessionId: 's',
      projectionRuntime: createProjectionRuntime([[ProjectionIds.trace, new IncrementalExecutionTraceBuilder()]]),
    });
    await collector.start();
    try {
      await log.append({ sessionId: 's', actor: 'system', type: 'tool.started', payload: { toolCallId: 't1', toolName: 'read' } });
      await vi.waitFor(async () => expect((await collector.snapshot())?.trace).toHaveLength(1), { timeout: 300 });
    } finally {
      collector.stop();
    }
  });
});
