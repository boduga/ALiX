import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AlixEvent } from '../../../src/runtime-state/events/types.js';
import { buildExecutionTrace, IncrementalExecutionTraceBuilder } from '../../../src/interfaces/tui/runtime/execution-trace-builder.js';
import { ConversationProjection } from '../../../src/interfaces/tui/workbench/projections/conversation-projection.js';

function event(seq: number, type: string, payload: Record<string, unknown>): AlixEvent {
  return { id: `event-${seq}`, seq, version: 1, sessionId: 'session', actor: 'system',
    timestamp: new Date(seq * 1000).toISOString(), type, payload };
}
const request = (seq = 1, toolCallId = 'read') => event(seq, 'tool.requested', {
  toolCallId, toolName: 'file.read', agentId: 'frontend',
  argsPreview: { path: 'src/sidebar.ts', startLine: 1, endLine: 200, secret: 'never-copy' },
});
const completed = event(3, 'tool.completed', { toolCallId: 'read', observedLineCount: 142 });

// Runtime DTOs are immutable by contract; adversarial mutations below exercise detachment.
function mutateRange(value: unknown): void {
  const range = value as { startLine: number };
  range.startLine = 99;
}

describe('typed tool-card event metadata', () => {
  it.each([[7, '7'], [{}, '[object Object]'], [['read'], 'read'], [true, 'true'], [7, 'tool.output:2']] as const)
    ('does not coerce malformed call identity %j into valid string %s, including after checkpoint restore', (malformed, valid) => {
      const builder = new IncrementalExecutionTraceBuilder();
      builder.update([request(1, valid)]);
      const original = builder.snapshot()[0];
      builder.update([event(2, 'tool.output', { toolCallId: malformed, agentId: 'frontend', outputPreview: 'wrong identity' }),
        event(3, 'tool.completed', { toolCallId: malformed, agentId: 'frontend', observedLineCount: 999 })]);
      expect(builder.snapshot().find(row => row.toolMetadata?.toolCallId === valid)).toEqual(original);
      const restored = new IncrementalExecutionTraceBuilder();
      restored.importState(builder.exportState());
      restored.update([event(4, 'tool.failed', { toolCallId: malformed, agentId: 'frontend', error: 'wrong identity' })]);
      expect(restored.snapshot().find(row => row.toolMetadata?.toolCallId === valid)).toEqual(original);
      restored.update([event(5, 'tool.completed', { toolCallId: valid, agentId: 'frontend', observedLineCount: 142 })]);
      expect(restored.snapshot().find(row => row.toolMetadata?.toolCallId === valid)).toMatchObject({ status: 'completed', toolMetadata: { observedLineCount: 142 } });
    });

  it('preserves independent legacy events without call identities', () => {
    const trace = buildExecutionTrace([event(1, 'tool.started', { toolName: 'file.read' }),
      event(2, 'tool.started', { toolName: 'file.read' }), event(3, 'tool.completed', { toolName: 'file.read' })]);
    expect(trace).toHaveLength(3);
    expect(trace.filter(row => row.status === 'running')).toHaveLength(2);
    expect(trace.every(row => row.toolMetadata === undefined)).toBe(true);
  });
  it('keeps cancellation terminal without terminating another invocation', () => {
    const builder = new IncrementalExecutionTraceBuilder();
    builder.update([request(), request(2, 'other'), event(3, 'tool.output', { toolCallId: 'read', outputPreview: 'partial' }),
      event(4, 'tool.completed', { toolCallId: 'read', agentId: 'frontend', status: 'cancelled', durationMs: 3000 })]);
    expect(builder.snapshot().find(row => row.toolMetadata?.toolCallId === 'read')).toMatchObject({
      status: 'cancelled', detail: 'partial', durationMs: 3000, sourceEvents: { firstSequence: 1, lastSequence: 4 },
    });
    expect(builder.snapshot().find(row => row.toolMetadata?.toolCallId === 'other')?.status).toBe('running');
    const restored = new IncrementalExecutionTraceBuilder();
    restored.importState(builder.exportState());
    restored.update([event(5, 'tool.output', { toolCallId: 'read', outputPreview: 'late' }),
      event(6, 'tool.started', { toolCallId: 'read', agentId: 'frontend' })]);
    expect(restored.snapshot()).toEqual(builder.snapshot());
  });

  it('rejects a different authoritative actor before changing progress, request metadata or terminal state', () => {
    const builder = new IncrementalExecutionTraceBuilder();
    builder.update([request()]);
    const before = builder.snapshot();
    builder.update([
      event(2, 'tool.output', { toolCallId: 'read', agentId: 'backend', outputPreview: 'wrong actor output' }),
      event(3, 'tool.requested', { toolCallId: 'read', agentId: 'backend', argsPreview: { path: 'wrong.ts', startLine: 20, endLine: 30 } }),
      event(4, 'tool.completed', { toolCallId: 'read', agentId: 'backend', observedLineCount: 999 }),
    ]);
    expect(builder.snapshot()).toEqual(before);
    const resumed = new IncrementalExecutionTraceBuilder();
    resumed.importState(builder.exportState());
    resumed.update([event(5, 'tool.output', { toolCallId: 'read', agentId: 'frontend', outputPreview: 'correct' }),
      event(6, 'tool.completed', { toolCallId: 'read', agentId: 'frontend', observedLineCount: 142 })]);
    expect(resumed.snapshot()).toMatchObject([{ status: 'completed', agentId: 'frontend', detail: 'correct',
      toolMetadata: { path: 'src/sidebar.ts', observedLineCount: 142 }, sourceEvents: { firstSequence: 1, lastSequence: 6 } }]);
  });

  it('deduplicates orphan terminals and refuses late progress after checkpoint restore', () => {
    const builder = new IncrementalExecutionTraceBuilder();
    builder.update([event(1, 'tool.failed', { toolCallId: 'orphan', agentId: 'frontend', error: 'original' })]);
    const before = builder.snapshot();
    const resumed = new IncrementalExecutionTraceBuilder();
    resumed.importState(builder.exportState());
    const late = [event(2, 'tool.completed', { toolCallId: 'orphan', agentId: 'frontend', observedLineCount: 999 }),
      event(3, 'tool.requested', { toolCallId: 'orphan', agentId: 'frontend', argsPreview: { path: 'late.ts' } }),
      event(4, 'tool.started', { toolCallId: 'orphan', agentId: 'frontend' }),
      event(5, 'tool.output', { toolCallId: 'orphan', agentId: 'frontend', outputPreview: 'late' })];
    for (const target of [builder, resumed]) {
      target.update(late);
      expect(target.snapshot()).toEqual(before);
      target.update([request(6, 'new-call')]);
      expect(target.snapshot()).toHaveLength(2);
    }
  });

  it('preserves requested range separately from observed count and start time', () => {
    const trace = buildExecutionTrace([request(), event(2, 'tool.started', { toolCallId: 'read' }), completed]);
    expect(trace[0]).toMatchObject({ status: 'completed', startedAt: 1000,
      toolMetadata: { toolCallId: 'read', path: 'src/sidebar.ts', requestedRange: { startLine: 1, endLine: 200 }, observedLineCount: 142 } });
    expect(JSON.stringify(trace)).not.toContain('never-copy');
    const conversation = new ConversationProjection().project({ timeline: [], trace, mode: 'compact' });
    const group = conversation.items[0];
    expect(group?.kind).toBe('tool-group');
    if (group?.kind !== 'tool-group') throw new Error('expected tool group');
    expect(group.tools[0]).toMatchObject({ startedAt: 1000, metadata: trace[0]!.toolMetadata });
    mutateRange(group.tools[0]!.metadata!.requestedRange);
    expect(trace[0]!.toolMetadata!.requestedRange!.startLine).toBe(1);
  });

  it('keeps active and completed calls distinct; never counts output-preview lines', () => {
    const trace = buildExecutionTrace([request(), completed, request(4, 'active'),
      event(5, 'tool.output', { toolCallId: 'active', outputPreview: 'one\ntwo\nthree', observedLineCount: 3 }),
      event(6, 'tool.completed', { toolCallId: 'read', observedLineCount: 999 }),
      event(7, 'tool.completed', { toolCallId: 'orphan', observedLineCount: 0 })]);
    expect(trace.find(row => row.toolMetadata?.toolCallId === 'read')?.toolMetadata?.observedLineCount).toBe(142);
    expect(trace.find(row => row.toolMetadata?.toolCallId === 'active')).toMatchObject({ status: 'running' });
    expect(trace.find(row => row.toolMetadata?.toolCallId === 'active')?.toolMetadata?.observedLineCount).toBeUndefined();
    expect(trace.find(row => row.toolMetadata?.toolCallId === 'orphan')?.toolMetadata?.observedLineCount).toBe(0);
  });

  it.each([
    { path: 'bad\u001b[31m', startLine: 1, endLine: 2 },
    { path: 'x'.repeat(1025), startLine: 3, endLine: 2 },
    { path: null, startLine: '1', endLine: 2 },
    { path: null, startLine: 0, endLine: 2 },
    { path: null, startLine: 1, endLine: Infinity },
  ])('drops malformed or unbounded request fields: %j', argsPreview => {
    const trace = buildExecutionTrace([event(1, 'tool.requested', { toolCallId: 'read', argsPreview }),
      event(2, 'tool.completed', { toolCallId: 'read', observedLineCount: -1 })]);
    expect(trace[0]!.toolMetadata?.path).toBeUndefined();
    if (argsPreview.endLine !== 2 || argsPreview.startLine !== 1) expect(trace[0]!.toolMetadata?.requestedRange).toBeUndefined();
    expect(trace[0]!.toolMetadata?.observedLineCount).toBeUndefined();
  });

  it('round-trips checkpoints and replay without aliasing any metadata', () => {
    const original = new IncrementalExecutionTraceBuilder();
    original.update([request()]);
    const checkpoint = original.exportState();
    const resumed = new IncrementalExecutionTraceBuilder();
    resumed.importState(checkpoint);
    mutateRange(checkpoint.openByKey[0]!.lifecycle.toolMetadata!.requestedRange);
    expect(original.snapshot()[0]!.toolMetadata!.requestedRange!.startLine).toBe(1);
    resumed.update([request(), completed]);
    expect(resumed.snapshot()).toEqual(buildExecutionTrace([request(), completed]));
    const terminal = resumed.exportState();
    const restored = new IncrementalExecutionTraceBuilder();
    restored.importState(terminal);
    mutateRange(terminal.terminalById[0]!.entry.toolMetadata!.requestedRange);
    mutateRange(restored.snapshot()[0]!.toolMetadata!.requestedRange);
    expect(resumed.snapshot()[0]!.toolMetadata!.requestedRange!.startLine).toBe(1);
    expect(restored.snapshot()[0]!.toolMetadata!.requestedRange!.startLine).toBe(1);
  });

  it.each(['open', 'terminal'])('rejects malformed %s checkpoint metadata before changing state', kind => {
    const builder = new IncrementalExecutionTraceBuilder();
    builder.update([request(), ...(kind === 'terminal' ? [completed] : [])]);
    const before = builder.snapshot();
    const bad = JSON.parse(JSON.stringify(builder.exportState()));
    const holder = kind === 'open' ? bad.openByKey[0].lifecycle : bad.terminalById[0].entry;
    holder.toolMetadata.requestedRange.endLine = 'bad';
    expect(() => builder.importState(bad)).toThrow('malformed tool metadata');
    expect(builder.snapshot()).toEqual(before);
  });

  it('accepts old version-one checkpoints without metadata', () => {
    const builder = new IncrementalExecutionTraceBuilder();
    builder.update([request(), completed]);
    const legacy = JSON.parse(JSON.stringify(builder.exportState()));
    delete legacy.terminalById[0].entry.toolMetadata;
    const restored = new IncrementalExecutionTraceBuilder();
    restored.importState(legacy);
    expect(restored.snapshot()[0]!.toolMetadata).toBeUndefined();
    expect(restored.snapshot()[0]!.status).toBe('completed');
  });

  it('projects all three reference-image tool calls from the event fixture', () => {
    const fixture = JSON.parse(readFileSync(new URL('../../fixtures/tui/workbench-preview-events.json', import.meta.url), 'utf8'));
    const trace = buildExecutionTrace(fixture.events);
    const read = trace.find(row => row.toolMetadata?.toolCallId === 'read-sidebar');
    expect(read?.toolMetadata).toMatchObject({ path: 'src/components/sidebar.tsx', requestedRange: { startLine: 1, endLine: 200 }, observedLineCount: 142 });
    expect(trace.find(row => row.toolMetadata?.toolCallId === 'write-sidebar-completed')?.toolMetadata?.observedLineCount).toBe(287);
    expect(trace.find(row => row.toolMetadata?.toolCallId === 'write-sidebar-active')).toMatchObject({ status: 'running', toolMetadata: { toolCallId: 'write-sidebar-active' } });
  });
});
