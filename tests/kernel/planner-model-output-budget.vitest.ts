import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/operations/config/defaults.js';
import { createPlannerGenerator } from '../../src/coordination/kernel/planner-model.js';
import type { NormalizedRequest } from '../../src/models/providers/types.js';

const { complete, createProvider } = vi.hoisted(() => {
  const complete = vi.fn(async (_request: NormalizedRequest) => ({ text: '{"nodes":[]}' }));
  return { complete, createProvider: vi.fn(async () => ({ complete })) };
});
vi.mock('../../src/models/providers/registry.js', () => ({ createProvider }));

beforeEach(() => vi.clearAllMocks());

it('forwards explicit output budget on every plan call without mutating config or recreating provider', async () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.models = { default: { provider: 'mock', name: 'planner-fixture' } };
  config.context.budget = { ...config.context.budget, outputCap: 2048 };
  const before = structuredClone(config);
  const generate = createPlannerGenerator(config);
  expect(await generate('first plan')).toBe('{"nodes":[]}');
  expect(await generate('repair plan')).toBe('{"nodes":[]}');
  expect(complete.mock.calls.map(([request]) => request.maxOutputTokens)).toEqual([2048, 2048]);
  expect(createProvider).toHaveBeenCalledTimes(1);
  expect(createProvider).toHaveBeenCalledWith({ provider: 'mock', name: 'planner-fixture' });
  expect(config).toEqual(before);
});

it('omits request output cap when no explicit budget is configured', async () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.models = { default: { provider: 'mock', name: 'planner-fixture' } };
  delete config.context.budget?.outputCap;
  const before = structuredClone(config);
  await createPlannerGenerator(config)('uncapped plan');
  expect(complete).toHaveBeenCalledTimes(1);
  expect(complete.mock.calls[0][0]).not.toHaveProperty('maxOutputTokens');
  expect(config).toEqual(before);
});
