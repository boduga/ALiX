import { describe, it, expect } from 'vitest';
import { MetricsProjection } from '../../../src/tui/runtime/metrics-projection.js';
import type { AlixEvent } from '../../../src/events/types.js';

/** Mirror the metrics-projection `evt()` helper — same seq + ms convention. */
function evt(type: string, payload: Record<string, unknown>, seq: number, at = seq * 1000): AlixEvent {
  return { id: `e${seq}`, seq, version: 1, sessionId: 'outer', timestamp: new Date(at).toISOString(), type, actor: 'system', payload };
}

describe('MetricsProjection — context counters', () => {
  it('starts with contextWindowTokens / availableInputTokens / budgetReservation = 0 and contextUtilization = null', () => {
    const s = new MetricsProjection().snapshot();
    expect(s.contextWindowTokens).toBe(0);
    expect(s.availableInputTokens).toBe(0);
    expect(s.budgetReservation).toBe(0);
    expect(s.admittedTokens).toBe(0);
    expect(s.droppedTokens).toBe(0);
    expect(s.contextUtilization).toBeNull();
  });

  it('updates budget counters from context.budget.computed', () => {
    const p = new MetricsProjection();
    p.update([
      evt('context.budget.computed', {
        contextWindowTokens: 131072,
        availableInputTokens: 113664,
        budgetReservation: 17408,
      }, 1),
    ]);
    const s = p.snapshot();
    expect(s.contextWindowTokens).toBe(131072);
    expect(s.availableInputTokens).toBe(113664);
    expect(s.budgetReservation).toBe(17408);
  });

  it('updates admission counters from context.assembled and derives contextUtilization', () => {
    const p = new MetricsProjection();
    // First compute a budget
    p.update([
      evt('context.budget.computed', {
        contextWindowTokens: 131072,
        availableInputTokens: 113664,
        budgetReservation: 17408,
      }, 1),
    ]);
    // Then assemble
    p.update([
      evt('context.assembled', {
        admittedTokens: 91000,
        droppedTokens: 52000,
        admittedByCategory: {},
        droppedReasons: [],
      }, 2),
    ]);
    const s = p.snapshot();
    expect(s.contextWindowTokens).toBe(131072);
    expect(s.availableInputTokens).toBe(113664);
    expect(s.admittedTokens).toBe(91000);
    expect(s.droppedTokens).toBe(52000);
    // contextUtilization = admittedTokens / availableInputTokens
    expect(s.contextUtilization).toBeCloseTo(91000 / 113664, 4);
  });

  it('contextUtilization is null when availableInputTokens = 0', () => {
    const p = new MetricsProjection();
    p.update([
      evt('context.assembled', { admittedTokens: 100, droppedTokens: 0, admittedByCategory: {}, droppedReasons: [] }, 1),
    ]);
    const s = p.snapshot();
    expect(s.contextUtilization).toBeNull();
  });

  it('skips non-finite counter values (same finite-value guard)', () => {
    const p = new MetricsProjection();
    p.update([
      evt('context.budget.computed', {
        contextWindowTokens: Number.NaN,
        availableInputTokens: Infinity,
        budgetReservation: -Infinity,
      }, 1),
    ]);
    const s = p.snapshot();
    expect(s.contextWindowTokens).toBe(0);
    expect(s.availableInputTokens).toBe(0);
    expect(s.budgetReservation).toBe(0);
  });

  it('does NOT change context counters on non-context events', () => {
    const p = new MetricsProjection();
    p.update([
      evt('context.budget.computed', { contextWindowTokens: 100000, availableInputTokens: 80000, budgetReservation: 20000 }, 1),
      evt('tool.requested', { toolCallId: 't1', toolName: 'read' }, 2),
      evt('model.usage', { inputTokens: 1000, outputTokens: 500 }, 3),
    ]);
    const s = p.snapshot();
    expect(s.contextWindowTokens).toBe(100000);
    expect(s.availableInputTokens).toBe(80000);
    // Non-context events only affect their own counters
    expect(s.toolCalls).toBe(1);
    expect(s.tokensUsed).toBe(1500);
  });

  it('is idempotent on at-least-once replay of context events', () => {
    const p = new MetricsProjection();
    const batch = [
      evt('context.budget.computed', { contextWindowTokens: 50000, availableInputTokens: 40000, budgetReservation: 10000 }, 1),
      evt('context.assembled', { admittedTokens: 35000, droppedTokens: 15000, admittedByCategory: {}, droppedReasons: [] }, 2),
    ];
    p.update(batch);
    const first = p.snapshot();
    p.update(batch);
    expect(p.snapshot()).toEqual(first);
    expect(p.snapshot().contextWindowTokens).toBe(50000);
    expect(p.snapshot().admittedTokens).toBe(35000);
  });

  it('snapshot() returns fresh immutable DTO — no payload references leaked', () => {
    const p = new MetricsProjection();
    p.update([
      evt('context.budget.computed', { contextWindowTokens: 1000, availableInputTokens: 800, budgetReservation: 200 }, 1),
    ]);
    const s1 = p.snapshot();
    const s2 = p.snapshot();
    expect(s1).toEqual(s2);
    expect(s1).not.toBe(s2); // distinct objects
  });
});
