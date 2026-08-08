import { describe, it, expect } from 'vitest';
import { classifyContextEventSignal } from '../../../src/tui/views/scroll-math.js';

describe('classifyContextEventSignal', () => {
  it('classifies assembled / preflight.failed / irreducible as HIGH', () => {
    expect(classifyContextEventSignal('context.assembled')).toBe('HIGH');
    expect(classifyContextEventSignal('context.preflight.failed')).toBe('HIGH');
    expect(classifyContextEventSignal('context.irreducible')).toBe('HIGH');
  });

  it('classifies snapshot.created / budget.computed as LOW', () => {
    expect(classifyContextEventSignal('context.snapshot.created')).toBe('LOW');
    expect(classifyContextEventSignal('context.budget.computed')).toBe('LOW');
  });

  it('returns null for non-context events', () => {
    expect(classifyContextEventSignal('agent.message')).toBeNull();
    expect(classifyContextEventSignal('tool.started')).toBeNull();
    expect(classifyContextEventSignal('model.usage')).toBeNull();
    expect(classifyContextEventSignal('')).toBeNull();
    expect(classifyContextEventSignal('context.unknown')).toBeNull();
  });
});
