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
  const originalPatch = store.patchWorker.bind(store);
  let failures = 0;
  store.patchWorker = async (runId, workerId, patch) => {
    if (patch.status === (outcome === 'success' ? 'completed' : 'failed')) { failures++; return null; }
    return originalPatch(runId, workerId, patch);
  };
  const events: string[] = [];
  let executed = 0;
  const scheduler = new CoordinationScheduler({
    cwd, daemonInstanceId: 'terminal-event-test', store,
    configProvider: async () => ({ permissions: { sessionMode: 'bypass' } }) as any,
    authorization: { evaluate: async () => ({ status: 'allowed' }) } as any,
    ownershipRegistry: { acquireMany: async () => [], release: async () => true, renew: async () => true } as any,
    executor: { execute: async () => { executed++; if (outcome === 'throw') throw new Error('deliberate exception'); return { outcome, summary: 'ok', failureKind: outcome === 'failure' ? 'execution_error' : undefined, error: outcome === 'failure' ? 'deliberate failure' : undefined }; } } as any,
    eventLog: { append: async (event: any) => { events.push(event.type); return event; } } as any,
  }, { maxConcurrency: 1, enableConflictDetection: false, enableMidExecutionReplanning: false });
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
