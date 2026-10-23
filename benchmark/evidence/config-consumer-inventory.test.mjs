import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditConfigConsumers } from './config-consumer-inventory.mjs';

test('schema-bound aliases, computed names and destructuring stay visible; unrelated models stay separate', () => {
  const root = mkdtempSync(join(tmpdir(), 'alix-config-census-'));
  try {
    mkdirSync(join(root, 'src/operations/config'), { recursive: true });
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true }, include: ['src/**/*.ts'] }));
    writeFileSync(join(root, 'src/operations/config/schema.ts'), 'export type AlixConfig = { model: {name: string}; subagents?: {enabled: boolean; fast: {name: string}} };');
    writeFileSync(join(root, 'src/consumer.ts'), `import type { AlixConfig } from './operations/config/schema';
declare const config: AlixConfig;
const alias = config;
const value = alias.model;
const enabled = config['subagents'];
const {model: selected} = config;
const unrelated = {model: 'not-config'};
const other = unrelated.model;
declare const key: keyof AlixConfig;
const uncertain = alias[key];
declare const untyped: any;
const unresolved = untyped.model;
const [model] = ['unrelated'];
`);
    const report = auditConfigConsumers(root);
    const sourceRows = report.references.filter(row => row.file === 'src/consumer.ts');
    for (const line of [4, 5, 6]) assert.ok(sourceRows.some(row => row.line === line && row.classification === 'schema-bound-config-field'), `missing typed access on line ${line}`);
    assert.ok(sourceRows.some(row => row.line === 8 && row.classification === 'other-declared-field-review'));
    assert.ok(sourceRows.some(row => row.line === 10 && row.classification === 'dynamic-config-key-unresolved'));
    assert.ok(sourceRows.some(row => row.line === 12 && row.classification === 'unresolved-named-field-review'));
    assert.ok(!sourceRows.some(row => row.line === 13), 'array binding names are not config properties');
    assert.match(report.sourceDigestSha256, /^[a-f0-9]{64}$/);
    assert.equal(report.sourceCommit, null);
    const again = auditConfigConsumers(root);
    assert.deepEqual(again, report);
    writeFileSync(join(root, 'src/extra.ts'), 'export const changed = 1;');
    assert.notEqual(auditConfigConsumers(root).sourceDigestSha256, report.sourceDigestSha256);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
