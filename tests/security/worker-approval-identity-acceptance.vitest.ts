/** LEAN-G01 security regression acceptance for worker identity. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { createWorkerApprovalPort } from '../../src/governance/approvals/worker-approval-port.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

const dirs: string[] = [];
afterEach(async () => {
  closeAllSharedLedgers();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'alix-lean-g01-identity-accept-'));
  dirs.push(cwd);
  const store = new ApprovalStore(cwd);
  await store.load();
  const request = {
    reason: 'identity acceptance', capability: 'shell.exec',
    bindingKey: 'identity-binding', requestFingerprint: 'shell.exec',
    policyRevision: 'rev-1', capabilities: ['shell.exec'],
    coordinationRunId: 'run-1', workerId: 'worker-a', workerAttempt: 0, sessionId: 's1',
  };
  const created = await store.requestOrReusePending(request);
  await store.resolve(created.id, 'approved', 'operator');
  return { store, created, request };
}

describe('LEAN-G01 worker-bound approval acceptance', () => {
  it('rejects missing consumer identity and preserves approved state', async () => {
    const { store, created, request } = await fixture();
    expect((await store.consumeApproved(created.id, request.bindingKey, {})).consumed).toBe(false);
    expect((await store.loadFresh(created.id))?.status).toBe('approved');
  });
  it('rejects cross-worker consumption through worker-bound port', async () => {
    const { store, created, request } = await fixture();
    const workerB = createWorkerApprovalPort(store, { workerId: 'worker-b' });
    expect((await workerB.consumeApproved(created.id, request.bindingKey, {})).consumed).toBe(false);
    expect((await store.loadFresh(created.id))?.status).toBe('approved');
  });
  it('never attributes worker B port requests to worker A', async () => {
    const { store } = await fixture();
    const workerB = createWorkerApprovalPort(store, { workerId: 'worker-b' });
    expect(() => workerB.requestOrReusePending({
      reason: 'cross-worker request',
      bindingKey: 'other-binding', requestFingerprint: 'other', policyRevision: 'rev-1',
      capabilities: ['shell.exec'], workerId: 'worker-a', coordinationRunId: 'run-1',
    })).toThrow(/identity mismatch/);
  });
  it('still rejects explicitly mismatched worker identity', async () => {
    const { store, created, request } = await fixture();
    expect((await store.consumeApproved(created.id, request.bindingKey, { workerId: 'worker-b' })).consumed).toBe(false);
  });
});
