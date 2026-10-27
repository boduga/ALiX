/** LEAN-G01: exhausted recovery budget with fake executor; no real tool effects. */
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../../src/coordination/kernel/coordination-store.js';
import { CoordinationScheduler } from '../../src/coordination/kernel/coordination-scheduler.js';
import { createCoordinationRun, createWorkerAssignment } from '../../src/coordination/kernel/coordination-types.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

describe('LEAN-G01 Inspector exhausted retry budget', () => {
  it('never invokes fake worker after final attempt was consumed before host death', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'alix-lean-exhausted-'));
    const store = new CoordinationStore(cwd);
    let executions = 0;
    const scheduler = new CoordinationScheduler({
      cwd, daemonInstanceId: `web-${process.pid}`, store,
      configProvider: async () => ({ permissions: { sessionMode: 'bypass' } }) as never,
      authorization: { evaluate: async () => ({ status: 'allowed' }) } as never,
      ownershipRegistry: { acquireMany: async () => [], release: async () => true, renew: async () => true } as never,
      executor: { execute: async () => { executions++; return { outcome: 'success', summary: 'unexpected' }; } } as never,
    }, { maxConcurrency: 1 });
    try {
      const run = createCoordinationRun({ sessionId: 'exhausted', rootGoal: 'no effects', coordinatorAgentId: 'parent' });
      run.hostKind = 'inspector'; run.status = 'running';
      await store.save(run);
      const worker = createWorkerAssignment({ coordinationRunId: run.id, agentId: 'fake', taskLabel: 'exhausted', goalPrompt: 'no effects', requiredCapabilities: ['task.do'], status: 'running', attempt: 3, maxAttempts: 3, executionOwnerId: 'web-99999999', lastHeartbeatAt: new Date(Date.now() - 120_000).toISOString() });
      await store.addWorker(run.id, worker);
      await scheduler.tick(run.id);
      const final = (await store.load(run.id))!.workers[0]!;
      expect(executions).toBe(0);
      expect(final.attempt).toBe(3);
      expect(final.status).toBe('failed');
      await scheduler.tick(run.id);
      expect(executions).toBe(0);
    } finally { await scheduler.shutdown(); closeAllSharedLedgers(); await rm(cwd, { recursive: true, force: true }); }
  });
});
