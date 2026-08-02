import { describe, it, expect } from 'vitest';
import { IncrementalExecutionTraceBuilder } from '../../../src/tui/runtime/execution-trace-builder.js';
import type { AlixEvent } from '../../../src/events/types.js';

function evt(seq: number, type: string, payload: Record<string, unknown> = {}): AlixEvent {
  return {
    id: `e${seq}`, seq, version: 1, sessionId: 'outer', timestamp: new Date(seq * 1000).toISOString(), type, actor: 'system', payload,
  } as unknown as AlixEvent;
}

describe('IncrementalExecutionTraceBuilder durable state (Phase 6.5)', () => {
  it('exportState round-trips through importState to an identical snapshot', () => {
    const b = new IncrementalExecutionTraceBuilder();
    b.update([
      evt(1, 'tool.started', { toolCallId: 't1', toolName: 'x' }),
      evt(2, 'tool.completed', { toolCallId: 't1', toolName: 'x', status: 'success', durationMs: 5 }),
      evt(3, 'tool.started', { toolCallId: 't2', toolName: 'y' }),
    ]);
    const before = b.snapshot();

    const fresh = new IncrementalExecutionTraceBuilder();
    fresh.importState(b.exportState());

    expect(fresh.snapshot()).toEqual(before);
  });

  it('importState throws on malformed or unsupported-version state', () => {
    const b = new IncrementalExecutionTraceBuilder();
    expect(() => b.importState({ version: 99 })).toThrow();
    expect(() => b.importState({ version: 1, seenSequences: 'nope' })).toThrow();
  });

  it('importState reconstructs open lifecycles (running entries) exactly', () => {
    const b = new IncrementalExecutionTraceBuilder();
    b.update([evt(1, 'tool.started', { toolCallId: 't1', toolName: 'x' })]);
    const running = b.snapshot();
    expect(running).toHaveLength(1);
    expect(running[0]!.status).toBe('running');

    const fresh = new IncrementalExecutionTraceBuilder();
    fresh.importState(b.exportState());
    const restored = fresh.snapshot();
    expect(restored).toHaveLength(1);
    expect(restored[0]!.status).toBe('running');
    expect(restored[0]!.title).toBe('tool.x');
  });
});
