import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepCases } from './eval-case-sweep.mjs';
import { BEHAVIORAL_CASES } from '../../../dist/src/operations/evals/cases/index.js';

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
    } finally {
      BEHAVIORAL_CASES.splice(BEHAVIORAL_CASES.indexOf(fixture), 1);
    }
  });
}
