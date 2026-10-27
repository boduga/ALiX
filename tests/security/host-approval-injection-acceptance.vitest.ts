/** LEAN-G01 regression acceptance for host approval-store injection. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function source(path: string): string { return readFileSync(resolve(root, path), 'utf8'); }

describe('LEAN-G01 host approval-store injection acceptance', () => {
  it('Inspector in-process worker receives the scheduler approval store', () => {
    const code = source('src/interfaces/server/coordination-routes.ts');
    expect(code).toMatch(/executor\s*=\s*new DefaultWorkerExecutor\(approvalStore\)/);
  });
  it('daemon coordination worker receives the scheduler approval store', () => {
    const code = source('src/operations/daemon/daemon-server.ts');
    expect(code).toMatch(/executor\s*=\s*new DefaultWorkerExecutor\(approvalStore\)/);
  });
});
