import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CostAttribution, PricingCatalog, isNonBillableProvider } from '../../src/operations/observability/cost-attribution.js';
import { formatCostPanel } from '../../src/interfaces/tui/cost-panel.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

/**
 * F1-C — aggregate cost reporting integrity.
 *
 * Invariant: a COMPLETE total must never be reported when any contributing
 * BILLABLE invocation has unknown cost.
 *
 * Before this fix, `totalCost` summed only priced providers, so a session mixing
 * priced and unpriced models reported a figure that looked complete and was
 * silently too low.
 */

const cwds: string[] = [];
afterEach(async () => {
  closeAllSharedLedgers();
  for (const cwd of cwds.splice(0)) await rm(cwd, { recursive: true, force: true });
});

const CATALOG = new PricingCatalog([
  { provider: 'openai', model: 'gpt-4o', effectiveFrom: '2025-01-01', inputPerMillion: 2.5, outputPerMillion: 10, currency: 'USD' },
]);

let seq = 0;
function usage(provider: string, model: string, inputTokens: number, outputTokens = 0) {
  seq += 1;
  return { id: `e${seq}`, seq, timestamp: '2026-10-20T10:00:00.000Z', type: 'model.usage', sessionId: 's1',
    payload: { provider, model, inputTokens, outputTokens } };
}

async function summarise(events: unknown[]) {
  const cwd = await mkdtemp(join(tmpdir(), '.alix-f1c-'));
  cwds.push(cwd);
  const dir = join(cwd, '.alix', 'sessions', 's1');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
  return new CostAttribution(cwd, CATALOG).summary('s1');
}

describe('aggregate cost integrity (F1-C)', () => {
  it('all invocations priced -> exact complete total', async () => {
    const s = await summarise([usage('openai', 'gpt-4o', 1_000_000, 0)]);
    expect(s.totalCost).toBe(2.5);
    expect(s.costCompleteness).toBe('complete');
    expect(s.knownCostSubtotal).toBeNull();
  });

  it('one priced + one unpriced billable -> complete total is UNKNOWN', async () => {
    const s = await summarise([
      usage('openai', 'gpt-4o', 1_000_000, 0),
      usage('hive', 'deepseek-ai/deepseek-v4.1-flash-1017', 1_000_000, 0),
    ]);
    expect(s.totalCost).toBe(-1);
    expect(s.costCompleteness).toBe('partial');
    // The priced portion is still available as a LABELLED diagnostic.
    expect(s.knownCostSubtotal).toBe(2.5);
  });

  it('all invocations unpriced -> complete total is UNKNOWN', async () => {
    const s = await summarise([usage('hive', 'deepseek-ai/deepseek-v4.1-flash-1017', 1_000_000, 0)]);
    expect(s.totalCost).toBe(-1);
    expect(s.costCompleteness).toBe('partial');
    expect(s.knownCostSubtotal).toBe(0);
  });

  it('verified non-billable only -> $0, explicitly non-billable (not unknown)', async () => {
    const s = await summarise([usage('scripted-mock', 'mock', 100, 10)]);
    expect(s.totalCost).toBe(0);
    expect(s.costCompleteness).toBe('non_billable');
    // Crucially NOT -1: non-billable is a known zero, not missing knowledge.
    expect(s.totalCost).not.toBe(-1);
  });

  it('priced + non-billable -> exact priced total (local runs are not unpriced)', async () => {
    const s = await summarise([
      usage('openai', 'gpt-4o', 1_000_000, 0),
      usage('scripted-mock', 'mock', 100, 10),
    ]);
    expect(s.totalCost).toBe(2.5);
    expect(s.costCompleteness).toBe('complete');
  });

  it('no usage at all -> $0 labelled none, not unknown', async () => {
    const s = await summarise([]);
    expect(s.totalCost).toBe(0);
    expect(s.costCompleteness).toBe('none');
  });

  it('names the unpriced model as the blocker', async () => {
    const s = await summarise([
      usage('openai', 'gpt-4o', 1_000_000, 0),
      usage('hive', 'deepseek-ai/deepseek-v4.1-flash-1017', 1_000_000, 0),
    ]);
    expect(s.unknownPricingModels).toContain('hive/deepseek-ai/deepseek-v4.1-flash-1017');
  });

  it('concurrent worker invocations are counted once each', async () => {
    const s = await summarise([
      usage('openai', 'gpt-4o', 1_000_000, 0),
      usage('openai', 'gpt-4o', 1_000_000, 0),
    ]);
    expect(s.totalCost).toBe(5); // 2 × 2.5, not 2.5 and not 10
    expect(s.byProvider['openai']!.calls).toBe(2);
  });

  it('per-provider and per-workflow unknown behaviour is preserved', async () => {
    const s = await summarise([
      usage('openai', 'gpt-4o', 1_000_000, 0),
      usage('hive', 'deepseek-ai/deepseek-v4.1-flash-1017', 1_000_000, 0),
    ]);
    // Unchanged contract: an unknown call makes that provider's figure unknown.
    expect(s.byProvider['hive']!.cost).toBe(-1);
    expect(s.byProvider['openai']!.cost).toBe(2.5);
  });
});

describe('cost panel renders completeness honestly (F1-C)', () => {
  const base = {
    totalTokens: 1000,
    byProvider: {},
    byWorkflow: {},
    unknownPricingModels: [] as string[],
  };

  it('a partial figure is labelled partial, never as a total', () => {
    const lines = formatCostPanel({
      ...base,
      totalCost: -1,
      costCompleteness: 'partial',
      knownCostSubtotal: 2.5,
      unknownPricingModels: ['hive/deepseek'],
    }).join('\n');

    expect(lines).toContain('unknown');
    expect(lines).toContain('$2.5000 (partial — not a total)');
    // It must never present the subtotal as the total.
    expect(lines).not.toContain('Total cost:   $2.5000');
  });

  it('non-billable execution is labelled rather than shown as unknown', () => {
    const lines = formatCostPanel({ ...base, totalCost: 0, costCompleteness: 'non_billable' }).join('\n');
    expect(lines).toContain('non-billable');
  });

  it('a complete total renders normally', () => {
    const lines = formatCostPanel({ ...base, totalCost: 2.5, costCompleteness: 'complete' }).join('\n');
    expect(lines).toContain('$2.5000');
    expect(lines).not.toContain('partial');
  });

  it('panels constructed without completeness still work (back-compat)', () => {
    const lines = formatCostPanel({ ...base, totalCost: 1.5 }).join('\n');
    expect(lines).toContain('$1.5000');
  });
});

describe('non-billable provider list has one definition (F1-C)', () => {
  it('recognises local and scripted providers', () => {
    for (const p of ['scripted-mock', 'mock', 'local-llama', 'ollama', 'test']) {
      expect(isNonBillableProvider(p)).toBe(true);
    }
    expect(isNonBillableProvider('openai')).toBe(false);
    // A real remote provider with missing pricing is NOT non-billable.
    expect(isNonBillableProvider('hive')).toBe(false);
  });
});
