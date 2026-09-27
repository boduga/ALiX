/**
 * T0-b: shadow tool-selection observation. Instrumentation only — these tests
 * pin the labels a later selector comparison depends on.
 */
import { describe, it, expect } from 'vitest';
import { buildSelectionObservation } from '../../src/run/task-loop/predicates.js';

function observe(overrides: Partial<Parameters<typeof buildSelectionObservation>[0]> = {}) {
  return buildSelectionObservation({
    iteration: 0,
    invocationId: 'inv-1',
    offered: ['alix_file_read', 'alix_grep_search', 'alix_shell_run'],
    chosen: 'alix_file_read',
    executor: 'file.read',
    argsSignature: 'file.read:{"path":"a.ts"}',
    seenSignatures: new Map(),
    executorSuccess: true,
    ...overrides,
  });
}

describe('buildSelectionObservation', () => {
  it('records the offered surface, the choice, and the executor', () => {
    const observation = observe();
    expect(observation.offered).toEqual(['alix_file_read', 'alix_grep_search', 'alix_shell_run']);
    expect(observation.chosen).toBe('alix_file_read');
    expect(observation.executor).toBe('file.read');
    expect(observation.invocationId).toBe('inv-1');
  });

  it('labels a first successful call useful', () => {
    const observation = observe();
    expect(observation.repeatCount).toBe(1);
    expect(observation.newEvidence).toBe(true);
    expect(observation.usefulness).toBe('useful');
  });

  it('labels a repeated identical call redundant, not useful', () => {
    const seen = new Map<string, number>();
    observe({ seenSignatures: seen });
    const second = observe({ seenSignatures: seen });
    expect(second.repeatCount).toBe(2);
    expect(second.newEvidence).toBe(false);
    expect(second.usefulness).toBe('redundant');
  });

  it('labels a repaired call separately from a useful one', () => {
    expect(observe({ repaired: true }).usefulness).toBe('repaired');
  });

  it('labels a failed call failed even when it was also a repeat', () => {
    const seen = new Map<string, number>([['file.read:{"path":"a.ts"}', 1]]);
    const observation = observe({ seenSignatures: seen, executorSuccess: false });
    expect(observation.usefulness).toBe('failed');
    expect(observation.newEvidence).toBe(false);
  });
});
