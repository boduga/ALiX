import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepCases, percentile, summarizeLatency } from './eval-case-sweep.mjs';
import { BEHAVIORAL_CASES } from '../../../dist/src/operations/evals/cases/index.js';

test('percentile uses nearest rank and stays null with no samples', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([40], 50), 40);
  assert.equal(percentile([10, 20, 30, 40], 50), 20);
  assert.equal(percentile([10, 20, 30, 40], 95), 40);
  // Non-finite values are not samples; they must not become the 100th percentile.
  assert.equal(percentile([Number.NaN, 10, Number.POSITIVE_INFINITY], 95), 10);
});

test('latency summarizes case durations, never a missing one', () => {
  assert.deepEqual(summarizeLatency([{}, { durationMs: null }]), {
    observed: false, samples: 0, p50Ms: null, p95Ms: null, reason: 'no case duration recorded',
  });
  assert.deepEqual(summarizeLatency([{ durationMs: 10 }, { durationMs: 30 }, { durationMs: 20 }]), {
    observed: true, samples: 3, p50Ms: 20, p95Ms: 30,
  });
});

for (const guardSatisfied of [true, false]) {
  test(`sweep preserves positive guard evidence (satisfied=${guardSatisfied})`, async () => {
    // A fixed-status fixture drives actual runner/scoring/serialization without
    // inference or credentials. Keep the negative objective and status constant:
    // only the independent positive guard decides whether success is verified.
    const id = `behavioral.sweep-guard-${guardSatisfied}`;
    const fixture = {
      id, description: 'guard evidence transport fixture', driver: 'delegate',
      task: 'Synthetic evaluator fixture.', syntheticStatus: 'failed',
      objective: { kind: 'file', path: 'missing.md', exists: true },
      expected: { objectiveLanded: false, statuses: ['failed'] },
      guards: { files: [{ path: 'required.txt', contentEquals: 'correct' }] },
      seed: { 'required.txt': guardSatisfied ? 'correct' : 'wrong' },
    };
    BEHAVIORAL_CASES.push(fixture);
    try {
      const [row] = await sweepCases([id], { provider: 'scripted-mock', model: 'mock' });
      assert.equal(row.objectiveLanded, false);
      assert.equal(row.statusHonest, true);
      assert.equal(row.guardEvidence.satisfied, guardSatisfied);
      assert.equal(row.verifiedSuccess, guardSatisfied);
      assert.equal(row.verdict, guardSatisfied ? 'pass' : 'fail');
      assert.equal(row.costUsd, null);
      // A synthetic fixture never starts a driver, so there is no session log to
      // read. Every Gate B count must be unknown (null), never a flattering zero.
      assert.equal(row.toolCalls, null);
      assert.equal(row.rejectedCalls, null);
      assert.equal(row.repeatedCalls, null);
      assert.equal(row.toolRetries, null);
      assert.equal(row.providerRetries, null);
      assert.equal(row.driverReinvocations, null);
      assert.equal(row.operatorCancellations, null);
      assert.equal(row.operatorActiveReviewMinutes, null);
      assert.ok(row.unobserved.length > 0);
      assert.equal(typeof row.finishedAt, 'string');
      assert.equal(typeof row.durationMs, 'number');
    } finally {
      BEHAVIORAL_CASES.splice(BEHAVIORAL_CASES.indexOf(fixture), 1);
    }
  });
}
