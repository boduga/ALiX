/**
 * gate-e-qualification-record.test.mjs — pins the Gate E qualification contract.
 *
 * Gate E has never had a record to check, so the failure modes worth pinning are
 * the ones that would let a record *look* complete:
 *   - four of five clauses recorded, read as "nearly done"
 *   - a test file counted as a qualified control
 *   - a clause with no negative case, i.e. a positive assertion standing in for
 *     the regression the control exists to prevent
 *   - declared gaps quietly omitted rather than declared
 *   - author-only coverage labelled as qualification, dropping "independently"
 *
 * The last one is the whole gate. `QUALIFIED-AUTHOR-ONLY` exists so the honest
 * ceiling has a name and cannot be rounded up.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  COMPONENT_STATES,
  GATE_E_CLAUSES,
  GATE_E_OUTCOMES,
  INDEPENDENCE_CLASSES,
  PATH_BASES,
  renderGateEReport,
  validateGateERecord,
} from './gate-e-qualification-record.mjs';

const COMMIT = 'a'.repeat(40);

/** Every clause, qualified, with a negative case and one real evidence file. */
function components() {
  return GATE_E_CLAUSES.map(clause => ({
    clause,
    question: `Does ${clause} hold?`,
    observed: 'qualified',
    negativeCase: `removing ${clause} fails the test`,
    evidence: ['evidence.test.ts'],
  }));
}

function baseRecord(overrides = {}) {
  return {
    artifact: { commit: COMMIT, branch: 'main' },
    observedAt: '2026-10-24T00:00:00.000Z',
    pathBase: 'record',
    runs: [{
      runner: 'node --test',
      command: 'node --test dist/tests/evidence.test.js',
      files: ['evidence.test.ts'], tests: 10, passed: 10, failed: 0,
    }],
    components: components(),
    declaredGaps: [],
    independence: { class: 'author-only', note: 'tests authored with the code' },
    ...overrides,
  };
}

/** Create the temp dir holding every path the record cites. */
function withFixtures(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-e-'));
  try {
    writeFileSync(join(dir, 'evidence.test.ts'), '// evidence\n');
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a complete author-side record qualifies at the author-only label', () => {
  withFixtures(dir => {
    const result = validateGateERecord(baseRecord(), { baseDir: dir });
    assert.deepEqual(result.problems, []);
    assert.equal(result.ok, true);
    assert.equal(result.outcome, GATE_E_OUTCOMES.authorOnly);
    assert.equal(result.summary.qualified, GATE_E_CLAUSES.length);
    assert.equal(result.summary.independence, 'author-only');
    const text = renderGateEReport(result);
    assert.ok(/author-side qualification only/.test(text));
    assert.ok(/does not clear Gate E/.test(text));
  });
});

test('four of five clauses is a HOLD, not 80 percent', () => {
  withFixtures(dir => {
    const result = validateGateERecord(baseRecord({ components: components().slice(0, 4) }), { baseDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, GATE_E_OUTCOMES.hold);
    assert.ok(result.problems.some(p => /denied-action negatives has no entry/.test(p)));
  });
});

test('a near-miss clause name is rejected rather than silently accepted', () => {
  withFixtures(dir => {
    const comps = components();
    comps[4] = { ...comps[4], clause: 'denied action' };
    const result = validateGateERecord(baseRecord({ components: comps }), { baseDir: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /unknown Gate E clause/.test(p)));
  });
});

test('a clause without a negative case is rejected', () => {
  withFixtures(dir => {
    const comps = components();
    delete comps[0].negativeCase;
    const result = validateGateERecord(baseRecord({ components: comps }), { baseDir: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /does not state its negative case/.test(p)));
    assert.equal(result.outcome, GATE_E_OUTCOMES.hold);
  });
});

test('a partial clause blocks qualification even with the other four qualified', () => {
  withFixtures(dir => {
    const comps = components();
    comps[2].observed = 'partial';
    const result = validateGateERecord(baseRecord({ components: comps }), { baseDir: dir });
    assert.equal(result.ok, true);
    assert.equal(result.summary.partial, 1);
    assert.equal(result.outcome, GATE_E_OUTCOMES.hold);
  });
});

test('a failing suite cannot be qualified', () => {
  withFixtures(dir => {
    const result = validateGateERecord(
      baseRecord({ runs: [{ runner: 'node --test', command: 'node --test dist/tests/evidence.test.js', files: ['evidence.test.ts'], tests: 10, passed: 9, failed: 1 }] }),
      { baseDir: dir },
    );
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /cannot be built on a failing suite/.test(p)));
  });
});

test('a run whose counts do not add up is rejected', () => {
  withFixtures(dir => {
    const result = validateGateERecord(
      baseRecord({ runs: [{ runner: 'node --test', command: 'node --test dist/tests/evidence.test.js', files: ['evidence.test.ts'], tests: 10, passed: 7, failed: 0 }] }),
      { baseDir: dir },
    );
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /does not equal tests/.test(p)));
  });
});

test('a record with no runs describes intent, not a qualification', () => {
  withFixtures(dir => {
    const result = validateGateERecord(baseRecord({ runs: [] }), { baseDir: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /must record what was executed/.test(p)));
  });
});

test('cited evidence that does not exist is not evidence', () => {
  withFixtures(dir => {
    const comps = components();
    comps[0].evidence = ['missing.md'];
    const result = validateGateERecord(baseRecord({ components: comps }), { baseDir: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /cites a path that does not exist/.test(p)));
  });
});

test('an undeclared path base is rejected rather than guessed', () => {
  withFixtures(dir => {
    const record = baseRecord();
    delete record.pathBase;
    const result = validateGateERecord(record, { baseDir: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /pathBase must be one of/.test(p)));
  });
});

test('repo-root citations resolve from the repository root', () => {
  // A real tracked file, so repo-root resolution is exercised for real.
  const result = validateGateERecord(
    baseRecord({
      pathBase: 'repo-root',
      runs: [{
        runner: 'node --test',
        command: 'node --test dist/tests/executor.test.js',
        files: ['tests/executor.test.ts'], tests: 1, passed: 1, failed: 0,
      }],
      components: components().map(c => ({ ...c, evidence: ['tests/executor.test.ts'] })),
    }),
    { baseDir: '/nonexistent-base-should-be-ignored' },
  );
  assert.deepEqual(result.problems, []);
});

test('declaredGaps must be present, though it may be empty', () => {
  withFixtures(dir => {
    const record = baseRecord();
    delete record.declaredGaps;
    const result = validateGateERecord(record, { baseDir: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /must be present \(may be empty\)/.test(p)));
  });
});

test('declared gaps are preserved in the report and never counted as covered', () => {
  withFixtures(dir => {
    const result = validateGateERecord(
      baseRecord({ declaredGaps: [{ id: 'F-04', gap: 'hard-conflict rejection not demonstrated' }] }),
      { baseDir: dir },
    );
    assert.equal(result.ok, true);
    assert.equal(result.summary.declaredGaps, 1);
    assert.ok(result.notes.some(n => /gaps preserved, NOT covered: F-04/.test(n)));
    assert.equal(result.summary.qualified, GATE_E_CLAUSES.length);
  });
});

test('model-independent review is labelled distinctly from independent', () => {
  withFixtures(dir => {
    writeFileSync(join(dir, 'review.md'), 'Reviewer: Codex / gpt-6.1-sol\n');
    const result = validateGateERecord(
      baseRecord({
        independence: {
          class: 'model-independent',
          note: 'reviewed by a different model family',
          qualifier: { ref: 'review.md', identity: 'Codex / gpt-6.1-sol', reviewedAt: '2026-10-25T00:00:00.000Z' },
        },
      }),
      { baseDir: dir },
    );
    assert.equal(result.outcome, GATE_E_OUTCOMES.independent);
    // The label is the ceiling, and "independent" is not among the classes a
    // record may declare for itself.
    assert.ok(!INDEPENDENCE_CLASSES.includes('independent'));
  });
});

test('independence is a required axis, not an optional comment', () => {
  withFixtures(dir => {
    const record = baseRecord();
    delete record.independence;
    const result = validateGateERecord(record, { baseDir: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /independence is required/.test(p)));
    assert.equal(result.outcome, GATE_E_OUTCOMES.hold);
  });
});

test('an unknown independence class is rejected', () => {
  withFixtures(dir => {
    const result = validateGateERecord(
      baseRecord({ independence: { class: 'independent', note: 'trust me' } }),
      { baseDir: dir },
    );
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /independence.class must be one of/.test(p)));
  });
});

test('an abbreviated commit cannot pin a qualification', () => {
  withFixtures(dir => {
    const result = validateGateERecord(baseRecord({ artifact: { commit: COMMIT.slice(0, 8) } }), { baseDir: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /full 40-character commit sha/.test(p)));
  });
});

test('the vocabularies are frozen and contain no "independent" shortcut', () => {
  assert.deepEqual(GATE_E_CLAUSES, ['F8b', 'authority', 'crash/recovery', 'ownership', 'denied-action negatives']);
  assert.deepEqual(COMPONENT_STATES, ['qualified', 'partial', 'unqualified']);
  assert.deepEqual(PATH_BASES, ['record', 'repo-root']);
  assert.deepEqual(Object.values(GATE_E_OUTCOMES), [
    'QUALIFIED-INDEPENDENT',
    'QUALIFIED-AUTHOR-ONLY',
    'HOLD',
  ]);
  // A record may not declare bare "independent": the class is either author-only
  // or a named weaker form.
  assert.ok(!INDEPENDENCE_CLASSES.includes('independent'));
});

/**
 * Regressions from the independent Gate E review (2026-10-25, Codex/gpt-6.1-sol).
 *
 * Both defects were found by probe, not by reading: D9 forged the strongest
 * label by typing it, and D10 read a HOLD as a pass via exit code. A validator
 * whose output can be manufactured is not a check.
 */

test('D9: independence cannot be declared from free text alone', () => {
  withFixtures(dir => {
    const result = validateGateERecord(
      baseRecord({ independence: { class: 'declared-independent', note: 'trust me' } }),
      { baseDir: dir },
    );
    assert.equal(result.ok, false);
    assert.equal(result.outcome, GATE_E_OUTCOMES.hold);
    assert.ok(result.problems.some(p => /requires independence\.qualifier/.test(p)));
  });
});

test('D9: a qualifier citation that does not exist is rejected', () => {
  withFixtures(dir => {
    const result = validateGateERecord(
      baseRecord({
        independence: {
          class: 'model-independent',
          note: 'reviewed by another model',
          qualifier: { ref: 'missing-review.md', identity: 'Codex', reviewedAt: '2026-10-25T00:00:00.000Z' },
        },
      }),
      { baseDir: dir },
    );
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /qualifier\.ref does not exist/.test(p)));
  });
});

test('D9: a qualifier artifact that does not name the qualifier is rejected', () => {
  withFixtures(dir => {
    writeFileSync(join(dir, 'review.md'), '# review\n\nno attribution\n');
    const result = validateGateERecord(
      baseRecord({
        independence: {
          class: 'model-independent',
          note: 'reviewed by another model',
          qualifier: { ref: 'review.md', identity: 'Codex / gpt-6.1-sol', reviewedAt: '2026-10-25T00:00:00.000Z' },
        },
      }),
      { baseDir: dir },
    );
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /does not contain the named qualifier/.test(p)));
  });
});

test('D9: a cited, named qualifier is accepted', () => {
  withFixtures(dir => {
    writeFileSync(join(dir, 'review.md'), '# review\n\nReviewer: Codex / gpt-6.1-sol\nVERDICT: ...\n');
    const result = validateGateERecord(
      baseRecord({
        independence: {
          class: 'model-independent',
          note: 'reviewed by another model family',
          qualifier: { ref: 'review.md', identity: 'Codex / gpt-6.1-sol', reviewedAt: '2026-10-25T00:00:00.000Z' },
        },
      }),
      { baseDir: dir },
    );
    assert.deepEqual(result.problems, []);
    assert.equal(result.outcome, GATE_E_OUTCOMES.independent);
  });
});

test('D10: a valid record that still HOLDs is not a pass', () => {
  withFixtures(dir => {
    const comps = components();
    comps[0].observed = 'partial';
    const result = validateGateERecord(baseRecord({ components: comps }), { baseDir: dir });
    // The record is well-formed...
    assert.equal(result.ok, true);
    // ...and still not cleared, which is the state that used to exit 0.
    assert.equal(result.outcome, GATE_E_OUTCOMES.hold);
  });
});

/**
 * Regressions from the standards/spec review (2026-10-25).
 *
 * D9 was reported fixed once and was not: the earlier hardening only covered the
 * free-text `note` path, so an all-zero commit with an imaginary runner still
 * reached QUALIFIED-INDEPENDENT. These pin the parts that actually gate.
 */

test('D9: a fabricated run cannot qualify, even with a plausible shape', () => {
  withFixtures(dir => {
    const result = validateGateERecord(
      baseRecord({
        artifact: { commit: '0'.repeat(40) },
        runs: [{ runner: 'IMAGINARY-RUNNER', files: ['evidence.test.ts'], tests: 999, passed: 999, failed: 0 }],
      }),
      { baseDir: dir },
    );
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /command is required/.test(p)));
    assert.equal(result.outcome, GATE_E_OUTCOMES.hold);
  });
});

test('D9: the command must actually reference the files it claims ran', () => {
  withFixtures(dir => {
    const result = validateGateERecord(
      baseRecord({
        runs: [{
          runner: 'node --test', command: 'node --test unrelated.test.ts',
          files: ['evidence.test.ts'], tests: 1, passed: 1, failed: 0,
        }],
      }),
      { baseDir: dir },
    );
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /does not reference/.test(p)));
  });
});

test('D9: a non-test file cannot stand as evidence for a control', () => {
  withFixtures(dir => {
    writeFileSync(join(dir, 'package.json'), '{}');
    const comps = components();
    comps[0].evidence = ['package.json'];
    const result = validateGateERecord(baseRecord({ components: comps }), { baseDir: dir });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => /cannot assert a control/.test(p)));
  });
});

test('D9: a compiled dist path satisfies the command check for a source file', () => {
  withFixtures(dir => {
    const result = validateGateERecord(
      baseRecord({
        runs: [{
          runner: 'node --test',
          command: 'node --test dist/tests/evidence.test.js',
          files: ['evidence.test.ts'], tests: 1, passed: 1, failed: 0,
        }],
      }),
      { baseDir: dir },
    );
    assert.ok(!result.problems.some(p => /does not reference/.test(p)));
  });
});

test('D10: the CLI reports failure for every HOLD, not just for invalid input', async () => {
  // The reviewer noted D10's fix was never verified at the process level: the
  // suite asserted `outcome`, never an exit code. Drive the real CLI.
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'gate-e-cli-'));
  try {
    const record = baseRecord();
    // A well-formed record with one partial clause -> valid, but HOLD.
    record.components[0] = { ...record.components[0], observed: 'partial' };
    const path = join(dir, 'record.json');
    writeFileSync(path, JSON.stringify(record));
    writeFileSync(join(dir, 'evidence.test.ts'), '// evidence\n');
    writeFileSync(join(dir, 'evidence.md'), '# e\n');
    let code = 0;
    try {
      execFileSync(process.execPath, [
        'benchmark/evidence/gate-e-qualification-record.mjs', path,
      ], { stdio: 'ignore', cwd: process.cwd() });
    } catch (error) {
      code = error?.status ?? -1;
    }
    assert.equal(code, 1, 'a valid HOLD record must exit 1, never 0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
