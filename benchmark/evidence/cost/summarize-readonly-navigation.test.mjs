import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeReadonlyNavigation } from './summarize-readonly-navigation.mjs';

const recorded = JSON.parse(readFileSync(new URL('./readonly-navigation-gpt4o.json', import.meta.url), 'utf8'));
const rate = { inputPerMillion: 2.5, outputPerMillion: 10, effectiveFrom: '2025-01-01' };

test('recorded token arithmetic matches independent golden totals', () => {
  const result = summarizeReadonlyNavigation(recorded, rate);
  assert.equal(result.costUsd, 0.090668);
  assert.equal(result.perStratum['readonly-inspection'].costUsd, 0.045990);
  assert.equal(result.perStratum['code-navigation'].costUsd, 0.044678);
  assert.equal(result.verifiedSuccesses, 2);
  assert.equal(result.costPerVerifiedSuccessUsd, 0.045334);
});

test('failed attempts stay in numerator and zero successes have no ratio', () => {
  const raw = structuredClone(recorded);
  for (const row of raw.results) Object.assign(row, { verdict: 'fail', verifiedSuccess: false, objectiveLanded: false });
  const result = summarizeReadonlyNavigation(raw, rate);
  assert.equal(result.costUsd, 0.090668);
  assert.equal(result.verifiedSuccesses, 0);
  assert.equal(result.costPerVerifiedSuccessUsd, null);
  raw.results[0] = structuredClone(recorded.results[0]);
  assert.equal(summarizeReadonlyNavigation(raw, rate).costPerVerifiedSuccessUsd, 0.090668);
});

for (const [name, mutate] of [
  ['partial pricing', r => { r.results[0].pricedRecords = 2; }],
  ['incomplete', r => { r.results[0].completeness = 'partial'; }],
  ['missing observed', r => { delete r.results[0].usage.observed; }],
  ['unobserved', r => { r.results[0].usage.observed = false; }],
  ['malformed tokens', r => { r.results[0].usage.inputTokens = '18044'; }],
  ['duplicate rows', r => { r.results[1] = structuredClone(r.results[0]); }],
  ['missing case and stratum', r => { delete r.results[0].caseId; delete r.results[0].stratum; }],
  ['unknown case and stratum', r => { r.results[0].caseId = 'unknown'; r.results[0].stratum = 'unknown'; }],
  ['missing case', r => { delete r.results[0].caseId; }],
  ['missing stratum', r => { delete r.results[0].stratum; }],
  ['wrong model', r => { r.results[0].model = 'other'; }],
  ['false success', r => { r.results[0].objectiveLanded = false; }],
  ['wrong cost', r => { r.results[0].costUsd = 0; }],
  ['missing honesty', r => { delete r.results[0].statusHonest; }],
]) test(`rejects ${name}`, () => {
  const raw = structuredClone(recorded); mutate(raw);
  assert.throws(() => summarizeReadonlyNavigation(raw, rate));
});

test('missing or malformed historical rates are rejected', () => {
  for (const value of [undefined, {}, { ...rate, outputPerMillion: null }, { ...rate, effectiveFrom: 'bad' }]) {
    assert.throws(() => summarizeReadonlyNavigation(recorded, value));
  }
});

test('finite cost that overflows six-decimal rounding is rejected', () => {
  const raw = structuredClone(recorded);
  const largeRate = { ...rate, inputPerMillion: 1e308 };
  for (const row of raw.results) {
    row.usage.inputTokens = 1;
    row.usage.outputTokens = 0;
    row.costUsd = 1e302;
  }
  // Each row can be scaled; their finite sum overflows when scaled by 1e6.
  assert.throws(() => summarizeReadonlyNavigation(raw, largeRate), /rounding range/);
});
