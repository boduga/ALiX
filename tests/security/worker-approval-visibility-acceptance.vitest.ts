import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { createWorkerApprovalPort } from '../../src/governance/approvals/worker-approval-port.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';
const dirs: string[] = [];
afterEach(async () => { closeAllSharedLedgers(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe('D7 worker approval visibility acceptance', () => {
  it('hides worker A metadata and prevents worker B unverified mutation through all lookup surfaces', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'alix-d7-')); dirs.push(cwd);
    const store = new ApprovalStore(cwd); await store.load();
    const a = createWorkerApprovalPort(store, { workerId: 'worker-a' });
    const b = createWorkerApprovalPort(store, { workerId: 'worker-b' });
    const unbound = createWorkerApprovalPort(store);
    const record = await a.requestOrReusePending({ reason: 'scoped', bindingKey: 'd7-binding', requestFingerprint: 'd7-request', policyRevision: 'rev', capabilities: ['shell.exec'], workerId: 'worker-a', workerAttempt: 0, coordinationRunId: 'run-1', sessionId: 's1' });
    expect(a.get(record.id)?.id).toBe(record.id);
    expect(a.findExact('d7-binding')?.id).toBe(record.id);
    for (const port of [b, unbound]) {
      expect(port.get(record.id)).toBeUndefined();
      expect(await port.loadFresh(record.id)).toBeUndefined();
      expect(port.findExact('d7-binding')).toBeUndefined();
      expect(port.findPendingByBindingKey('d7-binding')).toBeUndefined();
      expect(port.findPending({ capability: 'shell.exec' })).toBeUndefined();
      expect(port.findByRequestId('d7-request')).toBeUndefined();
      expect(await port.markExecutionUnverified?.(record.id)).toBe('missing');
    }
    expect((await store.loadFresh(record.id))?.status).toBe('pending');
  });
});
