/** D9 regression: daemon must wire approved tool continuations to an execution host. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('D9 daemon tool continuation integration', () => {
  it('production daemon invokes the continuation manager for approved tool requests', () => {
    const daemon = source('src/operations/daemon/daemon-server.ts');
    const watcher = source('src/operations/daemon/approval-watcher.ts');
    expect(daemon + watcher).toMatch(/resumeApproved\s*\(/);
  });
});
