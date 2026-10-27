/** D7: real process restart and concurrent store authorization acceptance. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

const exec = promisify(execFile);
const storeUrl = new URL('../../src/governance/approvals/approval-store.js', import.meta.url).href;
const portUrl = new URL('../../src/governance/approvals/worker-approval-port.js', import.meta.url).href;
const ledgerUrl = new URL('../../src/runtime-state/storage/runtime-ledger.js', import.meta.url).href;
for (const method of ['report', 'unverified']) {
  test(`D7 ${method}: fresh processes enforce persisted ownership under contention`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'alix-d7-process-'));
    try {
      const store = new ApprovalStore(cwd); await store.load();
      const record = await store.requestOrReusePending({
        reason: 'restart acceptance', bindingKey: 'key', requestFingerprint: 'fp',
        policyRevision: 'rev', capabilities: ['file.write'], workerId: 'worker-a',
      });
      await store.resolve(record.id, 'approved');
      assert.equal((await store.consumeApproved(record.id, 'key', { workerId: 'worker-a' })).consumed, true);
      closeAllSharedLedgers();
      const child = async (workerId: string) => {
        const receipt = join(cwd, `receipt-${randomUUID()}.json`);
        const code = `
          import { writeFile } from 'node:fs/promises';
          import { ApprovalStore } from ${JSON.stringify(storeUrl)};
          import { createWorkerApprovalPort } from ${JSON.stringify(portUrl)};
          import { closeAllSharedLedgers } from ${JSON.stringify(ledgerUrl)};
          const store = new ApprovalStore(process.argv[1]); await store.load();
          const port = createWorkerApprovalPort(store, { workerId: process.argv[3] || undefined });
          const result = process.argv[4] === 'report'
            ? await port.recordExecutionOutcome(process.argv[2], 'failed')
            : await port.markExecutionUnverified(process.argv[2]);
          await writeFile(process.argv[5], JSON.stringify(result)); closeAllSharedLedgers();
        `;
        await exec(process.execPath, ['--input-type=module', '-e', code, cwd, record.id, workerId, method, receipt]);
        return JSON.parse(await readFile(receipt, 'utf8'));
      };
      assert.deepEqual(await Promise.all([child('worker-b'), child(''), child('worker-b'), child('')]),
        Array(4).fill(method === 'report' ? false : 'missing'));
      const restarted = new ApprovalStore(cwd); await restarted.load();
      assert.equal(restarted.get(record.id)?.status, 'consumed');
      assert.equal(restarted.get(record.id)?.executionOutcome, 'pending');
      assert.equal(await child('worker-a'), method === 'report' ? true : 'unverified');
      await restarted.load();
      assert.equal(restarted.get(record.id)?.executionOutcome, method === 'report' ? 'failed' : 'unverified');
    } finally {
      closeAllSharedLedgers();
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
