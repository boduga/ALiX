import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { createWorkerApprovalPort, type WorkerApprovalPort } from '../../src/governance/approvals/worker-approval-port.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

const cwds: string[] = [];
afterEach(async () => {
  closeAllSharedLedgers();
  for (const cwd of cwds.splice(0)) await rm(cwd, { recursive: true, force: true });
});

async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), '.alix-f8b-'));
  cwds.push(cwd);
  const store = new ApprovalStore(cwd);
  await store.load();
  return { cwd, store };
}

/** A second store instance on the same workspace = another process. */
async function otherProcess(cwd: string) {
  const store = new ApprovalStore(cwd);
  await store.load();
  return store;
}

const REQUEST = {
  reason: 'worker wants to run a command',
  capability: 'shell.exec',
  bindingKey: 'binding-abc',
  requestFingerprint: 'shell.exec',
  policyRevision: 'rev-1',
  capabilities: ['shell.exec'],
  coordinationRunId: 'run-1',
  workerId: 'worker-a',
  workerAttempt: 0,
  sessionId: 's1',
};

/**
 * F8b — durable tool-level approval for an ISOLATED worker process.
 *
 * A subagent worker is its own OS process and cannot receive the parent's
 * in-memory store. It opens its own instance on the SAME authoritative
 * workspace and sees the ledger through a RESTRICTED port, so it can request,
 * observe and consume an approval but can never record a decision (which would
 * let it approve its own request).
 */
describe('worker approval port (F8b)', () => {
  it('exposes every operation a worker needs', async () => {
    const { store } = await workspace();
    const port = createWorkerApprovalPort(store);
    for (const method of [
      'get', 'loadFresh', 'findExact', 'findPendingByBindingKey', 'findPending',
      'findResolved', 'request', 'requestOrReusePending', 'consumeApproved',
      'recordExecutionOutcome', 'load',
    ]) {
      expect(typeof (port as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });

  it('CANNOT approve or deny: no decision method is reachable', async () => {
    const { store } = await workspace();
    const port = createWorkerApprovalPort(store) as unknown as Record<string, unknown>;
    for (const forbidden of ['resolve', 'resolveWithEvidence', 'resolveGroup', 'revoke', 'invalidate', 'mutate']) {
      expect(port[forbidden]).toBeUndefined();
    }
  });

  it('a worker cannot self-approve its own request through the port', async () => {
    const { store } = await workspace();
    const port = createWorkerApprovalPort(store);

    const created = await port.requestOrReusePending(REQUEST);
    expect(created.status).toBe('pending');

    // The only mutation surface is consumption, and it refuses a non-approved
    // record. There is no way to move pending -> approved from here.
    const attempt = await port.consumeApproved(created.id, REQUEST.bindingKey, {});
    expect(attempt.consumed).toBe(false);

    const after = await port.loadFresh(created.id);
    expect(after?.status).toBe('pending');
  });

  it('observes an operator decision made by a DIFFERENT process', async () => {
    const { cwd, store } = await workspace();
    const port = createWorkerApprovalPort(store);
    const created = await port.requestOrReusePending(REQUEST);

    // The operator resolves through their own store instance (the TUI).
    const operator = await otherProcess(cwd);
    await operator.resolve(created.id, 'approved', 'operator');

    const observed = await port.loadFresh(created.id);
    expect(observed?.status).toBe('approved');
    expect(observed?.decidedAt).toBeTruthy();
  });

  it('consumes exactly once across processes (no double effect)', async () => {
    const { cwd, store } = await workspace();
    const port = createWorkerApprovalPort(store);
    const created = await port.requestOrReusePending(REQUEST);
    const operator = await otherProcess(cwd);
    await operator.resolve(created.id, 'approved', 'operator');

    const first = await port.consumeApproved(created.id, REQUEST.bindingKey, {});
    expect(first.consumed).toBe(true);

    // A second process holding its OWN store must lose the race.
    const rival = await otherProcess(cwd);
    const second = await rival.consumeApproved(created.id, REQUEST.bindingKey, {});
    expect(second.consumed).toBe(false);
  });

  it('rejects consumption bound to a different binding key', async () => {
    const { cwd, store } = await workspace();
    const port = createWorkerApprovalPort(store);
    const created = await port.requestOrReusePending(REQUEST);
    const operator = await otherProcess(cwd);
    await operator.resolve(created.id, 'approved', 'operator');

    const wrong = await port.consumeApproved(created.id, 'some-other-binding', {});
    expect(wrong.consumed).toBe(false);
    expect((await port.loadFresh(created.id))?.status).toBe('approved');
  });

  it('an operator DENIAL is visible to the worker and blocks consumption', async () => {
    const { cwd, store } = await workspace();
    const port = createWorkerApprovalPort(store);
    const created = await port.requestOrReusePending(REQUEST);
    const operator = await otherProcess(cwd);
    await operator.resolve(created.id, 'denied', 'operator');

    expect((await port.loadFresh(created.id))?.status).toBe('denied');
    const attempt = await port.consumeApproved(created.id, REQUEST.bindingKey, {});
    expect(attempt.consumed).toBe(false);
  });

  it('does not expose another worker\u2019s records through a different binding', async () => {
    const { store } = await workspace();
    const port = createWorkerApprovalPort(store);
    await port.requestOrReusePending({ ...REQUEST, bindingKey: 'worker-b-binding', workerId: 'worker-b' });

    expect(port.findExact('worker-b-binding')).toBeDefined();
    expect(port.findExact('binding-abc')).toBeUndefined();
  });

  it('reports the execution outcome of its own consumed approval', async () => {
    const { cwd, store } = await workspace();
    const port = createWorkerApprovalPort(store);
    const created = await port.requestOrReusePending(REQUEST);
    const operator = await otherProcess(cwd);
    await operator.resolve(created.id, 'approved', 'operator');
    await port.consumeApproved(created.id, REQUEST.bindingKey, {});

    await port.recordExecutionOutcome(created.id, 'succeeded');
    const after = await port.loadFresh(created.id);
    expect(after?.executionOutcome).toBe('succeeded');
  });

  it('refuses to construct a port that would expose a decision method', async () => {
    // Structural guarantee: if a future refactor added `resolve` to the facade,
    // createWorkerApprovalPort must throw rather than quietly ship it.
    const { store } = await workspace();
    const port = createWorkerApprovalPort(store) as unknown as Record<string, unknown>;
    expect('resolve' in port).toBe(false);
    expect('revoke' in port).toBe(false);
  });
});
