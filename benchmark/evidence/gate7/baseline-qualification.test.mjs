import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('recorded coverage cannot authorize ablations or accept the baseline', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./baseline-coverage-matrix.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  // This exercises the high-coverage fixture that previously produced a false
  // readiness verdict; cost/coverage arithmetic remains visible to the reader.
  assert.match(result.stdout, /9\/10 strata/);
  assert.match(result.stdout, /Recorded artifact coverage only/);
  assert.match(result.stdout, /Gate B remains HOLD/);
  assert.match(result.stdout, /ablations require separate authorization/);
  assert.doesNotMatch(result.stdout, /Harness is ready for ablation comparisons/);
});
