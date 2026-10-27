/** LEAN-G01 D7: authorization parity and lock-boundary acceptance. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { createWorkerApprovalPort } from '../../src/governance/approvals/worker-approval-port.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  closeAllSharedLedgers();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function fixture(workerId: string | null = 'worker-a', state = 'pending') {
  const cwd = await mkdtemp(join(tmpdir(), 'alix-d7-atomic-'));
  dirs.push(cwd);
  const store = new ApprovalStore(cwd);
  await store.load();
  const record = await store.requestOrReusePending({
    reason: 'D7 acceptance', bindingKey: 'binding', requestFingerprint: 'request',
    policyRevision: 'rev', capabilities: ['file.write'], workerId: workerId ?? undefined,
    metadata: { workerId: 'worker-b' },
  });
  if (state !== 'requested') await store.resolve(record.id, 'approved');
  if (state !== 'requested' && state !== 'approved') {
    expect((await store.consumeApproved(record.id, 'binding', { workerId: workerId ?? undefined })).consumed).toBe(true);
    if (state === 'succeeded') await store.recordExecutionOutcome(record.id, 'succeeded');
    if (state === 'unverified') await store.markExecutionUnverified(record.id);
  }
  return { cwd, store, id: record.id };
}
const methods = ['report', 'unverified'] as const;
const callers = ['owner', 'other', 'unbound', 'host'] as const;
const states = ['requested', 'approved', 'pending', 'succeeded', 'unverified'] as const;

// Explicit parity across legacy/worker records, host/worker authority and states.
// Host calls retain their privileged interface; every port supplies a scope.
describe('D7 outcome authorization parity', () => {
  for (const method of methods) for (const legacy of [false, true]) {
    for (const caller of callers) for (const state of states) {
      it(`${method}: ${legacy ? 'legacy' : 'worker-a'} / ${caller} / ${state}`, async () => {
        const { cwd, store, id } = await fixture(legacy ? null : 'worker-a', state);
        const port = caller === 'host' ? store : createWorkerApprovalPort(store,
          caller === 'unbound' ? {} : { workerId: caller === 'owner' ? 'worker-a' : 'worker-b' });
        const before = structuredClone(await store.loadFresh(id));
        const projection = await readFile(join(cwd, '.alix/approvals/approvals.json'), 'utf8');
        const appends = store.ledgerStatus().appends;
        const authorized = legacy || caller === 'owner' || caller === 'host';
        const result = method === 'report'
          ? await port.recordExecutionOutcome(id, 'failed')
          : await port.markExecutionUnverified!(id);
        const expected = method === 'report'
          ? authorized && state === 'pending'
          : !authorized ? 'missing' : state === 'pending' || state === 'unverified' ? 'unverified' : 'terminal';
        expect(result).toBe(expected);
        const after = await store.loadFresh(id);
        if (!authorized || state !== 'pending') expect(after).toEqual(before);
        else expect(after).toMatchObject({ status: 'consumed', executionOutcome: method === 'report' ? 'failed' : 'unverified' });
        if (!authorized) {
          expect(store.ledgerStatus().appends).toBe(appends);
          expect(await readFile(join(cwd, '.alix/approvals/approvals.json'), 'utf8')).toBe(projection);
        }
      });
    }
  }
});

for (const method of methods) {
  it(`${method}: rechecks authoritative ownership after a concurrent rebind`, async () => {
    const { cwd, store, id } = await fixture();
    const reader = new ApprovalStore(cwd);
    await reader.load();
    const port = createWorkerApprovalPort(reader, { workerId: 'worker-a' });
    const mutate = reader.mutate.bind(reader);
    // Force a competing commit AFTER any facade preflight but BEFORE its
    // locked reload. The old port authorizes stale worker-a and then writes B.
    vi.spyOn(reader, 'mutate').mockImplementationOnce(async fn => {
      await store.mutate(records => { records.find(r => r.id === id)!.workerId = 'worker-b'; });
      return mutate(fn);
    });
    const result = method === 'report' ? await port.recordExecutionOutcome(id, 'succeeded') : await port.markExecutionUnverified!(id);
    expect(result).toBe(method === 'report' ? false : 'missing');
    expect(await store.loadFresh(id)).toMatchObject({ workerId: 'worker-b', status: 'consumed', executionOutcome: 'pending' });
  });

  it(`${method}: concurrent owner and unauthorized ports cannot falsify a receipt`, async () => {
    const { cwd, store, id } = await fixture();
    const stores = await Promise.all(Array.from({ length: 6 }, async () => {
      const next = new ApprovalStore(cwd); await next.load(); return next;
    }));
    const ports = stores.map((s, i) => createWorkerApprovalPort(s, i % 2 ? {} : { workerId: 'worker-b' }));
    const owner = createWorkerApprovalPort(store, { workerId: 'worker-a' });
    const results = await Promise.all([
      ...ports.map(p => method === 'report' ? p.recordExecutionOutcome(id, 'failed') : p.markExecutionUnverified!(id)),
      method === 'report' ? owner.recordExecutionOutcome(id, 'succeeded') : owner.markExecutionUnverified!(id),
    ]);
    expect(results.slice(0, 6)).toEqual(Array(6).fill(method === 'report' ? false : 'missing'));
    expect(results[6]).toBe(method === 'report' ? true : 'unverified');
    expect(await store.loadFresh(id)).toMatchObject({ status: 'consumed', executionOutcome: method === 'report' ? 'succeeded' : 'unverified' });
  });

  it(`${method}: persisted restrictions survive ledger close and reopen`, async () => {
    const { cwd, id } = await fixture();
    closeAllSharedLedgers();
    const restarted = new ApprovalStore(cwd); await restarted.load();
    for (const workerId of ['worker-b', undefined]) {
      const port = createWorkerApprovalPort(restarted, { workerId });
      const result = method === 'report' ? await port.recordExecutionOutcome(id, 'succeeded') : await port.markExecutionUnverified!(id);
      expect(result).toBe(method === 'report' ? false : 'missing');
      expect(await restarted.loadFresh(id)).toMatchObject({ status: 'consumed', executionOutcome: 'pending' });
    }
    const options = { workerId: 'worker-a' };
    const owner = createWorkerApprovalPort(restarted, options);
    options.workerId = 'worker-b'; // Caller cannot replace captured trusted identity.
    // Extra model/request metadata cannot override the wrapper's identity.
    const result = method === 'report'
      ? await Reflect.apply(owner.recordExecutionOutcome, owner, [id, 'succeeded', { workerId: 'worker-b' }])
      : await Reflect.apply(owner.markExecutionUnverified!, owner, [id, { workerId: 'worker-b' }]);
    expect(result).toBe(method === 'report' ? true : 'unverified');
  });
}
