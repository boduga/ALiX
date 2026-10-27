/** LEAN-G01 prospective acceptance: identity/attempt/invocation, no tool effects. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

const dirs: string[] = [];
afterEach(async () => {
  closeAllSharedLedgers();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'alix-lean-invocation-'));
  dirs.push(cwd);
  const store = new ApprovalStore(cwd);
  await store.load();
  const invocation = { capability: 'file.create', toolName: 'file.create', workspace: cwd, argsHash: 'approved-args', sessionId: 's1', agentId: 'worker-a' };
  const request = { reason: 'invocation acceptance', capability: 'file.create', bindingKey: 'binding-1', requestFingerprint: 'request-1', policyRevision: 'rev-1', capabilities: ['file.create'], coordinationRunId: 'run-1', workerId: 'worker-a', workerAttempt: 2, sessionId: 's1', invocation };
  const approval = await store.requestOrReusePending(request);
  await store.resolve(approval.id, 'approved', 'operator');
  return { store, approval, request, invocation };
}

describe('LEAN-G01 worker attempt and invocation acceptance (prospective)', () => {
  it('rejects a different execution attempt without consuming approval', async () => {
    const { store, approval, request, invocation } = await fixture();
    const result = await store.consumeApproved(approval.id, request.bindingKey, { workerId: 'worker-a', workerAttempt: 3 }, invocation);
    expect(result.consumed).toBe(false);
    expect((await store.loadFresh(approval.id))?.status).toBe('approved');
  });
  it('rejects changed tool arguments with explicit invocation identity', async () => {
    const { store, approval, request, invocation } = await fixture();
    const result = await store.consumeApproved(approval.id, request.bindingKey, { workerId: 'worker-a', workerAttempt: 2 }, { ...invocation, argsHash: 'changed-args' });
    expect(result.consumed).toBe(false);
    expect((await store.loadFresh(approval.id))?.status).toBe('approved');
  });
  it('requires invocation identity for an invocation-bound approval', async () => {
    const { store, approval, request } = await fixture();
    expect((await store.consumeApproved(approval.id, request.bindingKey, { workerId: 'worker-a', workerAttempt: 2 })).consumed).toBe(false);
  });
  it('consumes a correctly bound approval once and rejects replay', async () => {
    const { store, approval, request, invocation } = await fixture();
    const consumer = { workerId: 'worker-a', workerAttempt: 2 };
    expect((await store.consumeApproved(approval.id, request.bindingKey, consumer, invocation)).consumed).toBe(true);
    expect((await store.consumeApproved(approval.id, request.bindingKey, consumer, invocation)).consumed).toBe(false);
  });
});
