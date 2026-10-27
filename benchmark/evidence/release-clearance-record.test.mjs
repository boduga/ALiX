/**
 * release-clearance-record.test.mjs — pins the Q13 / Gate F release contract.
 *
 * PRD-R082 does not describe Q13 as a checklist; it describes it as negative
 * tests: "reject release on missing/expired clearance, absent maintainer
 * approval, mismatched artifact, or technical FAIL". The first five tests below
 * are exactly those four plus the PASS case, in that order. The rest cover the
 * ways a record can *look* cleared — a model in the maintainer field, an
 * approval that predates the clearance it depends on, a maintainer clearing
 * their own restriction, a citation pointing at nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLEARANCE_KINDS,
  RELEASE_OUTCOMES,
  TECHNICAL_VERDICTS,
  normalizeIdentity,
  renderReleaseReport,
  validateReleaseClearanceRecord,
} from './release-clearance-record.mjs';

const COMMIT = 'a'.repeat(40);
const SHA = 'b'.repeat(64);
const OTHER_COMMIT = 'c'.repeat(40);
const APPROVER = 'Babasola <boduga@gmail.com>';
const AUTHORITY = 'Independent Security Review Board <board@example.org>';

function baseRecord(overrides = {}) {
  return {
    artifact: { commit: COMMIT, version: '2.0.0', sha256: SHA },
    technical: {
      verdict: 'pass',
      commit: COMMIT,
      qualifiedAt: '2026-10-24T00:00:00.000Z',
      evidence: ['technical.md'],
    },
    clearance: {
      kind: 'restriction-cleared',
      authority: AUTHORITY,
      process: 'designated publication review',
      scope: 'release 2.0.0',
      grantedAt: '2026-10-24T01:00:00.000Z',
      expiresAt: null,
      evidence: ['clearance.md'],
    },
    approval: {
      signerClass: 'operator',
      identity: APPROVER,
      approvedAt: '2026-10-24T02:00:00.000Z',
      commit: COMMIT,
      sha256: SHA,
      scope: 'release 2.0.0',
      evidence: ['approval.md'],
    },
    ...overrides,
  };
}

/** Build a directory holding the three cited artifacts, then run the assertion. */
function withFixtures(fn, { approvalBody = `| Maintainer | ${APPROVER} |\n` } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'release-clearance-'));
  try {
    writeFileSync(join(dir, 'technical.md'), '# technical qualification\n');
    writeFileSync(join(dir, 'clearance.md'), '# clearance\n');
    writeFileSync(join(dir, 'approval.md'), approvalBody);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── PRD-R082's negative tests, then the positive case ─────────────

test('a fully cleared record bound to one artifact authorizes release', () => {
  withFixtures(dir => {
    const result = validateReleaseClearanceRecord(baseRecord(), { baseDir: dir });
    assert.deepEqual(result.problems, []);
    assert.equal(result.ok, true);
    assert.equal(result.outcome, RELEASE_OUTCOMES.authorized);
    assert.equal(result.summary.independentClearance, true);
    assert.equal(result.summary.approverClass, 'operator');
  });
});

test('release is rejected when security clearance is missing', () => {
  withFixtures(dir => {
    const result = validateReleaseClearanceRecord(baseRecord({ clearance: null }), { baseDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, RELEASE_OUTCOMES.hold);
    assert.ok(result.problems.some(p => /clearance is MISSING/.test(p)));
  });
});

test('release is rejected when clearance has expired', () => {
  withFixtures(dir => {
    const record = baseRecord();
    record.clearance.expiresAt = '2026-10-24T01:30:00.000Z';
    const result = validateReleaseClearanceRecord(record, { baseDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, RELEASE_OUTCOMES.hold);
    assert.ok(result.problems.some(p => /EXPIRED/.test(p)));
  });
});

test('release is rejected when maintainer approval is absent', () => {
  withFixtures(dir => {
    const result = validateReleaseClearanceRecord(baseRecord({ approval: null }), { baseDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, RELEASE_OUTCOMES.hold);
    assert.ok(result.problems.some(p => /approval is ABSENT/.test(p)));
  });
});

test('release is rejected when the decision is bound to a different artifact', () => {
  withFixtures(dir => {
    const record = baseRecord();
    record.approval.commit = OTHER_COMMIT;
    const result = validateReleaseClearanceRecord(record, { baseDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, RELEASE_OUTCOMES.hold);
    assert.ok(result.problems.some(p => /different artifact/.test(p)));
  });
});

test('release is rejected on technical FAIL, even with clearance and approval', () => {
  withFixtures(dir => {
    const record = baseRecord();
    record.technical.verdict = 'fail';
    const result = validateReleaseClearanceRecord(record, { baseDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, RELEASE_OUTCOMES.hold);
    assert.ok(result.problems.some(p => /FAILED/.test(p)));
  });
});

test('a partial technical qualification is not a technical PASS', () => {
  withFixtures(dir => {
    const record = baseRecord();
    record.technical.verdict = 'partial';
    const result = validateReleaseClearanceRecord(record, { baseDir: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /PARTIAL/.test(p)));
  });
});

// ── Authority rules ───────────────────────────────────────────────

test('a model identity cannot stand in the maintainer field', () => {
  withFixtures(dir => {
    const record = baseRecord();
    record.approval.identity = 'Codex / gpt-6.1-sol';
    record.approval.signerClass = 'model';
    const result = validateReleaseClearanceRecord(record, { baseDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, RELEASE_OUTCOMES.hold);
    assert.ok(result.problems.some(p => /MODEL cannot supply maintainer approval/.test(p)));
  });
});

test('a maintainer clearing their own restriction is not independent clearance', () => {
  withFixtures(dir => {
    const record = baseRecord();
    record.clearance.authority = APPROVER;
    const result = validateReleaseClearanceRecord(record, { baseDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, RELEASE_OUTCOMES.hold);
    assert.ok(result.problems.some(p => /SAME PARTY/.test(p)));
  });
});

test('approval written before the clearance it depends on is rejected', () => {
  withFixtures(dir => {
    const record = baseRecord();
    record.approval.approvedAt = '2026-10-24T00:30:00.000Z';
    const result = validateReleaseClearanceRecord(record, { baseDir: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /PREDATES clearance/.test(p)));
  });
});

test('Gate F refuses a waiver, unlike a Gate B measurement waiver', () => {
  withFixtures(dir => {
    const result = validateReleaseClearanceRecord(
      baseRecord({ waiver: { ref: 'waiver.md', signedBy: APPROVER } }),
      { baseDir: dir },
    );
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /no waiver path/.test(p)));
  });
});

// ── Artifact and evidence binding ─────────────────────────────────

test('an abbreviated commit cannot bind a release decision', () => {
  withFixtures(dir => {
    const record = baseRecord();
    record.artifact.commit = COMMIT.slice(0, 8);
    const result = validateReleaseClearanceRecord(record, { baseDir: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /full 40-character commit sha/.test(p)));
  });
});

test('technical qualification bound to another commit is rejected', () => {
  withFixtures(dir => {
    const record = baseRecord();
    record.technical.commit = OTHER_COMMIT;
    const result = validateReleaseClearanceRecord(record, { baseDir: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /different artifact/.test(p)));
  });
});

test('a citation to a file that does not exist is not evidence', () => {
  withFixtures(dir => {
    const record = baseRecord();
    record.clearance.evidence = ['missing-clearance.md'];
    const result = validateReleaseClearanceRecord(record, { baseDir: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /does not exist/.test(p)));
  });
});

test('an approval artifact that does not name the signer is rejected', () => {
  withFixtures(
    dir => {
      const result = validateReleaseClearanceRecord(baseRecord(), { baseDir: dir });
      assert.equal(result.ok, false);
      assert.ok(result.problems.some(p => /does not contain the named signer/.test(p)));
    },
    { approvalBody: '# release approval\n\nsignature: ______\n' },
  );
});

// ── The weaker, labelled outcome ──────────────────────────────────

test('no applicable restriction is a scope decision, labelled, not independent clearance', () => {
  withFixtures(dir => {
    const record = baseRecord();
    record.clearance.kind = 'no-restriction-applicable';
    record.clearance.authority = APPROVER;
    const result = validateReleaseClearanceRecord(record, { baseDir: dir });
    assert.deepEqual(result.problems, []);
    assert.equal(result.outcome, RELEASE_OUTCOMES.scopeDecision);
    assert.equal(result.summary.independentClearance, false);
    const text = renderReleaseReport(result);
    assert.ok(/MAINTAINER SCOPE DECISION/.test(text));
    assert.ok(/not independent clearance/.test(text));
  });
});

test('the vocabulary is exported so callers cannot invent a fourth outcome', () => {
  assert.deepEqual(Object.values(RELEASE_OUTCOMES), [
    'RELEASE-AUTHORIZED',
    'RELEASE-AUTHORIZED-SCOPE-DECISION',
    'HOLD',
  ]);
  assert.ok(!Object.values(RELEASE_OUTCOMES).includes('CLOSED-WITH-WAIVER'));
  assert.deepEqual(TECHNICAL_VERDICTS, ['pass', 'partial', 'fail']);
  assert.deepEqual(CLEARANCE_KINDS, ['restriction-cleared', 'no-restriction-applicable']);
});

test('identity normalization makes case and spacing non-distinctions', () => {
  assert.equal(normalizeIdentity('  Babasola   <BODUGA@gmail.com> '), 'babasola <boduga@gmail.com>');
});
