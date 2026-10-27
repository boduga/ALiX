import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { assertNoForbiddenDecisionMethods, createWorkerApprovalPort, type WorkerApprovalPort } from '../../src/governance/approvals/worker-approval-port.js';
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
      'findResolved', 'findByRequestId', 'request', 'requestOrReusePending',
      'consumeApproved', 'recordExecutionOutcome', 'load', 'markExecutionUnverified',
    ]) {
      expect(typeof (port as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });

  it('reuses a prior approved resolution for the same request id (legacy de-dup)', async () => {
    // PolicyGate's legacy branch looks up the prior record by requestId after the
    // agent loop re-evaluates the same tool call. With the method omitted, that
    // lookup silently returns undefined and a SECOND approval is minted for the
    // same call — the pending-approval pile-up failure.
    const { store } = await workspace();
    const port = createWorkerApprovalPort(store, { workerId: 'worker-a' });

    const created = await port.request({
      reason: 'legacy ask', capability: 'shell.exec',
      sessionId: 's1', agentId: 'worker-a', requestId: 'call-1',
    });
    expect(port.findByRequestId('call-1')?.id).toBe(created.id);
    // A different request id must not collide.
    expect(port.findByRequestId('call-2')).toBeUndefined();
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
    const port = createWorkerApprovalPort(store, { workerId: 'worker-a' });

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
    const port = createWorkerApprovalPort(store, { workerId: 'worker-a' });
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
    const port = createWorkerApprovalPort(store, { workerId: 'worker-a' });
    const created = await port.requestOrReusePending(REQUEST);
    const operator = await otherProcess(cwd);
    await operator.resolve(created.id, 'approved', 'operator');

    const first = await port.consumeApproved(created.id, REQUEST.bindingKey, { workerAttempt: 0 });
    expect(first.consumed).toBe(true);

    // A second process holding its OWN store must lose the race.
    const rival = await otherProcess(cwd);
    const second = await rival.consumeApproved(created.id, REQUEST.bindingKey, {});
    expect(second.consumed).toBe(false);
  });

  it('rejects consumption bound to a different binding key', async () => {
    const { cwd, store } = await workspace();
    const port = createWorkerApprovalPort(store, { workerId: 'worker-a' });
    const created = await port.requestOrReusePending(REQUEST);
    const operator = await otherProcess(cwd);
    await operator.resolve(created.id, 'approved', 'operator');

    const wrong = await port.consumeApproved(created.id, 'some-other-binding', {});
    expect(wrong.consumed).toBe(false);
    expect((await port.loadFresh(created.id))?.status).toBe('approved');
  });

  it('an operator DENIAL is visible to the worker and blocks consumption', async () => {
    const { cwd, store } = await workspace();
    const port = createWorkerApprovalPort(store, { workerId: 'worker-a' });
    const created = await port.requestOrReusePending(REQUEST);
    const operator = await otherProcess(cwd);
    await operator.resolve(created.id, 'denied', 'operator');

    expect((await port.loadFresh(created.id))?.status).toBe('denied');
    const attempt = await port.consumeApproved(created.id, REQUEST.bindingKey, {});
    expect(attempt.consumed).toBe(false);
  });

  it('does not expose another worker\u2019s records through a different binding', async () => {
    const { store } = await workspace();
    const port = createWorkerApprovalPort(store, { workerId: 'worker-b' });
    await port.requestOrReusePending({ ...REQUEST, bindingKey: 'worker-b-binding', workerId: 'worker-b' });

    expect(port.findExact('worker-b-binding')).toBeDefined();
    expect(port.findExact('binding-abc')).toBeUndefined();
  });

  it('reports the execution outcome of its OWN consumed approval', async () => {
    const { cwd, store } = await workspace();
    const port = createWorkerApprovalPort(store, { workerId: 'worker-a' });
    const created = await port.requestOrReusePending(REQUEST);
    const operator = await otherProcess(cwd);
    await operator.resolve(created.id, 'approved', 'operator');
    await port.consumeApproved(created.id, REQUEST.bindingKey, { workerAttempt: 0 });

    expect(await port.recordExecutionOutcome(created.id, 'succeeded')).toBe(true);
    const after = await port.loadFresh(created.id);
    expect(after?.executionOutcome).toBe('succeeded');
  });

  it('REFUSES to report an outcome for another worker\u2019s claim', async () => {
    // The store validates only status/outcome-transition, not reporter identity,
    // so the port must refuse a cross-worker write or one worker could falsify
    // another's execution receipt.
    const { cwd, store } = await workspace();
    const ownerPort = createWorkerApprovalPort(store, { workerId: 'worker-a' });
    const otherPort = createWorkerApprovalPort(store, { workerId: 'worker-b' });

    const created = await ownerPort.requestOrReusePending(REQUEST);
    const operator = await otherProcess(cwd);
    await operator.resolve(created.id, 'approved', 'operator');
    await ownerPort.consumeApproved(created.id, REQUEST.bindingKey, { workerAttempt: 0 });

    expect(await otherPort.recordExecutionOutcome(created.id, 'succeeded')).toBe(false);
    expect(await otherPort.loadFresh(created.id)).toBeUndefined();
    expect((await store.loadFresh(created.id))?.executionOutcome).toBe('pending');

    // The rightful owner can still report.
    expect(await ownerPort.recordExecutionOutcome(created.id, 'failed')).toBe(true);
  });

  it('a port with no bound worker id cannot report on a worker-bound claim', async () => {
    const { cwd, store } = await workspace();
    const unbound = createWorkerApprovalPort(store);
    const bound = createWorkerApprovalPort(store, { workerId: 'worker-a' });

    const created = await bound.requestOrReusePending(REQUEST);
    const operator = await otherProcess(cwd);
    await operator.resolve(created.id, 'approved', 'operator');
    await bound.consumeApproved(created.id, REQUEST.bindingKey, { workerAttempt: 0 });

    expect(await unbound.recordExecutionOutcome(created.id, 'succeeded')).toBe(false);
    expect(await bound.recordExecutionOutcome(created.id, 'succeeded')).toBe(true);
  });

  it('the clean facade exposes no decision method', async () => {
    // Necessary but NOT sufficient: this is true by construction. The test below
    // is the one that can fail if the guard is removed.
    const { store } = await workspace();
    const port = createWorkerApprovalPort(store) as unknown as Record<string, unknown>;
    expect('resolve' in port).toBe(false);
    expect('revoke' in port).toBe(false);
  });

  it('THROWS when a candidate view exposes a decision method', async () => {
    // This is the guard actually firing. Previously the "refuses to construct"
    // test built a CLEAN port and asserted the methods were absent, so deleting
    // the guard left every test green (Gate E review, vacuous assertion #1).
    // Each forbidden method must be rejected on its own, not just the first.
    const forbidden = [
      'resolve', 'resolveWithEvidence', 'resolveGroup',
      'revoke', 'invalidate', 'append', 'mutate',
    ];
    for (const method of forbidden) {
      const contaminated = { get: () => undefined, [method]: () => undefined };
      expect(
        () => assertNoForbiddenDecisionMethods(contaminated),
        method,
      ).toThrow(/must not expose/);
    }
    // And a clean candidate passes, so the guard is not simply always-throwing.
    expect(() => assertNoForbiddenDecisionMethods({ get: () => undefined })).not.toThrow();
  });

  it('a refactor that leaked `resolve` onto the facade would be caught', async () => {
    // End-to-end shape of the same guarantee, without touching production code:
    // the port a worker receives must satisfy the guard.
    const { store } = await workspace();
    const port = createWorkerApprovalPort(store);
    expect(() => assertNoForbiddenDecisionMethods(port)).not.toThrow();
    // Simulate the leak the guard exists for.
    const leaked = { ...port, resolve: () => undefined };
    expect(() => assertNoForbiddenDecisionMethods(leaked)).toThrow(/resolve/);
  });

  it('PolicyGate reuses an approved request through the port instead of asking again', async () => {
    // End-to-end form of the de-dup regression: the legacy gate branch must see
    // the prior approval via findByRequestId. Without it, the agent loop's
    // re-evaluation mints a second pending approval and the tool never runs.
    const { PolicyGate } = await import('../../src/governance/policy/policy-gate.js');
    const { store } = await workspace();
    const port = createWorkerApprovalPort(store, { workerId: 'worker-a' });

    const config = {
      version: 1,
      model: { provider: 't', name: 't' },
      permissions: {
        default: 'ask', tools: { 'shell.run': 'ask' }, protectedPaths: [],
        allowNetworkDomains: [], denyCommands: [], sessionMode: 'ask' as const,
      },
      context: { repoMap: false, repoMapMode: 'lite', maxRepoMapTokens: 0, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
      runtime: { provider: 'process', shell: 'bash', commandTimeoutMs: 1000, envAllowlist: [] },
      ui: { enabled: false, host: '127.0.0.1', port: 0, transport: 'sse' },
    } as never;

    const gate = new PolicyGate(config as never, { approvalStore: port as never });
    const request = {
      requestId: 'call-1', toolName: 'shell.run', capability: 'shell.exec',
      args: { command: 'ls' }, cwd: '/tmp', sessionMode: 'ask' as const,
      sessionId: 's1', agentId: 'worker-a', source: 'tool' as const,
    };

    const first = await gate.evaluateToolCall(request as never);
    expect(first.decision).toBe('ask');
    expect(first.approvalId).toBeTruthy();

    await store.resolve(first.approvalId!, 'approved', 'operator');

    const second = await gate.evaluateToolCall(request as never);
    expect(second.decision).toBe('allow');
    expect(second.approvalId).toBe(first.approvalId);
  });
});
