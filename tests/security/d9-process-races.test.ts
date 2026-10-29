import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OwnershipRegistry } from '../../src/coordination/ownership/ownership-registry.js';
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

function host(cwd: string, approvalId: string, mode: string) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../fixtures/d9-process-race-child.js', import.meta.url)), cwd, approvalId, mode], {
    cwd, env: { PATH: process.env.PATH, HOME: cwd, XDG_CONFIG_HOME: join(cwd, '.config') }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  type Message = { event: string; pid: number; consumed?: boolean; cancelled?: boolean };
  const messages: Message[] = [];
  let output = '', ended = false;
  child.stdout!.on('data', data => { output += data; }); child.stderr!.on('data', data => { output += data; });
  child.on('message', message => messages.push(message as Message));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code, signal) => { ended = true; resolve({ code, signal }); });
  });
  async function wait(event: string): Promise<Message> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 25_000;
      const timer = setInterval(() => {
        const message = messages.find(m => m.event === event);
        if (message) { clearInterval(timer); resolve(message); }
        else if (ended || Date.now() > deadline) { clearInterval(timer); reject(new Error(`${mode}: missing ${event}: ${output}`)); }
      }, 10);
    });
  }
  return { child, exited, wait, go: () => child.send({ continue: true }) };
}
async function state(cwd: string, f: Awaited<ReturnType<typeof seed>>) {
  closeAllSharedLedgers();
  const approvals = new ApprovalStore(cwd); await approvals.load();
  const continuations = new ContinuationStore(cwd); await continuations.load();
  const entries = await readFile(join(cwd, 'router-entries.jsonl'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return ''; throw error;
  });
  return { approval: approvals.loadCommitted(f.approvalId)!, run: (await new CoordinationStore(cwd).load(f.runId))!,
    continuation: continuations.findByApprovalId(f.approvalId), entries: entries.trim().split('\n').filter(Boolean) };
}
async function scenario(body: (cwd: string, f: Awaited<ReturnType<typeof seed>>, start: (mode: string) => ReturnType<typeof host>) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), 'd9-process-race-'));
  const hosts: ReturnType<typeof host>[] = [];
  try {
    const f = await seed(cwd);
    await body(cwd, f, mode => { const h = host(cwd, f.approvalId, mode); hosts.push(h); return h; });
  } finally {
    for (const h of hosts) { if (h.child.exitCode === null && h.child.signalCode === null) h.child.kill('SIGKILL'); await h.exited; }
    closeAllSharedLedgers(); await rm(cwd, { recursive: true, force: true });
  }
}
async function finish(h: ReturnType<typeof host>) {
  const result = await h.wait('result');
  assert.deepEqual(await h.exited, { code: 0, signal: null }); return result;
}

test('D9 independent consumers released from one barrier claim exactly one durable approval', { timeout: 60_000 }, () => scenario(async (cwd, f, start) => {
  const hosts = [start('consume'), start('consume'), start('consume'), start('consume')];
  const ready = await Promise.all(hosts.map(h => h.wait('ready')));
  assert.equal(new Set(ready.map(m => m.pid)).size, 4);
  hosts.forEach(h => h.go());
  const results = await Promise.all(hosts.map(finish));
  assert.equal(results.filter(r => r.consumed).length, 1);
  const s = await state(cwd, f);
  assert.equal(s.approval.status, 'consumed'); assert.equal(s.approval.executionOutcome, 'pending');
  assert.equal(s.approval.consumedByWorkerId, 'race-consumer'); assert.equal(s.approval.consumedAttempt, 1);
  assert.equal(s.entries.length, 0);
}));

test('D9 concurrent resumer loser cannot release the active winner lease or enter router', { timeout: 60_000 }, () => scenario(async (cwd, f, start) => {
  const winner = start('tool.requested'), loser = start('resume');
  const pids = await Promise.all([winner.wait('ready'), loser.wait('ready')]);
  assert.notEqual(pids[0].pid, pids[1].pid);
  winner.go(); await winner.wait('paused');
  const ownership = new OwnershipRegistry(cwd);
  const before = await ownership.listActive(); assert.equal(before.length, 1);
  loser.go(); await finish(loser);
  assert.deepEqual(await ownership.listActive(), before);
  assert.equal((await state(cwd, f)).entries.length, 0);
  winner.go(); await finish(winner);
  const s = await state(cwd, f);
  assert.equal(s.entries.length, 1); assert.equal(s.approval.executionOutcome, 'succeeded');
  assert.equal(s.run.workers[0].status, 'pending'); assert.equal(s.run.workers[0].attempt, 1);
  assert.equal((await ownership.listActive()).length, 0);
}));

for (const change of ['cancel', 'attempt', 'agent', 'scope', 'agent-before-claim', 'cancel-before-claim', 'attempt-before-claim', 'scope-before-claim', 'lease-before-gate', 'lease-after-claim'] as const) {
  test(`D9 dispatch authority race: ${change}`, { timeout: 60_000 }, () => scenario(async (cwd, f, start) => {
    const lateLease = change === 'lease-after-claim';
    const preClaim = change.endsWith('before-claim');
    const h = start(change === 'lease-before-gate' || preClaim ? 'tool.requested' : 'tool.started');
    await h.wait('ready'); h.go(); await h.wait('paused');
    const ownership = new OwnershipRegistry(cwd);
    if (change.startsWith('lease')) {
      const leases = await ownership.listActive(); assert.equal(leases.length, 1);
      assert.equal(await ownership.revoke(leases[0].id), true);
      // Competing owner must keep its lease when the original resume cleans up.
      const acquired = await ownership.acquire({ agentId: 'replacement-owner', mode: 'exclusive-write',
        scope: { kind: 'path', root: join(cwd, 'owned.txt'), recursive: false } });
      assert.equal(acquired.acquired, true);
    } else {
      await new CoordinationStore(cwd).updateRun(f.runId, run => {
        if (change.startsWith('cancel')) { run.status = 'cancelled'; run.workers[0].status = 'cancelled'; }
        if (change.startsWith('attempt')) run.workers[0].attempt = 2;
        if (change.startsWith('agent')) run.workers[0].agentId = 'replacement';
        if (change.startsWith('scope')) { run.workers[0].ownershipScopes = ['other.txt']; run.workers[0].ownershipClaims = [{ path: 'other.txt', recursive: false }]; }
      });
    }
    // Wait for the REAL host monitor/renewal to abort, rather than aborting a
    // test controller. This bounds observed cancellation, not atomicity.
    if (change !== 'lease-before-gate') await h.wait('aborted');
    h.go(); const result = await finish(h);
    const s = await state(cwd, f);
    assert.equal(s.entries.length, 0); assert.equal(s.continuation, undefined);
    await assert.rejects(readFile(join(cwd, 'owned.txt')), { code: 'ENOENT' });
    assert.equal(s.approval.status, change === 'lease-before-gate' || preClaim ? 'approved' : 'consumed');
    assert.equal(s.approval.executionOutcome, change === 'lease-before-gate' || preClaim ? undefined : 'cancelled');
    assert.equal(result.cancelled, change !== 'lease-before-gate');
    assert.equal(s.run.workers[0].attempt, change.startsWith('attempt') ? 2 : 1);
    assert.equal(s.run.workers[0].status, change.startsWith('cancel') ? 'cancelled' : 'blocked');
    const active = await ownership.listActive();
    assert.equal(active.length, change.startsWith('lease') ? 1 : 0);
    if (lateLease || change === 'lease-before-gate') assert.equal(active[0].agentId, 'replacement-owner');
  }));
}

test('D9 ambiguous nontransactional effect stays pending across competing fresh recovery hosts', { timeout: 60_000 }, () => scenario(async (cwd, f, start) => {
  const first = start('ambiguous-effect'); await first.wait('ready'); first.go(); await first.wait('paused');
  first.child.kill('SIGKILL'); assert.equal((await first.exited).signal, 'SIGKILL');
  const before = await state(cwd, f);
  assert.equal(before.approval.executionOutcome, 'pending'); assert.equal(before.entries.length, 1);
  const effect = await readFile(join(cwd, 'external-surrogate.jsonl'), 'utf8');
  assert.equal(effect.trim().split('\n').length, 1);
  const recovery = [start('resume'), start('resume')];
  const pids = await Promise.all(recovery.map(h => h.wait('ready')));
  assert.equal(new Set(pids.map(m => m.pid)).size, 2);
  assert.ok(pids.every(m => m.pid !== first.child.pid));
  recovery.forEach(h => h.go()); await Promise.all(recovery.map(finish));
  assert.deepEqual(await state(cwd, f), before);
  assert.equal(await readFile(join(cwd, 'external-surrogate.jsonl'), 'utf8'), effect);
  assert.equal(await readFile(join(cwd, 'owned.txt'), 'utf8'), 'D9 real resumer effect\n');
}));

// Assignment and canonical tool identity deliberately differ in this fixture.
// Both must retain their own meaning; neither can be inferred from worker ID.
for (const fault of ['none', 'reassigned', 'missing-assignment', 'canonical-agent', 'missing-canonical']) {
  test(`D9 assignment/canonical identity parity: ${fault}`, { timeout: 60_000 }, () => scenario(async (cwd, f, start) => {
    const store = new ContinuationStore(cwd); await store.load();
    const cont = store.findByApprovalId(f.approvalId)!;
    assert.equal(cont.coordinationWorker!.assignedAgentId, 'assigned-agent');
    assert.equal(cont.toolCall!.agentId, 'kill-agent');
    const log = new EventLog(join(cwd, '.alix/sessions/d9-kill')); await log.init();
    const executor = createToolExecutor({ config: DEFAULT_CONFIG, log, root: cwd, approvalStore: new ApprovalStore(cwd) });
    // Rebinding a captured operation cannot transfer its approved authority.
    assert.equal(await executor.bindContinuationWorker(f.approvalId, {
      ...cont.coordinationWorker!, assignedAgentId: 'replacement',
    }), false);
    await log.close();
    if (fault === 'reassigned') await new CoordinationStore(cwd).patchWorker(f.runId, f.workerId, { agentId: 'replacement' });
    if (fault === 'missing-assignment') delete cont.coordinationWorker!.assignedAgentId;
    if (fault === 'canonical-agent') cont.toolCall!.agentId = 'assigned-agent';
    if (fault === 'missing-canonical') delete cont.toolCall!.agentId;
    if (!['none', 'reassigned'].includes(fault)) await store.persist(cont);
    const h = start('resume'); await h.wait('ready'); h.go(); await finish(h);
    const s = await state(cwd, f);
    assert.equal(s.entries.length, fault === 'none' ? 1 : 0);
    assert.equal(s.run.workers[0].status, fault === 'none' ? 'pending' : 'blocked');
    assert.equal(s.approval.status, fault === 'none' ? 'consumed' : 'approved');
    if (fault !== 'none') await assert.rejects(readFile(join(cwd, 'owned.txt')), { code: 'ENOENT' });
  }));
}
