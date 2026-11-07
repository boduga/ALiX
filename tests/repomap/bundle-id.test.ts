import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetingStage } from '../../src/context/repomap/context-pipeline.js';

test('independent bundles remain distinct within the same millisecond', async () => {
  const stage = new BudgetingStage();
  const originalNow = Date.now;
  Date.now = () => 1794081711658;
  try {
    const input = { items: [], repoMap: {} as never, task: 'fix bug', taskType: 'bugfix' as const };
    const first = await stage.process(input);
    const second = await stage.process({ ...input, task: 'fix bug pinned' });
    assert.match(first.bundle.id, /^bundle-/);
    assert.notEqual(first.bundle.id, second.bundle.id);
  } finally {
    Date.now = originalNow;
  }
});
