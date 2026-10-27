/** LEAN-G01 deterministic cancel-vs-recovery-tick race; fake worker only. */
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../../src/coordination/kernel/coordination-store.js';
import { CoordinationScheduler } from '../../src/coordination/kernel/coordination-scheduler.js';
import { createCoordinationRun, createWorkerAssignment } from '../../src/coordination/kernel/coordination-types.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

describe('LEAN-G01 Inspector cancel racing with recovered worker', () => {
  it('cancel while tick is suspended before dispatch prevents fake worker execution', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'alix-lean-recovery-race-'));
    const store = new CoordinationStore(cwd);
    let entered!: () => void;
    let release!: () => void;
    const atGate = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let executions = 0;
    const scheduler = new CoordinationScheduler({
      cwd, daemonInstanceId: `web-${process.pid}`, store,
      configProvider: async () => { entered(); await gate; return { permissions: { sessionMode: 'bypass' } } as never; },
      authorization: { evaluate: async () => ({ status: 'allowed' }) } as never,
      ownershipRegistry: { acquireMany: async () => [], release: async () => true, renew: async () => true } as never,
      executor: { execute: async () => { executions++; return { outcome: 'success', summary: 'unexpected' }; } } as never,
    }, { maxConcurrency: 1 });
    try {
      const run = createCoordinationRun({ sessionId: 'recovery-race', rootGoal: 'no effects', coordinatorAgentId: 'parent' });
      run.hostKind = 'inspector'; run.status = 'running';
      await store.save(run);
      const worker = createWorkerAssignment({ coordinationRunId: run.id, agentId: 'fake', taskLabel: 'race', goalPrompt: 'no effects', requiredCapabilities: ['task.do'], status: 'running', attempt: 1, maxAttempts: 3, executionOwnerId: 'web-99999999', lastHeartbeatAt: new Date(Date.now() - 120_000).toISOString() });
      await store.addWorker(run.id, worker);
      const tick = scheduler.tick(run.id);
      await atGate;
      await scheduler.cancelRun(run.id);
      release();
      const result = await tick;
      const final = (await store.load(run.id))!;
      expect(executions).toBe(0);
      expect(result.dispatched).toEqual([]);
      expect(final.status).toBe('cancelled');
      expect(final.workers[0]!.status).toBe('cancelled');
      expect(final.workers[0]!.attempt).toBe(1);
    } finally { release(); await scheduler.shutdown(); closeAllSharedLedgers(); await rm(cwd, { recursive: true, force: true }); }
  });
});
