import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFourWorkerScripted } from './four-worker-scripted.mjs';

test('four scripted workers use real planning, authorization, ownership, dependency and aggregate boundaries', async () => {
  const result = await runFourWorkerScripted();
  assert.deepEqual(result.completion, { execution: 'completed', aggregation: 'generated', outcome: 'success', verification: 'verified' });
  assert.equal(result.evidenceClass, 'scripted-real-kernel-mechanics');
  assert.equal(result.costUSD, null);
  assert.equal(result.model, null);
  assert.equal(result.verifiedPaidBaselineSuccesses, 0);
  assert.equal(result.workers.length, 4);
  assert.equal(new Set(result.workers.map(worker => worker.agentId)).size, 4);
  assert.deepEqual(result.outcomes.map(row => row.outcome), ['success', 'success', 'success', 'success']);
  assert.deepEqual(result.outputs.map(row => [row.path, row.content]), [
    ['docs/a.txt', 'A-MARKER\n'], ['docs/b.txt', 'B-MARKER\n'], ['docs/c.txt', 'C-MARKER\n'], ['docs/d.txt', 'D-MARKER\n'],
  ]);
  for (const row of result.observations) { assert.equal(row.outsideDenied, true); assert.ok(row.leaseIds.length); }
  const dependent = result.observations.find(row => row.path === 'docs/d.txt');
  assert.equal(dependent.dependencies.length, 3);
  assert.deepEqual(dependent.dependencyResults.map(row => row.workerId).sort(), [...dependent.dependencies].sort());
});
