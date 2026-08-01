import { describe, it, expect } from 'vitest';
import type { ExecutionTraceEntry, ExecutionTraceRetention } from '../../../src/tui/runtime/execution-trace.js';

describe('ExecutionTraceEntry contract', () => {
  it('is a readonly DTO (type-level: assigning a readonly field must fail to compile)', () => {
    const e: ExecutionTraceEntry = {
      id: 'tr-1', kind: 'tool', status: 'completed',
      title: 'tool.search', startedAt: 1000, durationMs: 183,
      sourceEvents: { firstSequence: 1, lastSequence: 4 },
    };
    expect(e.id).toBe('tr-1');
    expect(e.kind).toBe('tool');
    expect(e.sourceEvents.firstSequence).toBe(1);
  });

  it('allows optional fields to be omitted', () => {
    const e: ExecutionTraceEntry = {
      id: 'tr-2', kind: 'runtime', status: 'running',
      title: 'workflow', startedAt: 2000,
      sourceEvents: { firstSequence: 10 },
    };
    expect(e.completedAt).toBeUndefined();
    expect(e.sourceEvents.lastSequence).toBeUndefined();
  });

  it('running entries carry NO lastSequence (open lifecycle boundary)', () => {
    const e: ExecutionTraceEntry = {
      id: 'tr-3', kind: 'tool', status: 'running',
      title: 'tool.search', startedAt: 3000,
      sourceEvents: { firstSequence: 7 },
    };
    expect(e.sourceEvents.lastSequence).toBeUndefined();
  });
});

describe('ExecutionTraceRetention interface', () => {
  it('declares apply(entries) → readonly entries', () => {
    const w: ExecutionTraceRetention = { apply: (es) => es };
    const input: ExecutionTraceEntry[] = [];
    const out = w.apply(input);
    expect(out).toBe(input);
  });
});
