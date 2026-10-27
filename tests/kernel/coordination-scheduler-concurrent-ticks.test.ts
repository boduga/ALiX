import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../../src/coordination/kernel/coordination-store.js';
import { getSharedLedger } from '../../src/runtime-state/storage/runtime-ledger.js';
import { CoordinationScheduler } from '../../src/coordination/kernel/coordination-scheduler.js';
import { createCoordinationRun, createWorkerAssignment } from '../../src/coordination/kernel/coordination-types.js';

describe('coordination scheduler concurrent tick regression', () => {
  it('dispatches one pending worker exactly once across simultaneous same-run ticks', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'alix-concurrent-ticks-'));
    const store = new CoordinationStore(cwd);
    let configCalls = 0;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>(resolve => { releaseBarrier = resolve; });
    let executions = 0;
    const scheduler = new CoordinationScheduler({
      cwd, daemonInstanceId: 'concurrent-test', store,
      configProvider: async () => {
        configCalls++;
        if (configCalls === 2) releaseBarrier();
        await barrier;
        return { permissions: { sessionMode: 'bypass' } } as any;
      },
      authorization: { evaluate: async () => ({ status: 'allowed' }) } as any,
      ownershipRegistry: { acquireMany: async () => [], release: async () => true, renew: async () => true } as any,
      executor: { execute: async () => { executions++; return { outcome: 'success', summary: 'ok' }; } } as any,
    }, { maxConcurrency: 1 });
    try {
      const run = createCoordinationRun({ sessionId: 's', rootGoal: 'race', coordinatorAgentId: 'alix' });
      await store.save(run);
      const worker = createWorkerAssignment({ coordinationRunId: run.id, agentId: 'worker', taskLabel: 'race', goalPrompt: 'test', requiredCapabilities: ['task.do'], attempt: 0, maxAttempts: 3 });
      await store.addWorker(run.id, worker);
      const results = await Promise.all([scheduler.tick(run.id), scheduler.tick(run.id)]);
      await scheduler.shutdown();
      assert.equal(executions, 1, 'the same worker must never execute twice');
      assert.equal(results.flatMap(result => result.dispatched).length, 1, 'dispatch must be unique');
      const final = await store.load(run.id);
      assert.equal(final?.workers[0]?.attempt, 1);
      // Rejected claims must not append another authoritative run snapshot.
      const versionBefore = getSharedLedger(cwd).entityVersion(run.id);
      const countBefore = (await store.load(run.id))?.workers[0]?.attempt;
      assert.equal(await store.claimPendingWorker(run.id, worker.id, 0, {}), false);
      const countAfter = (await store.load(run.id))?.workers[0]?.attempt;
      assert.equal(countAfter, countBefore);
      assert.equal(getSharedLedger(cwd).entityVersion(run.id), versionBefore, 'rejected claim must not append a ledger fact');

    } finally {
      releaseBarrier();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  it('allows distinct runs to claim workers concurrently', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'alix-distinct-runs-'));
    const store = new CoordinationStore(cwd);
    let active = 0;
    let maxActive = 0;
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    let bothStarted!: () => void;
    const started = new Promise<void>(resolve => { bothStarted = resolve; });
    let startedCount = 0;
    const scheduler = new CoordinationScheduler({
      cwd, daemonInstanceId: 'distinct-run-test', store,
      configProvider: async () => ({ permissions: { sessionMode: 'bypass' } }) as any,
      authorization: { evaluate: async () => ({ status: 'allowed' }) } as any,
      ownershipRegistry: { acquireMany: async () => [], release: async () => true, renew: async () => true } as any,
      executor: { execute: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        if (++startedCount === 2) bothStarted();
        await hold;
        active--;
        return { outcome: 'success', summary: 'ok' };
      } } as any,
    }, { maxConcurrency: 2 });
    try {
      const runIds: string[] = [];
      for (let i = 0; i < 2; i++) {
        const run = createCoordinationRun({ sessionId: `s${i}`, rootGoal: 'independent', coordinatorAgentId: 'alix' });
        await store.save(run);
        await store.addWorker(run.id, createWorkerAssignment({ coordinationRunId: run.id, agentId: `worker${i}`, taskLabel: 'independent', goalPrompt: 'test', requiredCapabilities: ['task.do'], attempt: 0, maxAttempts: 3 }));
        runIds.push(run.id);
      }
      const ticks = Promise.all(runIds.map(id => scheduler.tick(id)));
      await Promise.race([started, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('distinct runs were serialized')), 6000))]);
      assert.equal(maxActive, 2);
      release();
      const results = await ticks;
      assert.equal(results.flatMap(result => result.dispatched).length, 2);
      await scheduler.shutdown();
    } finally {
      release();
      await scheduler.shutdown();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('claims a worker once across two separate OS processes', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'alix-cross-process-'));
    const store = new CoordinationStore(cwd);
    try {
      const run = createCoordinationRun({ sessionId: 'cross', rootGoal: 'cross process', coordinatorAgentId: 'alix' });
      await store.save(run);
      const worker = createWorkerAssignment({ coordinationRunId: run.id, agentId: 'w', taskLabel: 'claim', goalPrompt: 'test', requiredCapabilities: ['task.do'], attempt: 0, maxAttempts: 3 });
      await store.addWorker(run.id, worker);
      const child = () => new Promise<{ claimed: boolean }>((resolve, reject) => {
        const process = spawn(join(globalThis.process.cwd(), 'node_modules/.bin/tsx'),
          [join(globalThis.process.cwd(), 'tests/kernel/coordination-claim-child.ts'), cwd, run.id, worker.id],
          { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = ''; let stderr = '';
        process.stdout.on('data', data => { stdout += data; });
        process.stderr.on('data', data => { stderr += data; });
        process.on('error', reject);
        process.on('close', code => {
          if (code !== 0) return reject(new Error(`claim child exited ${code}: ${stderr}`));
          try { resolve(JSON.parse(stdout.trim())); } catch (error) { reject(error); }
        });
      });
      const claims = await Promise.all([child(), child()]);
      assert.deepEqual(claims.map(c => c.claimed).sort(), [false, true]);
      const final = await store.load(run.id);
      assert.equal(final?.workers[0]?.status, 'running');
      assert.equal(final?.workers[0]?.attempt, 1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('rejects a claim after cancellation has committed', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'alix-cancel-claim-'));
    const store = new CoordinationStore(cwd);
    try {
      const run = createCoordinationRun({ sessionId: 'cancel', rootGoal: 'cancel before claim', coordinatorAgentId: 'alix' });
      await store.save(run);
      const worker = createWorkerAssignment({ coordinationRunId: run.id, agentId: 'w', taskLabel: 'cancel', goalPrompt: 'test', requiredCapabilities: ['task.do'], attempt: 0, maxAttempts: 3 });
      await store.addWorker(run.id, worker);
      await store.patchWorker(run.id, worker.id, { status: 'cancelled' });
      const before = getSharedLedger(cwd).entityVersion(run.id);
      assert.equal(await store.claimPendingWorker(run.id, worker.id, 0, {}), false);
      assert.equal(getSharedLedger(cwd).entityVersion(run.id), before);
      const final = await store.load(run.id);
      assert.equal(final?.workers[0]?.status, 'cancelled');
      assert.equal(final?.workers[0]?.attempt, 0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('does not dispatch when cancellation commits during an in-flight tick', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'alix-cancel-race-'));
    const store = new CoordinationStore(cwd);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const atGate = new Promise<void>(resolve => { entered = resolve; });
    let executions = 0;
    const scheduler = new CoordinationScheduler({
      cwd, daemonInstanceId: 'cancel-race', store,
      configProvider: async () => { entered(); await gate; return { permissions: { sessionMode: 'bypass' } } as any; },
      authorization: { evaluate: async () => ({ status: 'allowed' }) } as any,
      ownershipRegistry: { acquireMany: async () => [], release: async () => true, renew: async () => true } as any,
      executor: { execute: async () => { executions++; return { outcome: 'success' }; } } as any,
    }, { maxConcurrency: 1 });
    try {
      const run = createCoordinationRun({ sessionId: 'cancel-race', rootGoal: 'cancel during tick', coordinatorAgentId: 'alix' });
      await store.save(run);
      const worker = createWorkerAssignment({ coordinationRunId: run.id, agentId: 'w', taskLabel: 'cancel race', goalPrompt: 'test', requiredCapabilities: ['task.do'], attempt: 0, maxAttempts: 3 });
      await store.addWorker(run.id, worker);
      const tick = scheduler.tick(run.id);
      await atGate;
      await scheduler.cancelRun(run.id);
      release();
      const result = await tick;
      await scheduler.shutdown();
      assert.equal(executions, 0, 'cancelled worker must never start execution');
      assert.deepEqual(result.dispatched, []);
      const final = await store.load(run.id);
      assert.equal(final?.workers[0]?.status, 'cancelled');
    } finally {
      release();
      await scheduler.shutdown();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('preserves cancellation after a worker has been claimed and execution has started', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'alix-cancel-after-claim-'));
    const store = new CoordinationStore(cwd);
    let started!: () => void;
    const atExecution = new Promise<void>(resolve => { started = resolve; });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let executions = 0;
    const scheduler = new CoordinationScheduler({
      cwd, daemonInstanceId: 'cancel-after-claim', store,
      configProvider: async () => ({ permissions: { sessionMode: 'bypass' } }) as any,
      authorization: { evaluate: async () => ({ status: 'allowed' }) } as any,
      ownershipRegistry: { acquireMany: async () => [], release: async () => true, renew: async () => true } as any,
      executor: { execute: async () => {
        executions++;
        started();
        await gate;
        return { outcome: 'success' };
      } } as any,
    }, { maxConcurrency: 1 });
    try {
      const run = createCoordinationRun({ sessionId: 'cancel-after', rootGoal: 'cancel after claim', coordinatorAgentId: 'alix' });
      await store.save(run);
      const worker = createWorkerAssignment({ coordinationRunId: run.id, agentId: 'w', taskLabel: 'cancel after claim', goalPrompt: 'test', requiredCapabilities: ['task.do'], attempt: 0, maxAttempts: 3 });
      await store.addWorker(run.id, worker);
      const tick = scheduler.tick(run.id);
      await atExecution;
      assert.equal((await store.load(run.id))?.workers[0]?.status, 'running');
      await scheduler.cancelRun(run.id);
      release();
      await tick;
      await scheduler.shutdown();
      const final = await store.load(run.id);
      assert.equal(executions, 1);
      assert.equal(final?.workers[0]?.status, 'cancelled');
      assert.equal(final?.workers[0]?.attempt, 1);
    } finally {
      release();
      await scheduler.shutdown();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('reclaims a dead execution owner then redispatches within the attempt budget', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'alix-restart-reclaim-'));
    const store = new CoordinationStore(cwd);
    let executions = 0;
    const scheduler = new CoordinationScheduler({
      cwd, daemonInstanceId: `cli-${process.pid}`, store,
      configProvider: async () => ({ permissions: { sessionMode: 'bypass' } }) as any,
      authorization: { evaluate: async () => ({ status: 'allowed' }) } as any,
      ownershipRegistry: { acquireMany: async () => [], release: async () => true, renew: async () => true } as any,
      executor: { execute: async () => { executions++; return { outcome: 'success', summary: 'recovered' }; } } as any,
    }, { maxConcurrency: 1 });
    try {
      const run = createCoordinationRun({ sessionId: 'restart', rootGoal: 'reclaim', coordinatorAgentId: 'alix' });
      await store.save(run);
      const worker = createWorkerAssignment({ coordinationRunId: run.id, agentId: 'w', taskLabel: 'reclaim', goalPrompt: 'test', requiredCapabilities: ['task.do'], status: 'running', attempt: 1, maxAttempts: 3, executionOwnerId: 'cli-99999999', lastHeartbeatAt: new Date(Date.now() - 120000).toISOString() });
      await store.addWorker(run.id, worker);
      const result = await scheduler.tick(run.id);
      for (let i = 0; i < 40; i++) {
        if ((await store.load(run.id))?.workers[0]?.status === 'completed') break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.deepEqual(result.recoveredOrphans, [worker.id]);
      assert.equal(executions, 1);
      const final = await store.load(run.id);
      assert.equal(final?.workers[0]?.status, 'completed');
      assert.equal(final?.workers[0]?.attempt, 2, 'one failed execution plus one recovered execution');
    } finally {
      await scheduler.shutdown();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('recovers a worker durably claimed by a real child process that has exited', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'alix-real-child-recovery-'));
    const store = new CoordinationStore(cwd);
    let executions = 0;
    const scheduler = new CoordinationScheduler({
      cwd, daemonInstanceId: `cli-${process.pid}`, store,
      configProvider: async () => ({ permissions: { sessionMode: 'bypass' } }) as any,
      authorization: { evaluate: async () => ({ status: 'allowed' }) } as any,
      ownershipRegistry: { acquireMany: async () => [], release: async () => true, renew: async () => true } as any,
      executor: { execute: async () => { executions++; return { outcome: 'success', summary: 'recovered child' }; } } as any,
    }, { maxConcurrency: 1 });
    try {
      const run = createCoordinationRun({ sessionId: 'real-child', rootGoal: 'recover exited child', coordinatorAgentId: 'alix' });
      await store.save(run);
      const worker = createWorkerAssignment({ coordinationRunId: run.id, agentId: 'w', taskLabel: 'recover child', goalPrompt: 'test', requiredCapabilities: ['task.do'], attempt: 0, maxAttempts: 3 });
      await store.addWorker(run.id, worker);
      const child = spawn(join(process.cwd(), 'node_modules/.bin/tsx'),
        [join(process.cwd(), 'tests/kernel/coordination-claim-child.ts'), cwd, run.id, worker.id],
        { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
      });
      assert.equal(exitCode, 0, stderr);
      assert.equal(JSON.parse(stdout.trim()).claimed, true);
      const claimed = await store.load(run.id);
      assert.equal(claimed?.workers[0]?.status, 'running');
      assert.match(claimed?.workers[0]?.executionOwnerId ?? '', /^cli-\d+$/);
      const tick = await scheduler.tick(run.id);
      assert.deepEqual(tick.recoveredOrphans, [worker.id]);
      for (let i = 0; i < 40; i++) {
        if ((await store.load(run.id))?.workers[0]?.status === 'completed') break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const final = await store.load(run.id);
      assert.equal(executions, 1);
      assert.equal(final?.workers[0]?.status, 'completed');
      assert.equal(final?.workers[0]?.attempt, 2);
    } finally {
      await scheduler.shutdown();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

});
