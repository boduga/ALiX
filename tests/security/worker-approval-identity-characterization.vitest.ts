/**
 * LEAN-G01 worker identity boundary.
 *
 * HISTORY — read before editing.
 *
 * This file began as CHARACTERIZATION: three of its tests asserted that the
 * identity boundary was OPEN — that the store accepted a missing consumer
 * workerId on a worker-bound approval, that a worker-B port could consume a
 * worker-A approval by omitting identity, and that a bound port forwarded another
 * worker's request without replacing its workerId. Each carried a
 * `// gap: desired future result is false` comment naming the intended behaviour.
 *
 * The gap is closed, so those three assertions are inverted to the behaviour the
 * comments described. Do not restore them: they recorded a defect, not a
 * requirement.
 *
 * The fourth test ("rejects a supplied mismatched workerId") already asserted
 * correct behaviour and is unchanged.
 */
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
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function fixture(): Promise<{
  store: ApprovalStore;
  created: Awaited<ReturnType<ApprovalStore['requestOrReusePending']>>;
  request: { bindingKey: string };
}> {
  const dir = await mkdtemp(join(tmpdir(), 'alix-identity-'));
  dirs.push(dir);
  const store = new ApprovalStore(dir);
  await store.load();
  const request = {
    reason: 'identity boundary characterization', capability: 'shell.exec',
    bindingKey: 'identity-binding', requestFingerprint: 'shell.exec',
    policyRevision: 'rev-1', capabilities: ['shell.exec'],
    coordinationRunId: 'run-1', workerId: 'worker-a', workerAttempt: 0, sessionId: 's1',
  };
  const created = await store.requestOrReusePending(request);
  await store.resolve(created.id, 'approved', 'operator');
  return { store, created, request };
}

describe('LEAN-G01 worker identity boundary (gaps closed; guards regression)', () => {
  it('store REFUSES a missing consumer workerId on a worker-bound approval', async () => {
    const { store, created, request } = await fixture();
    // A worker-bound approval is not consumable by an unidentified consumer: an
    // omitted identity must not be read as "privileged host".
    const result = await store.consumeApproved(created.id, request.bindingKey, {});
    expect(result.consumed).toBe(false);
    expect((await store.loadFresh(created.id))?.status).toBe('approved');
  });

  it('store rejects a supplied mismatched workerId', async () => {
    const { store, created, request } = await fixture();
    const result = await store.consumeApproved(created.id, request.bindingKey, { workerId: 'worker-b' });
    expect(result.consumed).toBe(false);
    expect((await store.loadFresh(created.id))?.status).toBe('approved');
  });

  it('a bound worker-B port cannot consume a worker-A approval by omitting identity', async () => {
    const { store, created, request } = await fixture();
    const workerB = createWorkerApprovalPort(store, { workerId: 'worker-b' });
    // The port supplies its own bound identity, so omitting it at the call site
    // cannot become a cross-worker grant.
    const result = await workerB.consumeApproved(created.id, request.bindingKey, {});
    expect(result.consumed).toBe(false);
    expect((await store.loadFresh(created.id))?.status).toBe('approved');
    expect(await workerB.recordExecutionOutcome(created.id, 'succeeded')).toBe(false);
  });

  it('a bound port REJECTS a request naming a foreign worker', async () => {
    const { store } = await fixture();
    const workerB = createWorkerApprovalPort(store, { workerId: 'worker-b' });
    // The port refuses rather than silently rebinding: silently rewriting the
    // attribution would make the caller's claim false, which is its own defect.
    // Synchronous throw: the guard fires before any promise is returned, so
    // `rejects` would not observe it.
    expect(() =>
      workerB.requestOrReusePending({
        reason: 'cross-worker request',
        bindingKey: 'other-binding', requestFingerprint: 'other', policyRevision: 'rev-1',
        capabilities: ['shell.exec'], workerId: 'worker-a', coordinationRunId: 'run-1',
      }),
    ).toThrow(/identity mismatch/);
  });

  it('a bound port supplies its own worker when the request omits one', async () => {
    const { store } = await fixture();
    const workerB = createWorkerApprovalPort(store, { workerId: 'worker-b' });
    const created = await workerB.requestOrReusePending({
      reason: 'unattributed request',
      bindingKey: 'third-binding', requestFingerprint: 'third', policyRevision: 'rev-1',
      capabilities: ['shell.exec'], coordinationRunId: 'run-1',
    });
    // Omission is filled with the bound worker, so a record can never be created
    // with no owner while inside a worker-scoped port.
    expect(created.workerId).toBe('worker-b');
  });
});
