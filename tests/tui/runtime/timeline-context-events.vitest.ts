import { describe, it, expect } from 'vitest';
import { TimelineBuilder } from '../../../src/tui/runtime/timeline-builder.js';
import type { AlixEvent } from '../../../src/events/types.js';

function evt(type: string, payload: Record<string, unknown>, seq: number, at = seq * 1000): AlixEvent {
  return { id: `e${seq}`, seq, version: 1, sessionId: 's1', timestamp: new Date(at).toISOString(), type, actor: 'system', payload };
}

describe('TimelineBuilder — context event admission', () => {
  it('admits all five context lifecycle events in narrative order', () => {
    const b = new TimelineBuilder('s1');
    b.update([
      evt('context.snapshot.created', { invocationId: 'inv1', candidateTokens: 143000 }, 1, 1000),
      evt('context.budget.computed', { invocationId: 'inv1', contextWindowTokens: 131072, availableInputTokens: 96000, budgetReservation: 35072, requestedMaxOutputTokens: 35072 }, 2, 2000),
      evt('context.assembled', { invocationId: 'inv1', admittedItems: 45, droppedItems: 12, admittedTokens: 91000, droppedTokens: 52000, admittedByCategory: {}, droppedReasons: [] }, 3, 3000),
    ]);

    const entries = b.snapshot();
    // All three context events are admitted
    expect(entries.filter((e) => e.kind === 'context.snapshot.created').length).toBe(1);
    expect(entries.filter((e) => e.kind === 'context.budget.computed').length).toBe(1);
    expect(entries.filter((e) => e.kind === 'context.assembled').length).toBe(1);
    // In chronological order (sorted by firstSequence)
    expect(entries.length).toBe(3);
    expect(entries[0]!.kind).toBe('context.snapshot.created');
    expect(entries[1]!.kind).toBe('context.budget.computed');
    expect(entries[2]!.kind).toBe('context.assembled');
  });

  it('admits context.preflight.failed and context.irreducible', () => {
    const b = new TimelineBuilder('s1');
    b.update([
      evt('context.preflight.failed', { invocationId: 'inv1', overageTokens: 5000, byCategory: {} }, 1, 1000),
      evt('context.irreducible', { invocationId: 'inv1', overageTokens: 10000, byCategory: {}, availableInputTokens: 96000, mandatoryTokens: 106000, contextWindowTokens: 131072 }, 2, 2000),
    ]);

    const entries = b.snapshot();
    expect(entries.filter((e) => e.kind === 'context.preflight.failed').length).toBe(1);
    expect(entries.filter((e) => e.kind === 'context.irreducible').length).toBe(1);
    expect(entries.length).toBe(2);
  });

  it('maps context event text from payload fields', () => {
    const b = new TimelineBuilder('s1');
    b.update([
      evt('context.budget.computed', { invocationId: 'inv1', contextWindowTokens: 131072, availableInputTokens: 96000, budgetReservation: 35072, requestedMaxOutputTokens: 35072 }, 1),
      evt('context.assembled', { invocationId: 'inv1', admittedItems: 45, droppedItems: 12, admittedTokens: 91000, droppedTokens: 52000, admittedByCategory: {}, droppedReasons: [] }, 2),
      evt('context.preflight.failed', { invocationId: 'inv1', overageTokens: 5000, byCategory: {} }, 3),
      evt('context.irreducible', { invocationId: 'inv1', overageTokens: 10000, byCategory: {}, availableInputTokens: 96000, mandatoryTokens: 106000, contextWindowTokens: 131072 }, 4),
    ]);

    const entries = b.snapshot();
    // context.budget.computed
    const budgetEntry = entries.find((e) => e.kind === 'context.budget.computed');
    expect(budgetEntry).toBeDefined();
    expect(budgetEntry!.text).toContain('131,072');
    expect(budgetEntry!.text).toContain('96,000');

    // context.assembled
    const assembledEntry = entries.find((e) => e.kind === 'context.assembled');
    expect(assembledEntry).toBeDefined();
    expect(assembledEntry!.text).toContain('91,000');
    expect(assembledEntry!.text).toContain('52,000');
    expect(assembledEntry!.text).toContain('45');
    expect(assembledEntry!.text).toContain('12');

    // context.preflight.failed
    const pfEntry = entries.find((e) => e.kind === 'context.preflight.failed');
    expect(pfEntry).toBeDefined();
    expect(pfEntry!.text).toContain('5,000');

    // context.irreducible
    const irrEntry = entries.find((e) => e.kind === 'context.irreducible');
    expect(irrEntry).toBeDefined();
    expect(irrEntry!.text).toContain('10,000');
  });

  it('filters out context events from other sessions', () => {
    const b = new TimelineBuilder('s1');
    b.update([
      evt('context.budget.computed', { invocationId: 'inv1', contextWindowTokens: 100, availableInputTokens: 80, budgetReservation: 20, requestedMaxOutputTokens: 20 }, 1),
    ]);
    // Different session — must not be admitted
    const otherSession = { ...evt('context.budget.computed', { invocationId: 'inv1' }, 2, 2000), sessionId: 's2' };
    b.update([otherSession]);
    expect(b.snapshot().length).toBe(1);
  });

  it('is idempotent — same event replayed is not double-admitted', () => {
    const b = new TimelineBuilder('s1');
    const batch = [
      evt('context.snapshot.created', { invocationId: 'inv1', candidateTokens: 100 }, 1, 1000),
    ];
    b.update(batch);
    b.update(batch);
    expect(b.snapshot().length).toBe(1);
  });
});
