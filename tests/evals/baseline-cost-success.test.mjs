import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const shape of ['single', 'perStratum']) {
  for (const count of [undefined, null, 0, -1, 0.5, '1', 1]) {
    test(`${shape} cost qualification requires a positive integer success count: ${String(count)}`, () => {
      const cwd = mkdtempSync(join(tmpdir(), 'alix-cost-qualification-'));
      try {
        const entry = { costUsd: 0.1, ...(count !== undefined ? { verifiedSuccesses: count } : {}) };
        const record = shape === 'single'
          ? { stratum: 'readonly-inspection', completeness: 'complete', ...entry }
          : { completeness: 'complete', perStratum: { 'readonly-inspection': entry } };
        const evidencePath = join(cwd, 'cost.json');
        writeFileSync(evidencePath, JSON.stringify(record));
        const result = spawnSync(process.execPath, [
          resolve('benchmark/evidence/gate7/baseline-coverage-matrix.mjs'),
          resolve('benchmark/evidence/gate7'),
          resolve('benchmark/evidence/eval-runs/deterministic-14of14.json'), evidencePath,
        ], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        const row = result.stdout.split('\n').find(line => line.startsWith('| 1 |'));
        assert.ok(row);
        assert.equal(row.includes('$0.100000 (complete)'), count === 1, row);
        if (count !== 1) assert.match(row, /cost-per-success undefined/);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });
  }
}

for (const completeness of [undefined, null, 'partial']) {
  for (const shape of ['single', 'perStratum']) {
    test(`${shape} incomplete/missing completeness cannot qualify: ${String(completeness)}`, () => {
      const cwd = mkdtempSync(join(tmpdir(), 'alix-cost-complete-'));
      try {
        const entry = { costUsd: 0.1, verifiedSuccesses: 1 };
        const record = shape === 'single' ? { stratum: 'readonly-inspection', ...entry }
          : { perStratum: { 'readonly-inspection': entry } };
        if (completeness !== undefined) record.completeness = completeness;
        const path = join(cwd, 'cost.json'); writeFileSync(path, JSON.stringify(record));
        const result = spawnSync(process.execPath, [resolve('benchmark/evidence/gate7/baseline-coverage-matrix.mjs'),
          resolve('benchmark/evidence/gate7'), resolve('benchmark/evidence/eval-runs/deterministic-14of14.json'), path], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(result.stdout.split('\n').find(line => line.startsWith('| 1 |')), /\$0\.100000 \(complete\)/);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });
  }
}
