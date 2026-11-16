import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CoordinationStore } from '../../src/coordination/kernel/coordination-store.js';
import { CoordinationScheduler } from '../../src/coordination/kernel/coordination-scheduler.js';
import { createCoordinationRun, createWorkerAssignment } from '../../src/coordination/kernel/coordination-types.js';
import { closeSharedLedger } from '../../src/runtime-state/storage/runtime-ledger.js';
import { buildCoordinationRunView } from '../../src/coordination/kernel/coordination-view.js';

for (const outcome of ['success', 'failure', 'throw'] as const) {
test(`does not emit ${outcome} when durable terminal worker status cannot be persisted`, { timeout: 30_000 }, async () => {
  const parent = join(process.cwd(), 'tmp', 'scheduler-terminal-event-tests');
  mkdirSync(parent, { recursive: true });
  const cwd = mkdtempSync(join(parent, 'fixture-'));
  const store = new CoordinationStore(cwd);
  let failures = 0;
  store.commitRunningWorkerTerminal = async () => { failures++; return false; };
  const events: string[] = [];
  let executed = 0;
  let replans = 0;
  const scheduler = new CoordinationScheduler({
    cwd, daemonInstanceId: 'terminal-event-test', store,
    configProvider: async () => ({ permissions: { sessionMode: 'bypass' } }) as any,
    authorization: { evaluate: async () => ({ status: 'allowed' }) } as any,
    ownershipRegistry: { acquireMany: async () => [], release: async () => true, renew: async () => true } as any,
    executor: { execute: async () => { executed++; if (outcome === 'throw') throw new Error('deliberate exception'); return { outcome, summary: 'ok', failureKind: outcome === 'failure' ? 'execution_error' : undefined, error: outcome === 'failure' ? 'deliberate failure' : undefined }; } } as any,
    eventLog: { append: async (event: any) => { events.push(event.type); return event; } } as any,
    replanner: { replan: async () => { replans++; throw new Error('replan after failed commit'); } } as any,
  }, { maxConcurrency: 1, enableConflictDetection: false, enableMidExecutionReplanning: true });
  try {
    const run = createCoordinationRun({ sessionId: 'audit', rootGoal: 'no terminal event before durable status', coordinatorAgentId: 'alix' });
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: 'worker', taskLabel: 'fault',
      goalPrompt: 'return success', requiredCapabilities: ['task.do'], attempt: 0, maxAttempts: 1,
    });
    await store.addWorker(run.id, worker);
    await scheduler.tick(run.id);
    for (let i = 0; i < 100 && failures < 5; i++) await sleep(100);
    await scheduler.shutdown();
    assert.equal(executed, 1);
    assert.equal(failures, 5);
    assert.equal(replans, 0, 'must not replan from an uncommitted failure');
    const persisted = await store.load(run.id);
    assert.equal(persisted?.workers[0]?.status, 'running');
    assert.equal(events.filter(x => x === (outcome === 'success' ? 'coordination.worker.completed' : 'coordination.worker.failed')).length, 0);
    const view = await buildCoordinationRunView(run.id, cwd);
    assert.notEqual(view?.run.completion.verification, 'verified');
  } finally {
    await scheduler.shutdown();
    closeSharedLedger(cwd);
    rmSync(cwd, { recursive: true, force: true });
  }
});
}

test('cancellation between terminal retry attempts rejects stale completion', { timeout: 30_000 }, async () => {
  const parent = join(process.cwd(), 'tmp', 'scheduler-terminal-event-tests');
  mkdirSync(parent, { recursive: true });
  const cwd = mkdtempSync(join(parent, 'cancel-fixture-'));
  const store = new CoordinationStore(cwd);
  const original = store.commitRunningWorkerTerminal.bind(store);
  let attempts = 0;
  const events: string[] = [];
  store.commitRunningWorkerTerminal = async (runId, workerId, attempt, patch) => {
    attempts++;
    if (attempts === 1) {
      await store.patchWorker(runId, workerId, { status: 'cancelled', blockReason: 'cancelled', failureKind: 'cancelled' });
      return false; // Cancellation becomes durable before the second retry.
    }
    return original(runId, workerId, attempt, patch);
  };
  const scheduler = new CoordinationScheduler({
    cwd, daemonInstanceId: 'cancel-race-test', store,
    configProvider: async () => ({ permissions: { sessionMode: 'bypass' } }) as any,
    authorization: { evaluate: async () => ({ status: 'allowed' }) } as any,
    ownershipRegistry: { acquireMany: async () => [], release: async () => true, renew: async () => true } as any,
    executor: { execute: async () => ({ outcome: 'success', summary: 'ok' }) } as any,
    eventLog: { append: async (event: any) => { events.push(event.type); return event; } } as any,
  }, { maxConcurrency: 1, enableConflictDetection: false, enableMidExecutionReplanning: false });
  try {
    const run = createCoordinationRun({ sessionId: 'race', rootGoal: 'cancellation overrides late success', coordinatorAgentId: 'alix' });
    await store.save(run);
    const worker = createWorkerAssignment({ coordinationRunId: run.id, agentId: 'worker', taskLabel: 'race', goalPrompt: 'test', requiredCapabilities: ['task.do'], attempt: 0, maxAttempts: 2 });
    await store.addWorker(run.id, worker);
    await scheduler.tick(run.id);
    for (let i = 0; i < 100 && attempts < 5; i++) await sleep(100);
    await scheduler.shutdown();
    assert.equal(attempts, 5);
    const persisted = await store.load(run.id);
    assert.equal(persisted?.workers[0]?.status, 'cancelled');
    assert.equal(events.filter(event => event === 'coordination.worker.completed').length, 0);
  } finally {
    await scheduler.shutdown();
    closeSharedLedger(cwd);
    rmSync(cwd, { recursive: true, force: true });
  }
});


test('stale attempt cleanup never releases or clears successor leases', { timeout: 30_000 }, async () => {
  const parent = join(process.cwd(), 'tmp', 'scheduler-terminal-event-tests');
  mkdirSync(parent, { recursive: true });
  const cwd = mkdtempSync(join(parent, 'superseded-fixture-'));
  const store = new CoordinationStore(cwd);
  let releaseExecution!: () => void;
  let executionStarted!: () => void;
  const gate = new Promise<void>(resolve => { releaseExecution = resolve; });
  const started = new Promise<void>(resolve => { executionStarted = resolve; });
  const released: string[] = [];
  const events: string[] = [];
  const scheduler = new CoordinationScheduler({
    cwd, daemonInstanceId: 'supersession-test', store,
    configProvider: async () => ({ permissions: { sessionMode: 'bypass' } }) as any,
    authorization: { evaluate: async () => ({ status: 'allowed' }) } as any,
    ownershipRegistry: {
      acquireMany: async () => [{ acquired: true, record: { id: 'old-attempt-lease' } }],
      release: async (id: string) => { released.push(id); return true; },
      renew: async () => true,
    } as any,
    executor: { execute: async () => { executionStarted(); await gate; return { outcome: 'success', summary: 'late success' }; } } as any,
    eventLog: { append: async (event: any) => { events.push(event.type); return event; } } as any,
  }, { maxConcurrency: 1, enableConflictDetection: false, enableMidExecutionReplanning: false });
  try {
    const run = createCoordinationRun({ sessionId: 'superseded', rootGoal: 'successor ownership', coordinatorAgentId: 'alix' });
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: 'worker', taskLabel: 'superseded',
      goalPrompt: 'test', requiredCapabilities: ['task.do'], attempt: 0, maxAttempts: 3,
      ownershipClaims: [{ path: 'owned.txt', recursive: false }],
    });
    await store.addWorker(run.id, worker);
    await scheduler.tick(run.id);
    await Promise.race([started, sleep(5000).then(() => { throw new Error('executor never started'); })]);
    const original = (await store.load(run.id))!.workers[0]!;
    assert.equal(original.attempt, 1);
    assert.deepEqual(original.leaseIds, ['old-attempt-lease']);
    await store.patchWorker(run.id, worker.id, {
      status: 'running', attempt: 2, leaseIds: ['new-attempt-lease'],
    });
    releaseExecution();
    // Wait for the stale attempt's finally cleanup before shutdown; shutdown
    // aborts still-active executions and would create a different cancel race.
    for (let i = 0; i < 100 && !released.includes('old-attempt-lease'); i++) await sleep(25);
    assert.ok(released.includes('old-attempt-lease'), 'old attempt must release its own lease');
    const persisted = (await store.load(run.id))!.workers[0]!;
    assert.equal(persisted.status, 'running');
    assert.equal(persisted.attempt, 2);
    assert.deepEqual(persisted.leaseIds, ['new-attempt-lease']);
    assert.equal(released.includes('new-attempt-lease'), false);
    assert.equal(events.includes('coordination.worker.completed'), false);
  } finally {
    releaseExecution();
    await scheduler.shutdown();
    closeSharedLedger(cwd);
    rmSync(cwd, { recursive: true, force: true });
  }
});
