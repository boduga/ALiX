import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildExecutionTrace, createExecutionTraceRetention, computeExecutionTrace,
} from '../../../src/tui/runtime/execution-trace-builder.js';
import type { AlixEvent } from '../../../src/events/types.js';

let seq = 0;
beforeEach(() => { seq = 0; });
function evt(type: string, payload: Record<string, unknown> = {}): AlixEvent {
  return {
    id: `e${++seq}`, seq, version: 1, sessionId: 's', timestamp: new Date(seq * 1000).toISOString(),
    type, actor: 'system', payload,
  };
}

describe('buildExecutionTrace', () => {
  it('collapses a tool lifecycle into ONE completed entry with duration + sourceEvents range', () => {
    const events = [
      evt('tool.started', { toolCallId: 'tc1', toolName: 'search' }),
      evt('tool.output', { toolCallId: 'tc1', outputPreview: 'state.ts', outputSize: 9 }),
      evt('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 183 }),
    ];
    const entries = buildExecutionTrace(events);
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.kind).toBe('tool');
    expect(e.status).toBe('completed');
    expect(e.title).toBe('tool.search');
    expect(e.durationMs).toBe(183);
    expect(e.sourceEvents.firstSequence).toBe(1);
    expect(e.sourceEvents.lastSequence).toBe(3);
  });

  it('marks a tool with no terminal event as running (open lifecycle) with NO lastSequence', () => {
    const entries = buildExecutionTrace([evt('tool.started', { toolCallId: 'tc1', toolName: 'search' })]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe('running');
    expect(entries[0]!.sourceEvents.lastSequence).toBeUndefined();
    expect(entries[0]!.sourceEvents.firstSequence).toBe(1);
  });

  it('each policy.decision is a standalone verdict entry (no cross-decision collapse)', () => {
    const entries = buildExecutionTrace([
      evt('policy.decision', { allowed: true, rule: 'r1' }),
      evt('policy.decision', { allowed: false, rule: 'r2' }),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.kind).toBe('policy');
    expect(entries[0]!.status).toBe('completed');
  });

  it('distinguishes capability invocations that lack stable IDs (seq fallback key)', () => {
    const entries = buildExecutionTrace([
      evt('capability.InvocationStarted', { capabilityId: 'core.session.list' }),
      evt('capability.InvocationStarted', { capabilityId: 'core.session.list' }),
    ]);
    // Two distinct starts with no invocationId must NOT collapse into one.
    expect(entries).toHaveLength(2);
  });

  it('ignores unknown EventLog events without throwing (forward compatibility)', () => {
    const entries = buildExecutionTrace([
      evt('future.new_event', { foo: 'bar' }),
      evt('another.unknown', { x: 1 }),
    ]);
    expect(entries).toEqual([]);
  });

  it('tracks capability lifecycle open→terminal', () => {
    const events = [
      evt('capability.InvocationStarted', { invocationId: 'inv1', capabilityId: 'core.session.list' }),
      evt('capability.InvocationCompleted', { invocationId: 'inv1', at: 2 }),
    ];
    const entries = buildExecutionTrace(events);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe('capability');
    expect(entries[0]!.status).toBe('completed');
    expect(entries[0]!.title).toBe('core.session.list');
  });

  it('turns runtime.phase.started/completed into one runtime entry', () => {
    const events = [
      evt('runtime.phase.started', { phase: 'planning' }),
      evt('runtime.phase.completed', { phase: 'planning' }),
    ];
    const entries = buildExecutionTrace(events);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe('runtime');
    expect(entries[0]!.status).toBe('completed');
  });

  it('correlates runtime phases via timingId (real TimingEventPayload shape)', () => {
    const entries = buildExecutionTrace([
      evt('runtime.phase.started', { timingId: 't1', operation: 'route.tool.search' }),
      evt('runtime.phase.completed', { timingId: 't1', operation: 'route.tool.search', durationMs: 42, outcome: 'success' }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe('runtime');
    expect(entries[0]!.status).toBe('completed');
    expect(entries[0]!.title).toBe('route.tool.search');
    expect(entries[0]!.durationMs).toBe(42);
  });

  it('keeps an orphaned runtime.phase.completed from hardcoding durationMs to 0', () => {
    const entries = buildExecutionTrace([
      evt('runtime.phase.completed', { timingId: 'orphan', operation: 'route.tool.search', durationMs: 37, outcome: 'success' }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe('completed');
    expect(entries[0]!.durationMs).toBe(37);
  });

  it('keys agent.session.phase_changed on the phase value (each transition its own unit)', () => {
    const entries = buildExecutionTrace([
      evt('agent.session.phase_changed', { phase: 'planning' }),
      evt('agent.session.phase_changed', { phase: 'executing' }),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.kind)).toEqual(['runtime', 'runtime']);
    expect(entries.map(e => e.status)).toEqual(['running', 'running']);
    expect(entries.map(e => e.title)).toEqual(['planning', 'executing']);
  });

  it('does not collapse distinct runtime phase operations onto one key', () => {
    const entries = buildExecutionTrace([
      evt('runtime.phase.started', { timingId: 't1', operation: 'route.tool.search' }),
      evt('runtime.phase.started', { timingId: 't2', operation: 'route.tool.execute' }),
    ]);
    // Two distinct phases with no terminal events → two running entries.
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.title)).toEqual(['route.tool.search', 'route.tool.execute']);
  });

  it('outputs detached DTOs — mutating an entry does not touch the source events', () => {
    const events = [evt('tool.started', { toolCallId: 'tc1', toolName: 'search' })];
    const entries = buildExecutionTrace(events);
    (entries[0] as { title: string }).title = 'mutated';
    expect((events[0]!.payload as { toolName: string }).toolName).toBe('search');
  });
});

describe('createExecutionTraceRetention', () => {
  function entry(id: string, status: 'running' | 'completed', startedAt: number): { id: string; status: string; kind: string; title: string; startedAt: number; sourceEvents: { firstSequence: number } } {
    return { id, kind: 'tool', title: 't', startedAt, status, sourceEvents: { firstSequence: startedAt } } as never;
  }

  it('never evicts running entries and bounds terminal to maxTerminal', () => {
    const w = createExecutionTraceRetention(2);
    const out = w.apply([
      entry('c1', 'completed', 1), entry('c2', 'completed', 2), entry('c3', 'completed', 3),
      entry('r1', 'running', 4),
    ] as never);
    expect(out.map(e => (e as { id: string }).id)).toEqual(['c2', 'c3', 'r1']);
  });

  it('sorts terminal oldest→newest by startedAt then appends running after', () => {
    const w = createExecutionTraceRetention(50);
    const out = w.apply([
      entry('r1', 'running', 5), entry('c2', 'completed', 2), entry('c1', 'completed', 1),
    ] as never);
    expect(out.map(e => (e as { id: string }).id)).toEqual(['c1', 'c2', 'r1']);
  });
});

describe('computeExecutionTrace', () => {
  it('runs build then retention', () => {
    const w = createExecutionTraceRetention(50);
    const events = [
      evt('tool.started', { toolCallId: 'tc1', toolName: 'search' }),
      evt('tool.completed', { toolCallId: 'tc1', toolName: 'search', status: 'success', durationMs: 10 }),
    ];
    const out = computeExecutionTrace(events, w);
    expect(out).toHaveLength(1);
    expect(out[0]!.status).toBe('completed');
  });
});
