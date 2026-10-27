/** D6/D8: legacy non-worker compatibility and fail-closed persisted worker approvals. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { createWorkerApprovalPort } from '../../src/governance/approvals/worker-approval-port.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';
const dirs: string[] = [];
afterEach(async () => { closeAllSharedLedgers(); for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'alix-d6-d8-')); dirs.push(cwd);
  const store = new ApprovalStore(cwd); await store.load();
  return { cwd, store };
}
describe('D6/D8 persisted approval compatibility', () => {
  it('legacy non-worker approval remains single-use after reload', async () => {
    const { cwd, store } = await fixture();
    const created = await store.requestOrReusePending({ reason: 'legacy', bindingKey: 'legacy-key', requestFingerprint: 'legacy', policyRevision: 'rev', capabilities: ['file.read'], sessionId: 'legacy-session' });
    await store.resolve(created.id, 'approved', 'operator');
    const reloaded = new ApprovalStore(cwd); await reloaded.load();
    const port = createWorkerApprovalPort(reloaded);
    expect(port.get(created.id)?.status).toBe('approved');
    expect((await port.consumeApproved(created.id, 'legacy-key', {})).consumed).toBe(true);
    expect((await port.consumeApproved(created.id, 'legacy-key', {})).consumed).toBe(false);
  });
  it('persisted worker-bound approval rejects absent worker identity after reload', async () => {
    const { cwd, store } = await fixture();
    const created = await store.requestOrReusePending({ reason: 'old worker', bindingKey: 'worker-key', requestFingerprint: 'old', policyRevision: 'rev', capabilities: ['file.create'], coordinationRunId: 'run', workerId: 'worker-a', workerAttempt: 0 });
    await store.resolve(created.id, 'approved', 'operator');
    const reloaded = new ApprovalStore(cwd); await reloaded.load();
    expect((await reloaded.consumeApproved(created.id, 'worker-key', {})).consumed).toBe(false);
    expect((await reloaded.consumeApproved(created.id, 'worker-key', { workerId: 'worker-a' })).consumed).toBe(false);
    expect((await reloaded.loadFresh(created.id))?.status).toBe('approved');
    expect(createWorkerApprovalPort(reloaded).get(created.id)).toBeUndefined();
  });
  it('invocation-bound approval cannot be consumed after restart without its invocation', async () => {
    const { cwd, store } = await fixture();
    const invocation = { capability: 'file.create', toolName: 'file.create', workspace: cwd, argsHash: 'hash', sessionId: 's', agentId: 'worker-a' };
    const created = await store.requestOrReusePending({ reason: 'invocation', bindingKey: 'inv-key', requestFingerprint: 'inv', policyRevision: 'rev', capabilities: ['file.create'], workerId: 'worker-a', workerAttempt: 1, coordinationRunId: 'run', invocation });
    await store.resolve(created.id, 'approved', 'operator');
    const reloaded = new ApprovalStore(cwd); await reloaded.load();
    const consumer = { workerId: 'worker-a', workerAttempt: 1 };
    expect((await reloaded.consumeApproved(created.id, 'inv-key', consumer)).consumed).toBe(false);
    expect((await reloaded.consumeApproved(created.id, 'inv-key', consumer, { ...invocation, argsHash: 'changed' })).consumed).toBe(false);
    expect((await reloaded.loadFresh(created.id))?.status).toBe('approved');
    expect((await reloaded.consumeApproved(created.id, 'inv-key', consumer, invocation)).consumed).toBe(true);
  });
});
