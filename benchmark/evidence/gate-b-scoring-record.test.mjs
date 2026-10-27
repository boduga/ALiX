/**
 * gate-b-scoring-record.test.mjs — pins the independent-scoring record contract.
 *
 * The risk this covers is a record that *looks* independent. Each test below is
 * a way a plausible-looking artifact could have let author-only scoring stand in
 * for GB-12.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

// ── model review is its own class, never human independence ────────────────
test('a model reviewer is classified model-independent, not declared-independent', () => {
  const result = validateScoringRecord(record({
    reviewer: 'Codex CLI 0.164.0 / gpt-6.1-sol',
    reviewerKind: 'model',
  }));
  assert.equal(result.independence, 'model-independent');
  assert.equal(result.ok, true);
});

test('a model reviewer with no reviewerKind is still detected from the identity', () => {
  // The failure this prevents: a model reviewer recorded as
  // 'declared-independent' and later cited as human independence.
  const result = validateScoringRecord(record({ reviewer: 'Claude / claude-opus-4' }));
  assert.equal(result.independence, 'model-independent');
});

test('a human reviewer stays declared-independent', () => {
  const result = validateScoringRecord(record({ reviewerKind: 'human' }));
  assert.equal(result.independence, 'declared-independent');
});

test('a reviewerKind of human on a model identity is rejected', () => {
  const result = validateScoringRecord(record({
    reviewer: 'Codex / gpt-6.1-sol',
    reviewerKind: 'human',
  }));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(p => /names a model/.test(p)));
});

/**
 * `waived` closure — a requirement no agent can measure, signed and cited.
 *
 * The failure modes this covers: a waiver written as a bare flag (so nothing was
 * actually signed), a citation to a file that does not exist, a citation whose
 * artifact does not name the signer, and a waiver quietly counted as `met`.
 */
const SIGNED_WAIVER = {
  ref: 'waiver.md',
  signedBy: 'Babasola',
  signedAt: '2026-10-24T00:00:00.000Z',
};

function waivedRecord({ waiver = SIGNED_WAIVER, verdict = 'waived' } = {}) {
  const reqs = fullRequirements();
  reqs[10] = {
    id: 'GB-11',
    verdict,
    note: 'operator attention is not measurable by any agent',
    evidence: 'docs/audits/2026-10-24-gb11-waiver.md',
    ...(waiver === null ? {} : { waiver }),
  };
  return { reqs };
}

function withWaiverFile(body, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-b-waiver-'));
  try {
    writeFileSync(join(dir, 'waiver.md'), body);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a signed, cited waiver closes Gate B at the weaker label, never at met', () => {
  withWaiverFile('# waiver\n\n| Operator identity | Babasola |\n', dir => {
    const { reqs } = waivedRecord();
    const result = validateScoringRecord(record({ requirements: reqs }), { baseDir: dir });
    assert.equal(result.ok, true);
    assert.equal(result.summary.waived, 1);
    assert.equal(result.summary.met, FROZEN_REQUIREMENTS.length - 1);
    assert.equal(result.summary.allMet, false);
    assert.equal(result.summary.gateB, 'CLOSED-WITH-WAIVER');
    assert.deepEqual(result.summary.waivedRequirements, ['GB-11']);
    const text = renderScoringReport(result);
    assert.ok(/waived, not met/.test(text));
    assert.ok(/never as all requirements met/.test(text));
  });
});

test('a waived requirement without a citation is rejected', () => {
  const { reqs } = waivedRecord({ waiver: null });
  const result = validateScoringRecord(record({ requirements: reqs }));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(p => /without a waiver citation/.test(p)));
  assert.equal(result.summary.gateB, 'HOLD');
});

test('a waiver citing a file that does not exist is rejected', () => {
  const { reqs } = waivedRecord();
  const result = validateScoringRecord(record({ requirements: reqs }), { baseDir: tmpdir() });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(p => /waiver ref does not exist/.test(p)));
  assert.equal(result.summary.gateB, 'HOLD');
});

test('a waiver whose artifact does not name the signer is rejected', () => {
  withWaiverFile('# waiver\n\nall fields blank\n', dir => {
    const { reqs } = waivedRecord();
    const result = validateScoringRecord(record({ requirements: reqs }), { baseDir: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /does not contain the named signer/.test(p)));
    assert.equal(result.summary.gateB, 'HOLD');
  });
});

test('a waiver cannot carry an author-only record past HOLD', () => {
  withWaiverFile('| Operator identity | Babasola |\n', dir => {
    const { reqs } = waivedRecord();
    const result = validateScoringRecord(
      record({ requirements: reqs, reviewer: AUTHOR }),
      { baseDir: dir },
    );
    assert.equal(result.independence, 'same-party');
    assert.equal(result.summary.gateB, 'HOLD');
  });
});

test('one remaining partial keeps Gate B on HOLD even with a signed waiver', () => {
  withWaiverFile('| Operator identity | Babasola |\n', dir => {
    const reqs = fullRequirements();
    reqs[10] = {
      id: 'GB-11',
      verdict: 'waived',
      note: 'not measurable',
      waiver: { ref: 'waiver.md', signedBy: 'Babasola', signedAt: '2026-10-24T00:00:00.000Z' },
    };
    reqs[5] = { id: 'GB-06', verdict: 'partial', note: 'denominator unverified' };
    const result = validateScoringRecord(record({ requirements: reqs }), { baseDir: dir });
    assert.equal(result.summary.gateB, 'HOLD');
  });
});
