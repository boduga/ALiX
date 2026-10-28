import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { ContinuationStore } from '../../src/runtime-state/runtime/continuation-store.js';
import { CoordinationStore } from '../../src/coordination/kernel/coordination-store.js';
import { createCoordinationRun, createWorkerAssignment } from '../../src/coordination/kernel/coordination-types.js';
import { bindWorkerToolContinuation } from '../../src/coordination/kernel/worker-tool-continuation.js';
import { captureWorkerEventLog } from '../../src/coordination/kernel/default-worker-review.js';
import { createToolExecutor } from '../../src/capabilities/tools/tool-executor-factory.js';
import { EventLog } from '../../src/runtime-state/events/event-log.js';
import { DEFAULT_CONFIG } from '../../src/operations/config/defaults.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

async function seed(cwd: string) {
  const config = structuredClone(DEFAULT_CONFIG);
  config.permissions.sessionMode = 'ask'; config.permissions.tools = { 'file.create': 'ask' };
  const approvals = new ApprovalStore(cwd); await approvals.load();
  const log = new EventLog(join(cwd, '.alix/sessions/d9-kill')); await log.init();
  try {
    const captured = captureWorkerEventLog(log);
    const executor = createToolExecutor({ config, log: captured.log, root: cwd, approvalStore: approvals });
    assert.equal((await executor.execute({ toolCallId: 'kill-call', name: 'file.create',
      args: { path: 'owned.txt', content: 'D9 real resumer effect\n' }, agentId: 'kill-agent' })).kind, 'denied');
    const approval = approvals.findByRequestId('kill-call')!;
    assert.equal(approval.status, 'pending');
    const run = createCoordinationRun({ sessionId: 'd9-kill', rootGoal: 'write owned.txt', coordinatorAgentId: 'coordinator' });
    run.hostKind = 'daemon'; run.status = 'blocked';
    const worker = createWorkerAssignment({ coordinationRunId: run.id, agentId: 'assigned-agent', taskLabel: 'writer',
      goalPrompt: 'write owned.txt', requiredCapabilities: ['file.create'], attempt: 1,
      ownershipScopes: ['owned.txt'], ownershipClaims: [{ path: 'owned.txt', recursive: false }],
      status: 'blocked', blockReason: 'approval_required', approvalId: approval.id });
    run.workers = [worker]; await new CoordinationStore(cwd).save(run);
    assert.equal(await bindWorkerToolContinuation(run.sessionId, worker, captured.events, () => executor), approval.id);
    await approvals.resolve(approval.id, 'approved');
    return { approvalId: approval.id, runId: run.id, workerId: worker.id };
  } finally { await log.close(); closeAllSharedLedgers(); }
}

function host(cwd: string, approvalId: string, point: string) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../fixtures/d9-resumer-crash-child.js', import.meta.url)), cwd, approvalId, point], {
    cwd, env: { PATH: process.env.PATH, HOME: cwd, XDG_CONFIG_HOME: join(cwd, '.config') },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stderr = '', observed = false;
  child.stdout!.on('data', data => { stderr += String(data); });
  child.stderr!.on('data', data => { stderr += String(data); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const ready = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No ${point} checkpoint: ${stderr}`)), 20_000);
    child.on('message', message => {
      const data = message as { checkpoint: string; pid: number };
      if (data.checkpoint === (point === 'recover' ? 'recovered' : point)) {
        observed = true; clearTimeout(timer); resolve(data.pid);
      }
    });
    void exited.then(result => { clearTimeout(timer); if (!observed) reject(new Error(`Host exited before ${point}: ${JSON.stringify(result)} ${stderr}`)); }, error => { clearTimeout(timer); reject(error); });
  });
  return { child, exited, ready };
}

async function snapshot(cwd: string, f: Awaited<ReturnType<typeof seed>>) {
  closeAllSharedLedgers();
  const approvals = new ApprovalStore(cwd); await approvals.load();
  const conts = new ContinuationStore(cwd); await conts.load();
  return {
    approval: approvals.loadCommitted(f.approvalId)!,
    worker: (await new CoordinationStore(cwd).load(f.runId))!.workers[0],
    continuation: conts.findByApprovalId(f.approvalId),
    effect: await readFile(join(cwd, 'owned.txt'), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; }),
    entries: await readFile(join(cwd, 'router-entries.jsonl'), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; }),
    mtime: await stat(join(cwd, 'owned.txt')).then(s => s.mtimeMs, error => { if (error.code === 'ENOENT') return null; throw error; }),
  };
}

for (const scenario of ['before-resume', 'after-tombstone', 'after-consume', 'after-effect', 'after-receipt', 'reassigned-after-receipt']) {
  const reassigned = scenario === 'reassigned-after-receipt';
  const point = reassigned ? 'after-receipt' : scenario;
  test(`D9 actual resumer SIGKILL: ${scenario}`, { timeout: 60_000 }, async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'd9-resumer-kill-'));
    const hosts: ReturnType<typeof host>[] = [];
    try {
      const f = await seed(cwd);
      const first = host(cwd, f.approvalId, point); hosts.push(first);
      const killedPid = await first.ready;
      assert.equal(first.child.kill('SIGKILL'), true);
      assert.equal((await first.exited).signal, 'SIGKILL');
      if (reassigned) await new CoordinationStore(cwd).patchWorker(f.runId, f.workerId, { agentId: 'replacement' });
      const before = await snapshot(cwd, f);
      const spent = ['after-consume', 'after-effect', 'after-receipt'].includes(point);
      const effected = ['after-effect', 'after-receipt'].includes(point);
      assert.equal(before.approval.status, spent ? 'consumed' : 'approved');
      assert.equal(before.approval.executionOutcome, point === 'after-receipt' ? 'succeeded' : spent ? 'pending' : undefined);
      assert.equal(Boolean(before.continuation), point === 'before-resume');
      assert.equal(before.worker.status, 'blocked');
      assert.equal(before.effect, effected ? 'D9 real resumer effect\n' : null);
      assert.equal(before.entries.trim().split('\n').filter(Boolean).length, effected ? 1 : 0);
      if (spent) {
        assert.equal(before.approval.consumedByWorkerId, f.workerId);
        assert.equal(before.approval.consumedAttempt, 1);
      }
      // Two fresh OS hosts, each running two watcher scans + direct resumes.
      for (let i = 0; i < 2; i++) {
        closeAllSharedLedgers();
        const next = host(cwd, f.approvalId, 'recover'); hosts.push(next);
        assert.notEqual(await next.ready, killedPid);
        assert.deepEqual(await next.exited, { code: 0, signal: null });
      }
      const after = await snapshot(cwd, f);
      assert.equal(after.worker.status, !reassigned && ['before-resume', 'after-receipt'].includes(point) ? 'pending' : 'blocked');
      assert.equal(after.worker.attempt, 1);
      if (point === 'before-resume') {
        assert.equal(after.approval.executionOutcome, 'succeeded');
        assert.equal(after.continuation, undefined);
        assert.equal(after.effect, 'D9 real resumer effect\n');
        assert.equal(after.entries.trim().split('\n').length, 1);
      } else {
        assert.deepEqual(after.approval, before.approval, 'uncertain outcomes stay pending; silence must not synthesize success');
        assert.equal(after.continuation, undefined);
        assert.equal(after.effect, before.effect);
        assert.equal(after.entries, before.entries, 'no router re-entry, even if file.create would be idempotent');
        assert.equal(after.mtime, before.mtime);
        if (point !== 'after-receipt' || reassigned) assert.deepEqual(after.worker, before.worker);
      }
    } finally {
      for (const h of hosts) {
        if (h.child.exitCode === null && h.child.signalCode === null) h.child.kill('SIGKILL');
        await h.exited;
      }
      closeAllSharedLedgers(); await rm(cwd, { recursive: true, force: true });
    }
  });
}


test('D9 recovery rechecks reassignment under the run lock after initial eligibility', { timeout: 60_000 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'd9-recovery-assignment-'));
  const hosts: ReturnType<typeof host>[] = [];
  try {
    const f = await seed(cwd);
    const first = host(cwd, f.approvalId, 'after-receipt'); hosts.push(first);
    await first.ready; first.child.kill('SIGKILL'); await first.exited;
    const recovering = host(cwd, f.approvalId, 'recover-before-lock'); hosts.push(recovering);
    await recovering.ready; // initial eligibility has passed; updateRun has not acquired its lock
    await new CoordinationStore(cwd).patchWorker(f.runId, f.workerId, { agentId: 'replacement' });
    const before = await snapshot(cwd, f);
    recovering.child.send({ continue: true });
    assert.deepEqual(await recovering.exited, { code: 0, signal: null });
    const after = await snapshot(cwd, f);
    assert.deepEqual(after, before, 'no stale requeue, receipt rewrite or router re-entry');
  } finally {
    for (const h of hosts) {
      if (h.child.exitCode === null && h.child.signalCode === null) h.child.kill('SIGKILL');
      await h.exited;
    }
    closeAllSharedLedgers(); await rm(cwd, { recursive: true, force: true });
  }
});
