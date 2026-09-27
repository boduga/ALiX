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
    hasContent: true,
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

  it('separates mechanical outcome, selection outcome, and evidence contribution', () => {
    const observation = observe();
    expect(observation.execution.status).toBe('success');
    expect(observation.selection).toEqual({ outcome: 'novel', repeatCount: 1 });
    expect(observation.evidence.contribution).toBe('contributed');
  });

  it('labels a repeated identical call redundant without claiming contribution', () => {
    const seen = new Map<string, number>();
    observe({ seenSignatures: seen });
    const second = observe({ seenSignatures: seen });
    expect(second.selection).toEqual({ outcome: 'redundant', repeatCount: 2 });
    expect(second.execution.status).toBe('success');
    // Repeat is a selection property, not an evidence claim.
    expect(second.evidence.contribution).toBe('contributed');
  });

  it('reports a repaired call as a repaired execution, not a success', () => {
    expect(observe({ repaired: true }).execution.status).toBe('repaired');
  });

  it('reports failures and provable no-ops as no evidence contribution', () => {
    const seen = new Map<string, number>([['file.read:{"path":"a.ts"}', 1]]);
    const observation = observe({ seenSignatures: seen, executorSuccess: false });
    expect(observation.execution.status).toBe('failed');
    expect(observation.evidence.contribution).toBe('none');

    expect(observe({ noOp: true }).evidence.contribution).toBe('none');
  });

  it('says unknown when a successful call carried no content to judge', () => {
    expect(observe({ hasContent: false }).evidence.contribution).toBe('unknown');
  });
});
