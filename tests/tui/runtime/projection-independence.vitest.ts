import { describe, it, expect } from 'vitest';
import { TimelineBuilder } from '../../../src/tui/runtime/timeline-builder.js';
import { IncrementalExecutionTraceBuilder } from '../../../src/tui/runtime/execution-trace-builder.js';
import type { AlixEvent } from '../../../src/events/types.js';

function evt(seq: number, type: string, sessionId = 's1', payload: object = {}): AlixEvent {
  return { id: `e${seq}`, seq, version: 1, sessionId, timestamp: new Date(seq * 1000).toISOString(), type, actor: 'user', payload };
}

describe('projection independence (D11)', () => {
  it('the timeline projection is unchanged when the trace builder mutates', () => {
    const timeline = new TimelineBuilder('s1');
    timeline.update([evt(1, 'chat.message', 's1', { text: 'hi' })]);

    // The trace builder is a SEPARATE instance — mutating it must not affect
    // the timeline projection (builders never consume each other's DTOs).
    const trace = new IncrementalExecutionTraceBuilder();
    trace.update([evt(1, 'tool.started', 's1', { toolCallId: 't1', toolName: 'x' })]);
    trace.update([evt(2, 'tool.completed', 's1', { toolCallId: 't1', toolName: 'x', status: 'success', durationMs: 5 })]);

    expect(timeline.snapshot()).toHaveLength(1);
    expect(timeline.snapshot()[0]!.kind).toBe('chat.message');
  });
});
