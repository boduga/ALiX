import { describe, expect, it } from 'vitest';
import {
  correlateRunCost,
  invocationsForRun,
  isNonBillableProvider,
  type PricingLookup,
  type UsageEvent,
} from '../../src/operations/evals/cost-correlation.js';
import { PricingCatalog } from '../../src/operations/observability/cost-attribution.js';

let seq = 0;
function usage(
  provider: string,
  model: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  runId: string | undefined = 'run-1',
): UsageEvent {
  seq += 1;
  return {
    id: `u${seq}`, type: 'model.usage', timestamp: '2026-10-20T10:00:00.000Z',
    ...(runId ? { runId } : {}),
    sessionId: 's1',
    payload: {
      provider, model,
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
    },
  };
}

const catalog = new PricingCatalog([
  { provider: 'openai', model: 'gpt-4o', effectiveFrom: '2025-01-01', inputPerMillion: 2.5, outputPerMillion: 10, currency: 'USD' },
  { provider: 'anthropic', model: 'sonnet', effectiveFrom: '2025-01-01', inputPerMillion: 3, outputPerMillion: 15, currency: 'USD' },
]);

describe('cost correlation (P0-D4)', () => {
  it('traces run → invocation → usage → pricing and is independently recomputable', () => {
    // 1M input @ $2.5 + 1M output @ $10 = $12.5
    const events = [usage('openai', 'gpt-4o', 1_000_000, 1_000_000)];
    const result = correlateRunCost(events, 'run-1', catalog);

    expect(result.observedCostUsd).toBe(12.5);
    expect(result.gap).toBeNull();
    expect(result.invocationCount).toBe(1);
    expect(result.unpricedModels).toEqual([]);
    // The evidence chain must let a reviewer recompute by hand.
    expect(result.evidence.join(' ')).toContain('@ $2.5/$10 per Mtok');
  });

  it('SUMS concurrent worker invocations exactly once', () => {
    // Two workers, same run: each contributes once, no double counting.
    const events = [
      usage('openai', 'gpt-4o', 1_000_000, 0),
      usage('openai', 'gpt-4o', 1_000_000, 0),
    ];
    const result = correlateRunCost(events, 'run-1', catalog);
    expect(result.invocationCount).toBe(2);
    expect(result.observedCostUsd).toBe(5); // 2 × $2.5
  });

  it('does NOT charge another run\'s usage to this run', () => {
    const events = [
      usage('openai', 'gpt-4o', 1_000_000, 0, 'run-1'),
      usage('openai', 'gpt-4o', 1_000_000, 0, 'run-2'),
    ];
    const result = correlateRunCost(events, 'run-1', catalog);
    expect(result.invocationCount).toBe(1);
    expect(result.observedCostUsd).toBe(2.5);
  });

  it('WITHHOLDS the total when any invocation is unpriced — never a partial sum', () => {
    // This is the defect class the existing summary() has: a total that looks
    // complete while silently excluding an unpriced model.
    const events = [
      usage('openai', 'gpt-4o', 1_000_000, 0),
      usage('intern', 'deepseek-v4-flash-0731', 1_000_000, 0),
    ];
    const result = correlateRunCost(events, 'run-1', catalog);

    expect(result.observedCostUsd).toBeNull();
    expect(result.gap).toBe('unknown-pricing');
    expect(result.unpricedModels).toEqual(['intern/deepseek-v4-flash-0731']);
    // Tokens are still reported: a different dimension from cost.
    expect(result.inputTokens).toBe(2_000_000);
    expect(result.evidence.join(' ')).toContain('partial sum withheld');
  });

  it('marks a scripted provider non_billable, never zero-cost', () => {
    const events = [usage('scripted-mock', 'mock', 100, 20)];
    const result = correlateRunCost(events, 'run-1', catalog);

    expect(result.observedCostUsd).toBeNull();
    expect(result.gap).toBe('non-billable');
    expect(result.evidence.join(' ')).toContain('not applicable, not zero');
  });

  it('reports missing-usage rather than computing from partial token data', () => {
    const events = [
      usage('openai', 'gpt-4o', 1000, 100),
      usage('openai', 'gpt-4o', undefined, undefined),
    ];
    const result = correlateRunCost(events, 'run-1', catalog);
    expect(result.observedCostUsd).toBeNull();
    expect(result.gap).toBe('missing-usage');
    expect(result.inputTokens).toBeNull();
  });

  it('reports no-invocations when the run emitted no usage', () => {
    const result = correlateRunCost([], 'run-1', catalog);
    expect(result.observedCostUsd).toBeNull();
    expect(result.gap).toBe('no-invocations');
  });

  it('distinguishes "usage exists but not for this run"', () => {
    const events = [usage('openai', 'gpt-4o', 100, 10, 'other-run')];
    const result = correlateRunCost(events, 'run-1', catalog);
    expect(result.observedCostUsd).toBeNull();
    expect(result.evidence.join(' ')).toContain('none carry this runId');
  });

  it('rejects an empty runId instead of correlating everything', () => {
    const result = correlateRunCost([usage('openai', 'gpt-4o', 1, 1)], '', catalog);
    expect(result.observedCostUsd).toBeNull();
    expect(result.gap).toBe('no-run-id');
  });

  it('recomputes identically to the existing calculator for the same inputs', () => {
    // Parity: the projection must not invent a different rounding scheme.
    const price = { inputPerMillion: 2.5, outputPerMillion: 10 };
    const expected = Math.round(((1_500_000 / 1_000_000) * price.inputPerMillion
      + (300_000 / 1_000_000) * price.outputPerMillion) * 1_000_000) / 1_000_000;
    const result = correlateRunCost([usage('openai', 'gpt-4o', 1_500_000, 300_000)], 'run-1', catalog);
    expect(result.observedCostUsd).toBe(expected);
  });
});

describe('invocation extraction (P0-D4)', () => {
  it('ignores non-usage events entirely', () => {
    const events: UsageEvent[] = [
      { id: 'x', type: 'tool.completed', timestamp: 't', runId: 'run-1', payload: {} },
      usage('openai', 'gpt-4o', 1, 1),
    ];
    expect(invocationsForRun(events, 'run-1')).toHaveLength(1);
  });

  it('recognises the known non-billable providers', () => {
    for (const provider of ['scripted-mock', 'mock', 'local-llama', 'ollama', 'test']) {
      expect(isNonBillableProvider(provider)).toBe(true);
    }
    expect(isNonBillableProvider('openai')).toBe(false);
    expect(isNonBillableProvider('intern')).toBe(false);
  });

  it('keeps a malformed invocation visible instead of dropping it', () => {
    const invocations = invocationsForRun([usage('openai', 'gpt-4o', undefined, undefined)], 'run-1');
    expect(invocations).toHaveLength(1);
    expect(Number.isFinite(invocations[0]!.inputTokens)).toBe(false);
  });
});
