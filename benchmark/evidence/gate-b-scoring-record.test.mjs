/**
 * gate-b-scoring-record.test.mjs — pins the independent-scoring record contract.
 *
 * The risk this covers is a record that *looks* independent. Each test below is
 * a way a plausible-looking artifact could have let author-only scoring stand in
 * for GB-12.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FROZEN_REQUIREMENTS,
  validateScoringRecord,
  renderScoringReport,
} from './gate-b-scoring-record.mjs';

const AUTHOR = 'Babasola <boduga@gmail.com>';

function fullRequirements(verdict = 'met') {
  return FROZEN_REQUIREMENTS.map(id => ({
    id,
    verdict,
    ...(verdict === 'met' ? { evidence: `benchmark/evidence/${id}.json` } : { note: 'not established' }),
  }));
}

function record(overrides = {}) {
  return {
    author: AUTHOR,
    reviewer: 'Independent Reviewer <reviewer@example.org>',
    scoredAt: '2026-10-24T00:00:00.000Z',
    artifactSet: 'docs/audits/2026-10-23-gate-b-acceptance-packet.md',
    requirements: fullRequirements(),
    ...overrides,
  };
}

test('a complete independently scored record is eligible for signature', () => {
  const result = validateScoringRecord(record());
  assert.equal(result.ok, true);
  assert.equal(result.independence, 'declared-independent');
  assert.equal(result.summary.scored, FROZEN_REQUIREMENTS.length);
  assert.equal(result.summary.allMet, true);
  assert.equal(result.summary.gateB, 'ELIGIBLE-FOR-SIGNATURE');
});

test('the same reviewer as the author is rejected as same-party', () => {
  const result = validateScoringRecord(record({ reviewer: AUTHOR }));
  assert.equal(result.independence, 'same-party');
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(p => /author-only scoring/.test(p)));
});

test('the same person under a different case and punctuation is still same-party', () => {
  const result = validateScoringRecord(record({ reviewer: '  babasola   <BODUGA@gmail.com> ' }));
  assert.equal(result.independence, 'same-party');
  assert.equal(result.summary.gateB, 'HOLD');
});

test('a different display name sharing the author email is same-party', () => {
  const result = validateScoringRecord(record({ reviewer: 'B. A. <boduga@gmail.com>' }));
  assert.equal(result.independence, 'same-party');
});

test('an unfilled record is incomplete, never a pass', () => {
  const result = validateScoringRecord(record({ requirements: fullRequirements().slice(0, 3) }));
  assert.equal(result.ok, false);
  assert.equal(result.summary.allMet, false);
  assert.equal(result.summary.gateB, 'HOLD');
  assert.ok(result.problems.some(p => /GB-14 has no verdict/.test(p)));
});

test('a "met" verdict without cited evidence is rejected', () => {
  const reqs = fullRequirements();
  delete reqs[0].evidence;
  const result = validateScoringRecord(record({ requirements: reqs }));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(p => /'met' without cited evidence/.test(p)));
});

test('a non-met verdict without a note is rejected', () => {
  const reqs = fullRequirements();
  reqs[0] = { id: 'GB-01', verdict: 'missing' };
  const result = validateScoringRecord(record({ requirements: reqs }));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(p => /without a note/.test(p)));
});

test('any missing requirement keeps Gate B on HOLD even when the rest are met', () => {
  const reqs = fullRequirements();
  reqs[5] = { id: 'GB-06', verdict: 'missing', note: 'no independent denominator' };
  const result = validateScoringRecord(record({ requirements: reqs }));
  assert.equal(result.summary.met, FROZEN_REQUIREMENTS.length - 1);
  assert.equal(result.summary.gateB, 'HOLD');
});

test('duplicate and unknown requirement ids are rejected', () => {
  const reqs = [...fullRequirements(), { id: 'GB-01', verdict: 'met', evidence: 'x' }];
  const unknown = [...fullRequirements(), { id: 'GB-99', verdict: 'met', evidence: 'x' }];
  assert.ok(validateScoringRecord(record({ requirements: reqs })).problems.some(p => /more than once/.test(p)));
  assert.ok(validateScoringRecord(record({ requirements: unknown })).problems.some(p => /unknown requirement id/.test(p)));
});

test('the artifact set and reviewer identity are mandatory', () => {
  assert.ok(validateScoringRecord(record({ artifactSet: '' })).problems.some(p => /artifactSet is required/.test(p)));
  assert.ok(validateScoringRecord(record({ reviewer: '' })).problems.some(p => /reviewer identity is required/.test(p)));
});

test('the rendered report states independence and the gate verdict', () => {
  const text = renderScoringReport(validateScoringRecord(record()));
  assert.match(text, /independence: declared-independent/);
  assert.match(text, /gate B: ELIGIBLE-FOR-SIGNATURE/);
});
