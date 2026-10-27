import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CostAttribution, PricingCatalog } from '../../src/operations/observability/cost-attribution.js';
import { correlateRunCost, type UsageEvent } from '../../src/operations/evals/cost-correlation.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

/**
 * F1-D — effective-dated pricing.
 *
 * The defect: `PricingCatalog.lookup` always returned the LATEST entry, so
 * replaying a run from before a price change costed it at the new rate. In a
 * two-tier catalog that is a 10x error, and it silently rewrites history.
 *
 * A past invocation must be costed at the rate in force when it ran; an
 * invocation predating the earliest known price must be UNKNOWN, not borrowed.
 */

const TIERS = new PricingCatalog([
  { provider: 'acme', model: 'm1', effectiveFrom: '2025-01-01', inputPerMillion: 1, outputPerMillion: 2, currency: 'USD' },
  { provider: 'acme', model: 'm1', effectiveFrom: '2026-06-01', inputPerMillion: 10, outputPerMillion: 20, currency: 'USD' },
]);

const cwds: string[] = [];
afterEach(async () => {
  closeAllSharedLedgers();
  for (const cwd of cwds.splice(0)) await rm(cwd, { recursive: true, force: true });
});

describe('effective-dated pricing lookup (F1-D)', () => {
  it('selects the rate in force at the invocation time, not the latest', () => {
    expect(TIERS.lookup('acme', 'm1', '2025-03-15T00:00:00Z')?.inputPerMillion).toBe(1);
    expect(TIERS.lookup('acme', 'm1', '2026-07-01T00:00:00Z')?.inputPerMillion).toBe(10);
  });

  it('a same-day invocation picks the rate effective that day', () => {
    expect(TIERS.lookup('acme', 'm1', '2026-06-01T12:00:00Z')?.inputPerMillion).toBe(10);
  });

  it('the day before a change still uses the older rate', () => {
    expect(TIERS.lookup('acme', 'm1', '2026-05-31T23:59:59Z')?.inputPerMillion).toBe(1);
  });

  it('an invocation PREDATING the earliest price is unknown, never borrowed', () => {
    // Critical: borrowing the 2025 rate for a 2024 run would fabricate evidence.
    expect(TIERS.lookup('acme', 'm1', '2024-12-31T00:00:00Z')).toBeUndefined();
  });

  it('an unparseable effectiveFrom is excluded rather than treated as always-valid', () => {
    const bad = new PricingCatalog([
      { provider: 'x', model: 'y', effectiveFrom: 'not-a-date', inputPerMillion: 5, outputPerMillion: 5, currency: 'USD' },
    ]);
    expect(bad.lookup('x', 'y', '2026-01-01T00:00:00Z')).toBeUndefined();
  });

  it('omitting the date keeps the forward-looking latest behaviour', () => {
    expect(TIERS.lookup('acme', 'm1')?.inputPerMillion).toBe(10);
  });

  it('an unknown model stays unknown regardless of date', () => {
    expect(TIERS.lookup('acme', 'other', '2026-01-01T00:00:00Z')).toBeUndefined();
  });
});

describe('dated pricing through the cost summary (F1-D)', () => {
  async function summarise(events: unknown[]) {
    const cwd = await mkdtemp(join(tmpdir(), '.alix-f1d-'));
    cwds.push(cwd);
    const dir = join(cwd, '.alix', 'sessions', 's1');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
    return new CostAttribution(cwd, TIERS).summary('s1');
  }

  const ev = (ts: string, inputTokens: number) => ({
    id: `e-${ts}`, seq: 1, timestamp: ts, type: 'model.usage', sessionId: 's1',
    payload: { provider: 'acme', model: 'm1', inputTokens, outputTokens: 0 },
  });

  it('an old run is costed at the old rate', async () => {
    const s = await summarise([ev('2025-03-15T00:00:00Z', 1_000_000)]);
    expect(s.totalCost).toBe(1); // $1/Mtok tier
    expect(s.costCompleteness).toBe('complete');
  });

  it('a new run is costed at the new rate', async () => {
    const s = await summarise([ev('2026-07-01T00:00:00Z', 1_000_000)]);
    expect(s.totalCost).toBe(10); // $10/Mtok tier
  });

  it('a run before the earliest price is unknown, not zero and not the later rate', async () => {
    const s = await summarise([ev('2024-06-01T00:00:00Z', 1_000_000)]);
    expect(s.totalCost).toBe(-1);
    expect(s.costCompleteness).toBe('partial');
  });
});

describe('dated pricing through run correlation (F1-D)', () => {
  function usageEvent(id: string, runId: string, inputTokens: number, timestamp: string): UsageEvent {
    return {
      id, type: 'model.usage', timestamp, runId, sessionId: 's1',
      payload: { provider: 'acme', model: 'm1', inputTokens, outputTokens: 0 },
    };
  }

  it('correlates an invocation at its own timestamp, not the current rate', () => {
    const old = correlateRunCost([usageEvent('u1', 'run-old', 1_000_000, '2025-03-15T00:00:00Z')], 'run-old', TIERS);
    const recent = correlateRunCost([usageEvent('u2', 'run-new', 1_000_000, '2026-07-01T00:00:00Z')], 'run-new', TIERS);

    expect(old.observedCostUsd).toBe(1);
    expect(recent.observedCostUsd).toBe(10);
  });

  it('a run predating all pricing is unmeasured, with the model named', () => {
    const result = correlateRunCost([usageEvent('u1', 'run-ancient', 1_000_000, '2024-01-01T00:00:00Z')], 'run-ancient', TIERS);
    expect(result.observedCostUsd).toBeNull();
    expect(result.gap).toBe('unknown-pricing');
    expect(result.unpricedModels).toContain('acme/m1');
  });
});

describe('hive pricing remains unresolved in the catalog (F1-D)', () => {
  it('hive is absent from the default catalog and stays unknown', async () => {
    const { defaultPricingCatalog } = await import('../../src/operations/observability/cost-attribution.js');
    // No vendor-published rate exists in-repo. A proxy rate may be supplied as an
    // operator rate snapshot, but it must never live in the catalog: a catalog
    // entry reads as the vendor's own list price.
    expect(defaultPricingCatalog().lookup('hive', 'deepseek-ai/deepseek-v4.1-flash-1017')).toBeUndefined();
  });

  it('a hive run reports partial cost rather than a fabricated figure', async () => {
    const cwd = await mkdtemp(join(tmpdir(), '.alix-f1d-hive-'));
    cwds.push(cwd);
    const dir = join(cwd, '.alix', 'sessions', 's1');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'events.jsonl'), JSON.stringify({
      id: 'e1', seq: 1, timestamp: '2026-10-20T00:00:00Z', type: 'model.usage', sessionId: 's1',
      payload: { provider: 'hive', model: 'deepseek-ai/deepseek-v4.1-flash-1017', inputTokens: 1000, outputTokens: 100 },
    }) + '\n');

    const s = await new CostAttribution(cwd).summary('s1');
    expect(s.totalCost).toBe(-1);
    expect(s.costCompleteness).toBe('partial');
    expect(s.unknownPricingModels).toContain('hive/deepseek-ai/deepseek-v4.1-flash-1017');
  });
});
