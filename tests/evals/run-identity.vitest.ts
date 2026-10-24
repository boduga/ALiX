import { describe, expect, it } from 'vitest';
import { correlateRunCost } from '../../src/operations/evals/cost-correlation.js';
import { PricingCatalog } from '../../src/operations/observability/cost-attribution.js';
import type { UsageEvent } from '../../src/operations/evals/cost-correlation.js';

/**
 * F1-A — run identity propagation.
 *
 * The emit site (`task-loop/main.ts`) attaches `deps.context.runId` to
 * `model.usage`. These tests pin the CONTRACT that makes cost correlation
 * possible, and the property that matters most: two concurrent workers must not
 * be able to receive the same unrelated identity.
 *
 * The production emit itself is exercised by the integration suite; here we pin
 * the identity semantics and the correlation outcome each case produces.
 */

const catalog = new PricingCatalog([
  { provider: 'openai', model: 'gpt-4o', effectiveFrom: '2025-01-01', inputPerMillion: 2.5, outputPerMillion: 10, currency: 'USD' },
]);

function usageEvent(
  id: string,
  runId: string | undefined,
  inputTokens: number,
  outputTokens: number,
): UsageEvent {
  return {
    id,
    type: 'model.usage',
    timestamp: '2026-10-20T10:00:00.000Z',
    ...(runId ? { runId } : {}),
    sessionId: 'sess-1',
    payload: { provider: 'openai', model: 'gpt-4o', inputTokens, outputTokens },
  };
}

describe('run identity propagation (F1-A)', () => {
  it('a run id on the usage event makes cost correlatable', () => {
    const events = [usageEvent('u1', 'run-A', 1_000_000, 0)];
    const result = correlateRunCost(events, 'run-A', catalog);

    expect(result.gap).toBeNull();
    expect(result.observedCostUsd).toBe(2.5);
    expect(result.invocationCount).toBe(1);
  });

  it('an absent run id yields no-run-id, never a silent zero', () => {
    // Legacy/embedded callers that supply no identity must degrade to an
    // explicit gap — the emit site omits the field rather than guessing.
    const events = [usageEvent('u1', undefined, 1_000_000, 0)];
    const result = correlateRunCost(events, 'run-A', catalog);

    expect(result.observedCostUsd).toBeNull();
    expect(result.gap).toBe('no-invocations');
    expect(result.evidence.join(' ')).toContain('none carry this runId');
  });

  it('two concurrent workers keep separate identities and separate costs', () => {
    // The critical property: a shared session must not let two workers collapse
    // onto one run identity, which would double-charge a single run.
    const events = [
      usageEvent('u1', 'run-worker-1', 1_000_000, 0),
      usageEvent('u2', 'run-worker-2', 1_000_000, 0),
    ];

    const first = correlateRunCost(events, 'run-worker-1', catalog);
    const second = correlateRunCost(events, 'run-worker-2', catalog);

    expect(first.invocationCount).toBe(1);
    expect(second.invocationCount).toBe(1);
    expect(first.observedCostUsd).toBe(2.5);
    expect(second.observedCostUsd).toBe(2.5);
  });

  it('the same run with two worker invocations aggregates once each', () => {
    // A parent run that owns both worker invocations sees the sum exactly once.
    const events = [
      usageEvent('u1', 'run-parent', 1_000_000, 0),
      usageEvent('u2', 'run-parent', 1_000_000, 0),
    ];
    const result = correlateRunCost(events, 'run-parent', catalog);

    expect(result.invocationCount).toBe(2);
    expect(result.observedCostUsd).toBe(5);
  });

  it('a worker run id does not leak into the parent run total', () => {
    const events = [
      usageEvent('u1', 'run-parent', 1_000_000, 0),
      usageEvent('u2', 'run-worker-1', 1_000_000, 0),
    ];
    const parent = correlateRunCost(events, 'run-parent', catalog);
    expect(parent.invocationCount).toBe(1);
    expect(parent.observedCostUsd).toBe(2.5);
  });
});
