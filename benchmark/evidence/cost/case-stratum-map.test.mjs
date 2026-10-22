/**
 * Case → stratum attribution for the metered sweep.
 *
 * A cost record is only useful if it names a PRD stratum the coverage matrix
 * recognizes. Two failure modes are silent and were both live before this test:
 *
 *  1. an UNMAPPED case — the sweep runs, spends real tokens, and the matrix
 *     reports that stratum as unmeasured because nothing attributed the usage;
 *  2. a DRIFTED stratum id — the record names a stratum the matrix does not
 *     define, so it is silently dropped from the coverage count.
 *
 * Both are cheap to check and expensive to discover after paying for a run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASE_STRATUM } from './eval-case-sweep.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const matrixPath = join(here, '..', 'gate7', 'baseline-coverage-matrix.mjs');

/** Stratum ids the coverage matrix defines — read from the generator itself. */
function matrixStratumIds() {
  const source = readFileSync(matrixPath, 'utf8');
  const block = source.slice(source.indexOf('const STRATA = ['), source.indexOf('];', source.indexOf('const STRATA = [')));
  return new Set([...block.matchAll(/\{\s*id:\s*"([^"]+)"/g)].map(m => m[1]));
}

async function behavioralCaseIds() {
  const mod = await import('../../../dist/src/operations/evals/cases/index.js');
  return mod.BEHAVIORAL_CASES.map(c => c.id);
}

test('every case maps to a stratum the coverage matrix defines', () => {
  const valid = matrixStratumIds();
  assert.ok(valid.size >= 10, `expected the matrix to define >=10 strata, got ${valid.size}`);
  for (const [caseId, stratum] of Object.entries(CASE_STRATUM)) {
    assert.ok(valid.has(stratum), `${caseId} maps to unknown stratum "${stratum}"`);
  }
});

test('every behavioral case is mapped, and no map entry is stale', async () => {
  const caseIds = await behavioralCaseIds();
  const unmapped = caseIds.filter(id => !CASE_STRATUM[id]);
  assert.deepEqual(unmapped, [], 'unmapped cases would make a paid sweep unattributable');

  const stale = Object.keys(CASE_STRATUM).filter(id => !caseIds.includes(id));
  assert.deepEqual(stale, [], 'map entries for non-existent cases rot silently');
});

test('strata 6 and 8 are measured by coordination drivers, not behavioral cases', () => {
  // Guards against "add a behavioral case" being assumed to cover them.
  const claimed = new Set(Object.values(CASE_STRATUM));
  assert.ok(!claimed.has('coordination-ownership'));
  assert.ok(!claimed.has('crash-outcome-unknown'));
});
