import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { ContinuationStore } from '../../src/runtime-state/runtime/continuation-store.js';
import { CoordinationStore } from '../../src/coordination/kernel/coordination-store.js';
import { createCoordinationRun, createWorkerAssignment } from '../../src/coordination/kernel/coordination-types.js';
import { bindWorkerToolContinuation } from '../../src/coordination/kernel/worker-tool-continuation.js';
import { createToolExecutor } from '../../src/capabilities/tools/tool-executor-factory.js';
import { EventLog } from '../../src/runtime-state/events/event-log.js';
import { captureWorkerEventLog } from '../../src/coordination/kernel/default-worker-review.js';
import { OwnershipRegistry } from '../../src/coordination/ownership/ownership-registry.js';
import { DEFAULT_CONFIG } from '../../src/operations/config/defaults.js';
import { DaemonToolContinuationResumer } from '../../src/operations/daemon/tool-continuation-resumer.js';
import { CoordinationScheduler } from '../../src/coordination/kernel/coordination-scheduler.js';
import { CoordinationRunLock } from '../../src/coordination/kernel/coordination-run-lock.js';
import type { ExecutionAuthorization } from '../../src/runtime-state/runtime/execution-authorization.js';
import { waitUntil } from '../helpers/wait-until.js';
import { ApprovalWatcher } from '../../src/operations/daemon/approval-watcher.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

const dirs: string[] = [];
afterEach(async () => { closeAllSharedLedgers(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture(path = 'owned.txt') {
  const cwd = await mkdtemp(join(tmpdir(), 'alix-d9-')); dirs.push(cwd);
  const config = structuredClone(DEFAULT_CONFIG);
  config.permissions.sessionMode = 'ask';
  config.permissions.tools = { 'file.create': 'ask' };
  const approvals = new ApprovalStore(cwd); await approvals.load();
  const log = new EventLog(join(cwd, '.alix/sessions/session-d9')); await log.init();
  const captured = captureWorkerEventLog(log);
  const executor = createToolExecutor({ config, log: captured.log, root: cwd, approvalStore: approvals });
  const request = { toolCallId: 'call-d9', name: 'file.create', args: { path, content: 'approved operation' }, agentId: 'canonical-agent' };
  const blocked = await executor.execute(request);
  expect(blocked.kind).toBe('denied');
  const approval = approvals.findByRequestId(request.toolCallId)!;
  expect(approval.status).toBe('pending');
  const run = createCoordinationRun({ sessionId: 'session-d9', rootGoal: 'write owned.txt', coordinatorAgentId: 'coordinator' });
  run.hostKind = 'daemon';
  const worker = createWorkerAssignment({ coordinationRunId: run.id, agentId: 'canonical-agent', taskLabel: 'writer', goalPrompt: 'write owned.txt',
    requiredCapabilities: ['file.create'], attempt: 1, ownershipScopes: ['owned.txt'], ownershipClaims: [{ path: 'owned.txt', recursive: false }],
    status: 'blocked', blockReason: 'approval_required', approvalId: approval.id });
  run.workers = [worker]; run.status = 'blocked';
  const runs = new CoordinationStore(cwd); await runs.save(run);
  expect(await bindWorkerToolContinuation(run.sessionId, worker, captured.events, () => executor)).toBe(approval.id);
  const createResumer = () => new DaemonToolContinuationResumer(cwd, config, runs, approvals, new OwnershipRegistry(cwd), async () => {
    const resumedLog = new EventLog(join(cwd, '.alix/sessions/session-d9'));
    await resumedLog.init(); return resumedLog;
  });
  return { cwd, config, approvals, approval, runs, run, worker, executor, captured, createResumer };
}

describe('D9 daemon continuation acceptance', () => {
  it('the scheduler records an executor approval pause as blocked, never a terminal failure', async () => {
    const f = await fixture();
    await f.runs.patchWorker(f.run.id, f.worker.id, { status: 'pending', approvalId: undefined, blockReason: undefined });
    const scheduler = new CoordinationScheduler({ cwd: f.cwd, daemonInstanceId: `daemon-${process.pid}`,
      configProvider: async () => f.config, store: f.runs, ownershipRegistry: new OwnershipRegistry(f.cwd),
      authorization: { evaluate: async () => ({ status: 'allowed' }) } as unknown as ExecutionAuthorization,
      executor: { execute: async () => ({ outcome: 'failure', failureKind: 'approval_required', approvalId: f.approval.id }) },
    });
    try {
      await scheduler.tick(f.run.id);
      await waitUntil(async () => (await f.runs.load(f.run.id))?.workers[0].status === 'blocked');
      const run = await f.runs.load(f.run.id);
      expect(run?.status).toBe('blocked');
      expect(run?.workers[0]).toMatchObject({ failureKind: 'approval_required', approvalId: f.approval.id });
      await scheduler.tick(f.run.id);
      expect((await f.runs.load(f.run.id))?.workers[0].status).toBe('blocked');
    } finally { await scheduler.shutdown(); }
  });

  it('watcher resumes the approved exact tool once after host reconstruction and requeues the worker', async () => {
    const f = await fixture();
    const operator = new ApprovalStore(f.cwd); await operator.load(); await operator.resolve(f.approval.id, 'approved');
    const resumer = f.createResumer();
    const watcher = new ApprovalWatcher(f.cwd, undefined, { resumeApproved: id => resumer.resumeApproved(id) });
    await watcher.scan();
    expect(await readFile(join(f.cwd, 'owned.txt'), 'utf8')).toBe('approved operation');
    expect(await f.approvals.loadFresh(f.approval.id)).toMatchObject({ status: 'consumed', executionOutcome: 'succeeded',
      consumedByWorkerId: f.worker.id, consumedAttempt: 1, agentId: 'canonical-agent', bindingKey: f.approval.bindingKey,
      invocationFingerprint: f.approval.invocationFingerprint });
    expect((await f.runs.load(f.run.id))?.workers[0]).toMatchObject({ status: 'pending', attempt: 1 });
    const conts = new ContinuationStore(f.cwd); await conts.load(); expect(conts.list()).toHaveLength(0);
    await watcher.scan(); await f.createResumer().resumeApproved(f.approval.id);
    expect((await f.approvals.loadFresh(f.approval.id))?.executionOutcome).toBe('succeeded');
    expect((await f.runs.load(f.run.id))?.workers[0].status).toBe('pending');
    expect(await new OwnershipRegistry(f.cwd).listActive()).toHaveLength(0);
    await resumer.shutdown();
  });

  it('does not leave a successfully consumed approval stranded on a blocked worker after reconstruction', async () => {
    const f = await fixture();
    await f.approvals.resolve(f.approval.id, 'approved');
    const original = f.createResumer();
    await original.resumeApproved(f.approval.id);
    expect(await f.approvals.loadFresh(f.approval.id)).toMatchObject({ status: 'consumed', executionOutcome: 'succeeded' });
    await f.runs.patchWorker(f.run.id, f.worker.id, { status: 'blocked', blockReason: 'approval_required', approvalId: f.approval.id });
    const before = await stat(join(f.cwd, 'owned.txt'));
    await rm(join(f.cwd, '.alix/sessions/session-d9/events.jsonl'));
    closeAllSharedLedgers();
    const reconstructed = f.createResumer();
    const watcher = new ApprovalWatcher(f.cwd, undefined, { resumeApproved: id => reconstructed.resumeApproved(id) });
    // A crashed execution host may leave its lock behind; repair cannot wait
    // for lease/lock expiry because it never enters execution.
    const staleExecution = new CoordinationRunLock(f.cwd, `tool-continuation-${f.approval.id}`);
    expect(await staleExecution.acquire()).toBe(true);
    try { await watcher.scan(); } finally { staleExecution.release(); }
    await reconstructed.resumeApproved(f.approval.id);
    expect((await f.runs.load(f.run.id))?.workers[0]).toMatchObject({ status: 'pending', attempt: 1 });
    expect(await readFile(join(f.cwd, 'owned.txt'), 'utf8')).toBe('approved operation');
    expect((await stat(join(f.cwd, 'owned.txt'))).mtimeMs).toBe(before.mtimeMs);
    await expect(readFile(join(f.cwd, '.alix/sessions/session-d9/events.jsonl'))).rejects.toThrow();
    await Promise.all([original.shutdown(), reconstructed.shutdown()]);
  });

  it('recovers an actual post-outcome worker-update failure without a tool replay', async () => {
    const f = await fixture();
    await f.approvals.resolve(f.approval.id, 'approved');
    const original = f.createResumer();
    const update = vi.spyOn(f.runs, 'updateRun').mockRejectedValueOnce(new Error('crash after outcome commit'));
    await expect(original.resumeApproved(f.approval.id)).rejects.toThrow('crash after outcome commit');
    update.mockRestore();
    expect((await f.runs.load(f.run.id))?.workers[0].status).toBe('blocked');
    expect(f.approvals.loadCommitted(f.approval.id)?.executionOutcome).toBe('succeeded');
    const before = await stat(join(f.cwd, 'owned.txt'));
    const a = f.createResumer(), b = f.createResumer();
    await Promise.all([a.resumeApproved(f.approval.id), b.resumeApproved(f.approval.id)]);
    expect((await f.runs.load(f.run.id))?.workers[0].status).toBe('pending');
    expect((await stat(join(f.cwd, 'owned.txt'))).mtimeMs).toBe(before.mtimeMs);
    await Promise.all([original.shutdown(), a.shutdown(), b.shutdown()]);
  });

  // Explicit outcome/identity/host parity for consumed recovery, independent of
  // tool telemetry and the removed continuation. Only the positive control moves.
  for (const fault of ['none', 'pending', 'unverified', 'failed', 'cancelled', 'missing-outcome',
    'revoked', 'missing-context', 'context-run', 'context-worker', 'context-attempt', 'context-fingerprint',
    'consumer-worker', 'consumer-attempt', 'missing-consumer', 'record-run', 'record-worker', 'record-attempt',
    'missing-fingerprint', 'args', 'capability', 'agent', 'session', 'workspace',
    'host', 'run-cancelled', 'worker-cancelled', 'worker-running', 'worker-run', 'attempt', 'claims', 'scopes', 'shutdown']) {
    it(`consumed recovery parity: ${fault}`, async () => {
      const f = await fixture();
      await f.approvals.resolve(f.approval.id, 'approved');
      const original = f.createResumer();
      await original.resumeApproved(f.approval.id);
      await original.shutdown();
      await f.runs.patchWorker(f.run.id, f.worker.id, { status: 'blocked', blockReason: 'approval_required', approvalId: f.approval.id });
      await f.approvals.mutate(records => {
        const record = records.find(r => r.id === f.approval.id)!;
        if (['pending', 'unverified', 'failed', 'cancelled'].includes(fault)) record.executionOutcome = fault as 'pending' | 'unverified' | 'failed' | 'cancelled';
        if (fault === 'missing-outcome') delete record.executionOutcome;
        if (fault === 'revoked') record.status = 'revoked';
        if (fault === 'missing-context') delete record.toolContinuation;
        if (fault === 'context-run') record.toolContinuation!.runId = 'another-run';
        if (fault === 'context-worker') record.toolContinuation!.workerId = 'another-worker';
        if (fault === 'context-attempt') record.toolContinuation!.attempt++;
        if (fault === 'context-fingerprint') record.toolContinuation!.invocationFingerprint = 'different';
        if (fault === 'consumer-worker') record.consumedByWorkerId = 'another-worker';
        if (fault === 'consumer-attempt') record.consumedAttempt = 2;
        if (fault === 'missing-consumer') delete record.consumedByWorkerId;
        if (fault === 'record-run') record.coordinationRunId = 'another-run';
        if (fault === 'record-worker') record.workerId = 'another-worker';
        if (fault === 'record-attempt') record.workerAttempt = 2;
        if (fault === 'missing-fingerprint') delete record.invocationFingerprint;
        if (fault === 'args') record.invocation!.argsHash = 'different';
        if (fault === 'capability') record.invocation!.capability = 'shell.run';
        if (fault === 'agent') record.invocation!.agentId = 'another-agent';
        if (fault === 'session') record.invocation!.sessionId = 'another-session';
        if (fault === 'workspace') record.invocation!.workspace = join(f.cwd, 'elsewhere');
      });
      await f.runs.updateRun(f.run.id, run => {
        if (fault === 'host') run.hostKind = 'inspector';
        if (fault === 'run-cancelled') run.status = 'cancelled';
        if (fault === 'worker-cancelled') run.workers[0].status = 'cancelled';
        if (fault === 'worker-running') run.workers[0].status = 'running';
        if (fault === 'worker-run') run.workers[0].coordinationRunId = 'another-run';
        if (fault === 'attempt') run.workers[0].attempt++;
        if (fault === 'claims') run.workers[0].ownershipClaims = [{ path: 'other.txt', recursive: false }];
        if (fault === 'scopes') run.workers[0].ownershipScopes = ['other.txt'];
      });
      const before = (await f.runs.load(f.run.id))!.workers[0];
      const effect = await stat(join(f.cwd, 'owned.txt'));
      const resumer = f.createResumer();
      if (fault === 'shutdown') await resumer.shutdown();
      await resumer.resumeApproved(f.approval.id);
      const after = (await f.runs.load(f.run.id))!.workers[0];
      if (fault === 'none') expect(after).toMatchObject({ status: 'pending', attempt: 1 });
      else expect(after).toEqual(before);
      expect((await stat(join(f.cwd, 'owned.txt'))).mtimeMs).toBe(effect.mtimeMs);
      await resumer.shutdown();
    });
  }

  it('a projection-only success is insufficient recovery authority', async () => {
    const f = await fixture();
    await f.approvals.resolve(f.approval.id, 'approved');
    const original = f.createResumer(); await original.resumeApproved(f.approval.id); await original.shutdown();
    const fake = { ...f.approvals.loadCommitted(f.approval.id)!, id: 'projection-only' };
    await f.runs.patchWorker(f.run.id, f.worker.id, { status: 'blocked', blockReason: 'approval_required', approvalId: fake.id });
    await writeFile(join(f.cwd, '.alix/approvals/approvals.json'), JSON.stringify({ approvals: [fake], groups: [] }));
    const resumer = f.createResumer(); await resumer.resumeApproved(fake.id);
    expect((await f.runs.load(f.run.id))?.workers[0].status).toBe('blocked');
    expect(f.approvals.loadCommitted(fake.id)).toBeUndefined();
    await resumer.shutdown();
  });

  it('a consumed failed operation updates worker failure without retrying its approval', async () => {
    const f = await fixture();
    await mkdir(join(f.cwd, 'owned.txt'));
    await f.approvals.resolve(f.approval.id, 'approved');
    const resumer = f.createResumer();
    await resumer.resumeApproved(f.approval.id);
    expect(await f.approvals.loadFresh(f.approval.id)).toMatchObject({ status: 'consumed', executionOutcome: 'failed' });
    expect((await f.runs.load(f.run.id))?.workers[0]).toMatchObject({ status: 'failed', failureKind: 'execution_error' });
    await resumer.resumeApproved(f.approval.id);
    expect((await f.runs.load(f.run.id))?.workers[0].status).toBe('failed');
    await resumer.shutdown();
  });

  // Parity includes positive control, worker/run/attempt/scope/host identity,
  // denied/pending authority, altered invocation, and concurrent replay.
  for (const fault of ['pending', 'denied', 'cancelled', 'host', 'worker', 'attempt', 'claims', 'scopes', 'args', 'agent', 'session', 'workspace', 'unattributed', 'out-of-scope', 'lease-conflict', 'shutdown']) {
    it(`never widens authorization: ${fault}`, async () => {
      const f = await fixture(fault === 'out-of-scope' ? 'outside.txt' : 'owned.txt');
      if (fault !== 'pending') await f.approvals.resolve(f.approval.id, fault === 'denied' ? 'denied' : 'approved');
      if (['cancelled', 'host', 'worker', 'attempt', 'claims', 'scopes'].includes(fault)) await f.runs.updateRun(f.run.id, run => {
        if (fault === 'cancelled') { run.status = 'cancelled'; run.workers[0].status = 'cancelled'; }
        if (fault === 'host') run.hostKind = 'inspector';
        if (fault === 'worker') run.workers[0].id = 'different-worker';
        if (fault === 'attempt') run.workers[0].attempt++;
        if (fault === 'claims') run.workers[0].ownershipClaims = [{ path: 'outside.txt', recursive: false }];
        if (fault === 'scopes') run.workers[0].ownershipScopes = ['outside.txt'];
      });
      if (['args', 'agent', 'session', 'workspace', 'unattributed'].includes(fault)) {
        const store = new ContinuationStore(f.cwd); await store.load();
        const cont = store.list()[0];
        if (fault === 'args') cont.toolCall!.args.content = 'tampered';
        else if (fault === 'agent') cont.toolCall!.agentId = 'another-agent';
        else if (fault === 'session') cont.sessionId = 'another-session';
        else if (fault === 'workspace') cont.cwd = join(f.cwd, 'another-workspace');
        else delete cont.coordinationWorker;
        await store.persist(cont);
      }
      if (fault === 'lease-conflict') await new OwnershipRegistry(f.cwd).acquire({
        agentId: 'other-worker', scope: { kind: 'path', root: join(f.cwd, 'owned.txt'), recursive: false }, mode: 'exclusive-write',
      });
      const resumer = f.createResumer();
      if (fault === 'shutdown') await resumer.shutdown();
      await resumer.resumeApproved(f.approval.id);
      await expect(readFile(join(f.cwd, fault === 'out-of-scope' ? 'outside.txt' : 'owned.txt'))).rejects.toThrow();
      expect((await f.approvals.loadFresh(f.approval.id))?.status).toBe(fault === 'pending' ? 'pending' : fault === 'denied' ? 'denied' : 'approved');
      expect((await f.runs.load(f.run.id))?.workers[0].status).toBe(fault === 'cancelled' ? 'cancelled' : fault === 'denied' ? 'failed' : 'blocked');
      await resumer.shutdown();
    });
  }
  it('concurrent hosts cannot both execute one continuation', async () => {
    const f = await fixture(); await f.approvals.resolve(f.approval.id, 'approved');
    const a = f.createResumer(), b = f.createResumer();
    await Promise.all([a.resumeApproved(f.approval.id), b.resumeApproved(f.approval.id)]);
    expect((await f.approvals.loadFresh(f.approval.id))?.executionOutcome).toBe('succeeded');
    expect((await f.runs.load(f.run.id))?.workers[0].status).toBe('pending');
    const events = await readFile(join(f.cwd, '.alix/sessions/session-d9/events.jsonl'), 'utf8');
    expect(events.split('\n').filter(line => line && JSON.parse(line).type === 'file.created')).toHaveLength(1);
    await Promise.all([a.shutdown(), b.shutdown()]);
  });
});
