/** LEAN-G01 isolated scheduler recovery with fake worker; no external tool effects. */
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../../src/coordination/kernel/coordination-store.js';
import { CoordinationScheduler } from '../../src/coordination/kernel/coordination-scheduler.js';
import { createCoordinationRun, createWorkerAssignment } from '../../src/coordination/kernel/coordination-types.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

describe('LEAN-G01 Inspector recovery redispatch and attempt accounting', () => {
  it('reclaims dead web owner, dispatches one fake worker, charges exactly one new attempt', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'alix-lean-redispatch-'));
    const store = new CoordinationStore(cwd);
    let executions = 0;
    const scheduler = new CoordinationScheduler({
      cwd, daemonInstanceId: `web-${process.pid}`, store,
      configProvider: async () => ({ permissions: { sessionMode: 'bypass' } }) as never,
      authorization: { evaluate: async () => ({ status: 'allowed' }) } as never,
      ownershipRegistry: { acquireMany: async () => [], release: async () => true, renew: async () => true } as never,
      executor: { execute: async () => { executions++; return { outcome: 'success', summary: 'fake only' }; } } as never,
    }, { maxConcurrency: 1 });
    try {
      const run = createCoordinationRun({ sessionId: 'redispatch', rootGoal: 'no external effects', coordinatorAgentId: 'parent' });
      run.hostKind = 'inspector'; run.status = 'running';
      await store.save(run);
      const worker = createWorkerAssignment({ coordinationRunId: run.id, agentId: 'fake', taskLabel: 'recovery', goalPrompt: 'no effects', requiredCapabilities: ['task.do'], status: 'running', attempt: 1, maxAttempts: 3, executionOwnerId: 'web-99999999', lastHeartbeatAt: new Date(Date.now() - 120_000).toISOString() });
      await store.addWorker(run.id, worker);
      const result = await scheduler.tick(run.id);
      for (let i = 0; i < 50; i++) {
        if ((await store.load(run.id))?.workers[0]?.status === 'completed') break;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      expect(result.recoveredOrphans).toEqual([worker.id]);
      expect(executions).toBe(1);
      const final = (await store.load(run.id))!.workers[0]!;
      expect(final.status).toBe('completed');
      expect(final.attempt).toBe(2);
      await scheduler.tick(run.id);
      expect(executions).toBe(1);
      expect((await store.load(run.id))!.workers[0]!.attempt).toBe(2);
    } finally { await scheduler.shutdown(); closeAllSharedLedgers(); await rm(cwd, { recursive: true, force: true }); }
  });
});
