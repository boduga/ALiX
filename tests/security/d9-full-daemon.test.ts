import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { ContinuationStore } from '../../src/runtime-state/runtime/continuation-store.js';
import { CoordinationStore } from '../../src/coordination/kernel/coordination-store.js';
import { OwnershipRegistry } from '../../src/coordination/ownership/ownership-registry.js';
import { createCoordinationRun, createWorkerAssignment } from '../../src/coordination/kernel/coordination-types.js';
import { bindWorkerToolContinuation } from '../../src/coordination/kernel/worker-tool-continuation.js';
import { captureWorkerEventLog } from '../../src/coordination/kernel/default-worker-review.js';
import { createToolExecutor } from '../../src/capabilities/tools/tool-executor-factory.js';
import { EventLog } from '../../src/runtime-state/events/event-log.js';
import { DEFAULT_CONFIG } from '../../src/operations/config/defaults.js';
import { closeAllSharedLedgers, getSharedLedger } from '../../src/runtime-state/storage/runtime-ledger.js';

type Message = { event: string; pid: number; name?: string; id?: string; [key: string]: unknown };
const entry = fileURLToPath(new URL('../../src/operations/daemon/daemon-server.js', import.meta.url));
const preload = fileURLToPath(new URL('../fixtures/d9-full-daemon-preload.js', import.meta.url));
const artifactRoot = process.env.D9_ARTIFACT_DIR;
const sourceHashes = Object.fromEntries([entry, preload, fileURLToPath(import.meta.url),
  fileURLToPath(new URL('../fixtures/d9-full-daemon-actor.js', import.meta.url))].map(path =>
    [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
async function seed(cwd: string, approved = true) {
  const home = join(cwd, 'home');
  await mkdir(join(home, '.alix'), { recursive: true });
  await mkdir(join(cwd, '.alix'), { recursive: true });
  const config = structuredClone(DEFAULT_CONFIG);
  config.models = { default: { provider: 'scripted-mock', name: 'scripted-mock-model' } };
  config.permissions.sessionMode = 'ask'; config.permissions.tools = { 'file.create': 'ask' };
  config.subagents = { ...config.subagents!, enabled: false };
  // Offline scripted provider only; no live model call is needed or permitted.
  await writeFile(join(cwd, '.alix/config.json'), JSON.stringify(config));
  const approvals = new ApprovalStore(cwd); await approvals.load();
  const log = new EventLog(join(cwd, '.alix/sessions/d9-full')); await log.init();
  try {
    const captured = captureWorkerEventLog(log);
    const executor = createToolExecutor({ config, log: captured.log, root: cwd, approvalStore: approvals });
    assert.equal((await executor.execute({ toolCallId: 'daemon-call', name: 'file.create',
      args: { path: 'owned.txt', content: 'D9 full daemon effect\n' }, agentId: 'daemon-agent' })).kind, 'denied');
    const approval = approvals.findByRequestId('daemon-call')!;
    assert.equal(approval.status, 'pending');
    const run = createCoordinationRun({ sessionId: 'd9-full', rootGoal: 'write owned.txt', coordinatorAgentId: 'coordinator' });
    run.hostKind = 'daemon'; run.status = 'blocked';
    const worker = createWorkerAssignment({ coordinationRunId: run.id, agentId: 'daemon-agent', taskLabel: 'writer',
      goalPrompt: 'write owned.txt', requiredCapabilities: ['file.create'], attempt: 1,
      ownershipScopes: ['owned.txt'], ownershipClaims: [{ path: 'owned.txt', recursive: false }],
      status: 'blocked', blockReason: 'approval_required', approvalId: approval.id });
    run.workers = [worker]; await new CoordinationStore(cwd).save(run);
    assert.equal(await bindWorkerToolContinuation(run.sessionId, worker, captured.events, () => executor), approval.id);
    if (approved) await approvals.resolve(approval.id, 'approved');
    return { approvalId: approval.id, runId: run.id, workerId: worker.id, home };
  } finally { await log.close(); closeAllSharedLedgers(); }
}

function contender(cwd: string, f: Fixture, action: string, resumer = false) {
  const script = fileURLToPath(new URL(resumer ? '../fixtures/d9-process-race-child.js' : '../fixtures/d9-full-daemon-actor.js', import.meta.url));
  const child = spawn(process.execPath, [script, cwd, f.approvalId, action], {
    cwd, env: { PATH: process.env.PATH, HOME: f.home }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const messages: Message[] = []; let output = '';
  child.on('message', m => messages.push(m as Message));
  child.stdout!.on('data', d => { output += String(d); }); child.stderr!.on('data', d => { output += String(d); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  async function wait(event: string) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const m = messages.find(m => m.event === event); if (m) { assert.equal(m.pid, child.pid); return m; }
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Actor died: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Actor timeout ${event}: ${output}`);
  }
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
  void exited.finally(() => clearTimeout(timer));
  return { child, wait, go: () => child.send({ command: 'go' }), exited,
    evidence: () => ({ pid: child.pid, action, resumer, messages, output, exitCode: child.exitCode, signal: child.signalCode }) };
}

async function scenario(id: string, body: (cwd: string, f: Fixture,
  hosts: ReturnType<typeof daemon>[], actors: ReturnType<typeof contender>[], states: unknown[]) => Promise<void>, approved = true) {
  const cwd = await mkdtemp(join(tmpdir(), 'd9-full-'));
  const hosts: ReturnType<typeof daemon>[] = [], actors: ReturnType<typeof contender>[] = [], states: unknown[] = [];
  let f: Fixture | undefined;
  try { f = await seed(cwd, approved); await body(cwd, f, hosts, actors, states); }
  finally {
    for (const h of hosts) await h.stop();
    for (const a of actors) { if (a.child.exitCode === null && a.child.signalCode === null) a.child.kill('SIGKILL'); await a.exited; }
    if (f) states.push(await snapshot(cwd, f));
    closeAllSharedLedgers();
    if (artifactRoot) {
      await mkdir(artifactRoot, { recursive: true });
      await writeFile(join(artifactRoot, `${id}.json`), JSON.stringify({ cwd,
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        branch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), sourceHashes,
        config: JSON.parse(await readFile(join(cwd, '.alix/config.json'), 'utf8')),
        hosts: hosts.map(h => h.evidence()), actors: actors.map(a => a.evidence()), states }, null, 2));
    }
    await rm(cwd, { recursive: true, force: true });
  }
}

test('F-R01 second daemon is rejected without replacing the live socket', { timeout: 90_000 }, () =>
  scenario('F-R01', async (cwd, f, hosts, _actors, states) => {
    const first = daemon(cwd, f); hosts.push(first); await first.ready();
    const inode = (await stat(join(cwd, 'daemon.sock'))).ino;
    const second = daemon(cwd, f); hosts.push(second);
    const rejected = await second.exited;
    assert.notEqual(rejected.code, 0, 'second daemon must fail admission');
    assert.equal(first.child.kill(0), true);
    assert.equal((await stat(join(cwd, 'daemon.sock'))).ino, inode, 'live socket must not be replaced');
    assert.equal((await rpc(join(cwd, 'daemon.sock'), { command: 'ping' })).type, 'pong');
    const before = await snapshot(cwd, f); states.push(before);
    await first.scan();
    const after = await snapshot(cwd, f); states.push(after);
    assert.equal(after.approval.executionOutcome, 'succeeded');
    assert.equal((after.entries ?? '').trim().split('\n').length, 1);
    assert.equal(after.run.workers[0].attempt, 1);
  }));

test('F-R01b SIGKILL releases daemon admission and permits stale-socket recovery', { timeout: 90_000 }, () =>
  scenario('F-R01b', async (cwd, f, hosts, _actors, states) => {
    const first = daemon(cwd, f); hosts.push(first); await first.ready();
    const oldInode = (await stat(join(cwd, 'daemon.sock'))).ino;
    assert.deepEqual(await first.stop('SIGKILL'), { code: null, signal: 'SIGKILL' });
    const replacement = daemon(cwd, f); hosts.push(replacement); await replacement.ready();
    assert.notEqual((await stat(join(cwd, 'daemon.sock'))).ino, oldInode);
    assert.equal((await rpc(join(cwd, 'daemon.sock'), { command: 'ping' })).type, 'pong');
    states.push(await snapshot(cwd, f));
  }));

test('F-R02 daemon versus independent resumer preserves winner lease', { timeout: 90_000 }, () =>
  scenario('F-R02', async (cwd, f, hosts, actors, states) => {
    const host = daemon(cwd, f, 'tool.requested'); hosts.push(host); await host.ready(); host.send('scan');
    await host.wait('checkpoint'); const before = await snapshot(cwd, f); states.push(before);
    assert.equal(before.ownership.length, 1);
    const actor = contender(cwd, f, 'resume', true); actors.push(actor); await actor.wait('ready'); actor.go();
    await actor.wait('result'); assert.deepEqual(await actor.exited, { code: 0, signal: null });
    assert.deepEqual((await snapshot(cwd, f)).ownership, before.ownership);
    host.send('release'); await host.wait('scan-done');
    const after = await snapshot(cwd, f); states.push(after);
    assert.equal(after.approval.executionOutcome, 'succeeded');
    assert.equal((after.entries ?? '').trim().split('\n').length, 1);
    assert.equal(after.ownership.length, 0);
  }));

test('F-R03 independent approve deny revoke consume decisions stay single-use', { timeout: 90_000 }, () =>
  scenario('F-R03', async (cwd, f, hosts, actors, states) => {
    const host = daemon(cwd, f); hosts.push(host); await host.ready();
    for (const action of ['approve', 'deny', 'revoke', 'consume']) actors.push(contender(cwd, f, action));
    const ready = await Promise.all(actors.map(a => a.wait('ready'))); assert.equal(new Set(ready.map(m => m.pid)).size, 4);
    const scanAfter = host.messages.length; host.send('scan');
    actors.forEach(a => a.go());
    const results = await Promise.all(actors.map(a => a.wait('result')));
    for (const a of actors) assert.deepEqual(await a.exited, { code: 0, signal: null });
    assert.ok(results.filter(m => (m.result as { consumed?: boolean })?.consumed).length <= 1);
    await host.wait('scan-done', scanAfter);
    const before = await snapshot(cwd, f); states.push(before);
    // `revoke` is effective on every state except consumed/expired, so once the
    // revoke actor runs it dominates the deny actor under contention: a durable
    // `denied` is unreachable when all four actors race. The deny decision is
    // still exercised (the actor records its own resolve), it just never wins
    // against a concurrent revoke. Assert only the two reachable terminal states.
    assert.ok(['revoked', 'consumed'].includes(before.approval.status));
    await host.scan(); await host.scan(); const after = await snapshot(cwd, f); states.push(after);
    assert.equal(after.entries, before.entries, 'later scans do not add effects');
    assert.ok((after.entries ?? '').trim().split('\n').filter(Boolean).length <= 1);
    if (after.approval.status !== 'consumed') assert.equal(after.effect, null);
    assert.equal(after.approval.status, before.approval.status);
    const replay = new ApprovalStore(cwd); await replay.load();
    assert.equal((await replay.consumeApproved(f.approvalId, before.approval.bindingKey!, {}, before.approval.invocation)).consumed, false);
  }, false));

test('F-R04 daemon crash with a ready contender cannot revive consumed authority', { timeout: 90_000 }, () =>
  scenario('F-R04', async (cwd, f, hosts, actors, states) => {
    const host = daemon(cwd, f, 'after-consume'); hosts.push(host); await host.ready(); host.send('scan'); await host.wait('checkpoint');
    const actor = contender(cwd, f, 'resume', true); actors.push(actor); await actor.wait('ready');
    assert.deepEqual(await host.stop('SIGKILL'), { code: null, signal: 'SIGKILL' });
    const before = await snapshot(cwd, f); states.push(before); actor.go(); await actor.wait('result');
    assert.deepEqual(await actor.exited, { code: 0, signal: null });
    const next = daemon(cwd, f); hosts.push(next); await next.ready(); await next.scan();
    const after = await snapshot(cwd, f); states.push(after);
    assert.deepEqual(after.approval, before.approval); assert.equal(after.effect, null);
    assert.deepEqual(after.run.workers[0], before.run.workers[0]); assert.deepEqual(after.ownership, before.ownership);
  }));

const authorityChanges = ['cancel', 'attempt', 'owner', 'scope', 'policy', 'lease-revoke', 'lease-expire', 'lease-replace', 'approval-revoke'] as const;
for (const stage of ['tool.requested', 'before-effect'] as const) for (const change of authorityChanges) {
  const id = `F-A-${stage === 'tool.requested' ? 'pre' : 'effect'}-${change}`;
  test(`${id} authority characterization`, { timeout: 90_000 }, () => scenario(id, async (cwd, f, hosts, _actors, states) => {
    const host = daemon(cwd, f, stage); hosts.push(host); await host.ready(); host.send('scan'); await host.wait('checkpoint');
    const before = await snapshot(cwd, f); states.push(before);
    const ownership = new OwnershipRegistry(cwd);
    if (change.startsWith('lease-')) {
      const active = await ownership.listActive(); assert.equal(active.length, 1);
      if (change === 'lease-expire') {
        assert.equal(await ownership.renew(active[0].id, 1), true);
        const deadline = Date.now() + 5000;
        while ((await ownership.listActive()).length && Date.now() < deadline) await new Promise(r => setTimeout(r, 5));
        assert.equal((await ownership.listActive()).length, 0, 'real expiry, no fabricated clock');
      } else {
        assert.equal(await ownership.revoke(active[0].id), true);
        if (change === 'lease-replace') assert.equal((await ownership.acquire({ agentId: 'replacement', mode: 'exclusive-write',
          scope: { kind: 'path', root: join(cwd, 'owned.txt'), recursive: false } })).acquired, true);
      }
    } else if (change === 'approval-revoke' || change === 'policy') {
      const approvals = new ApprovalStore(cwd); await approvals.load();
      if (change === 'policy') {
        const invalidated = await approvals.invalidateByPolicyRevision('D9-policy-v2');
        assert.equal(invalidated.some(a => a.id === f.approvalId), stage === 'tool.requested');
      } else assert.equal((await approvals.revoke(f.approvalId, { actor: 'operator', reason: 'D9 revoke' })) !== null, stage === 'tool.requested');
    } else {
      await new CoordinationStore(cwd).updateRun(f.runId, run => {
        if (change === 'cancel') { run.status = 'cancelled'; run.workers[0].status = 'cancelled'; }
        if (change === 'attempt') run.workers[0].attempt++;
        if (change === 'owner') run.workers[0].agentId = 'replacement';
        if (change === 'scope') { run.workers[0].ownershipScopes = ['other.txt']; run.workers[0].ownershipClaims = [{ path: 'other.txt', recursive: false }]; }
      });
    }
    const changed = await snapshot(cwd, f); states.push(changed);
    if (change === 'cancel' || change === 'attempt' || change === 'scope') await host.wait('abort-observed');
    // At router entry the executor has already crossed its last abort check.
    // The characterization intentionally asserts ACTUAL stale effects and records
    // them as security findings; a green test is never a prevention verdict.
    host.send('release'); await host.wait('scan-done');
    const after = await snapshot(cwd, f); states.push(after);
    const prevented = stage === 'tool.requested' && change !== 'owner';
    assert.equal(after.effect, prevented ? null : 'D9 full daemon effect\n');
    assert.equal((after.entries ?? '').trim().split('\n').filter(Boolean).length, prevented ? 0 : 1);
    if (stage === 'tool.requested') assert.equal(after.approval.status, change === 'owner' ? 'consumed' :
      change === 'approval-revoke' ? 'revoked' : change === 'policy' ? 'invalidated' : 'approved');
    if (change === 'lease-replace') assert.equal((await ownership.listActive())[0]?.agentId, 'replacement');
    assert.equal(after.run.workers[0].attempt, change === 'attempt' ? 2 : 1);
  }));
}

test('F-C01 public IPC cancels the exact active task durably across restart', { timeout: 90_000 }, () =>
  scenario('F-C01', async (cwd, f, hosts, _actors, states) => {
    const host = daemon(cwd, f, 'task-active'); hosts.push(host); await host.ready();
    const frames: Record<string, unknown>[] = [];
    const socket = createConnection(join(cwd, 'daemon.sock')); let buffer = '';
    socket.on('error', () => {});
    socket.on('data', data => {
      buffer += String(data); const lines = buffer.split('\n'); buffer = lines.pop()!;
      for (const line of lines) if (line) frames.push(JSON.parse(line));
    });
    socket.on('connect', () => socket.write(JSON.stringify({ command: 'run', task: 'create cancelled.txt', cwd,
      route: { kind: 'tool', tool: 'file.create', args: { path: 'cancelled.txt', content: 'must not happen' } } }) + '\n'));
    try {
      await host.wait('checkpoint', 0, m => m.name === 'task-active');
      const taskId = String(frames.find(m => m.type === 'task.created')?.taskId);
      assert.match(taskId, /^task_/);
      const cancel = await rpc(join(cwd, 'daemon.sock'), { command: 'cancel', taskId });
      assert.equal(cancel.type, 'task.cancelled'); assert.equal(cancel.taskId, taskId); assert.equal(cancel.requested, true);
      await host.wait('task-abort-observed', 0, m => m.id === taskId);
      const taskFact = () => getSharedLedger(f.home).readLatestByEntityType('daemonTask').find(row => row.entityId === taskId)!;
      states.push(taskFact());
      assert.equal((taskFact().payload as { task: { status: string } }).task.status, 'cancel_requested');
      host.send('release');
      const deadline = Date.now() + 20_000;
      while (!frames.some(m => m.type === 'session.ended') && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
      assert.ok(frames.some(m => m.type === 'session.ended')); states.push(taskFact());
      assert.deepEqual(await host.stop('SIGKILL'), { code: null, signal: 'SIGKILL' });
      const next = daemon(cwd, f); hosts.push(next); await next.ready(); await next.scan();
      states.push(taskFact());
      await assert.rejects(readFile(join(cwd, 'cancelled.txt')), { code: 'ENOENT' });
      assert.equal((taskFact().payload as { task: { status: string } }).task.status, 'cancelled', 'accepted cancellation must remain cancelled, never completed');
      assert.ok(frames.some(m => m.type === 'task.cancelled' && m.taskId === taskId));
    } finally { socket.destroy(); }
  }));
type Fixture = Awaited<ReturnType<typeof seed>>;
async function snapshot(cwd: string, f: Fixture) {
  closeAllSharedLedgers();
  const approvals = new ApprovalStore(cwd); await approvals.load();
  const continuations = new ContinuationStore(cwd); await continuations.load();
  const read = (path: string) => readFile(join(cwd, path), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  return {
    approval: approvals.loadCommitted(f.approvalId)!,
    approvals: approvals.list(),
    run: (await new CoordinationStore(cwd).load(f.runId))!,
    continuation: continuations.findByApprovalId(f.approvalId),
    ownership: await new OwnershipRegistry(cwd).listActive(),
    ownershipHistory: await new OwnershipRegistry(cwd).listHistory(),
    daemonTasks: getSharedLedger(f.home).readLatestByEntityType('daemonTask'),
    effect: await read('owned.txt'), entries: await read('router-entries.jsonl'), controlledEffects: await read('controlled-effects.jsonl'),
    mtime: await stat(join(cwd, 'owned.txt')).then(s => s.mtimeMs, error => { if (error.code === 'ENOENT') return null; throw error; }),
  };
}
function daemon(cwd: string, f: Fixture, point = '', effectMode = '', instrumented = true) {
  const args = [...(instrumented ? ['--import', preload] : []), entry, '--socket', join(cwd, 'daemon.sock'), '--cwd', cwd];
  const child = spawn(process.execPath, args, { cwd, env: {
    PATH: process.env.PATH, HOME: f.home, XDG_CONFIG_HOME: join(f.home, '.config'),
    D9_WORKSPACE: cwd, D9_APPROVAL: f.approvalId, D9_POINT: point, D9_EFFECT_MODE: effectMode,
  }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '';
  child.stdout!.on('data', data => { output += String(data); });
  child.stderr!.on('data', data => { output += String(data); });
  const messages: Message[] = [];
  child.on('message', message => messages.push(message as Message));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  async function wait(event: string, after = 0, predicate = (_m: Message) => true): Promise<Message> {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const found = messages.slice(after).find(m => m.event === event && predicate(m));
      if (found) { assert.equal(found.pid, child.pid); return found; }
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Daemon exited before ${event}: ${output}`);
      const failure = messages.find(m => m.event === 'instrumentation-error');
      if (failure) throw new Error(JSON.stringify(failure));
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Daemon timeout at ${event}: ${output} ${JSON.stringify(messages)}`);
  }
  const send = (command: string, id?: string) => child.send({ command, id });
  async function scan() { const after = messages.length; send('scan'); return wait('scan-done', after); }
  async function ready() {
    if (instrumented) { await wait('watcher-started'); await wait('scheduler-started'); }
    else {
      const deadline = Date.now() + 25_000;
      while (!output.includes('Daemon listening on ') && Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Daemon exited: ${output}`);
        await new Promise(r => setTimeout(r, 10));
      }
      assert.ok(output.includes('Daemon listening on '));
    }
    assert.equal((await rpc(join(cwd, 'daemon.sock'), { command: 'ping' })).type, 'pong');
    assert.equal(child.kill(0), true, 'OS process identity is live');
  }
  async function stop(signal: NodeJS.Signals = 'SIGTERM') {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    let timer: ReturnType<typeof setTimeout>;
    timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    const result = await exited.finally(() => clearTimeout(timer));
    return result;
  }
  return { child, messages, wait, send, ready, scan, stop, exited,
    evidence: () => ({ pid: child.pid, args, node: process.version, output, messages, exitCode: child.exitCode, signal: child.signalCode }) };
}
async function rpc(path: string, command: object): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path); let buffer = '';
    socket.setTimeout(5000, () => socket.destroy(new Error('IPC timeout')));
    socket.once('error', reject);
    socket.once('connect', () => socket.write(JSON.stringify(command) + '\n'));
    socket.on('data', data => {
      buffer += String(data);
      if (buffer.includes('\n')) { socket.destroy(); try { resolve(JSON.parse(buffer.split('\n')[0])); } catch (e) { reject(e); } }
    });
  });
}
const cases = [
  ['F-D01', 'before-resume'], ['F-D02', 'after-tombstone'], ['F-D03', 'after-consume'],
  ['F-D04', 'after-effect'], ['F-D05', 'after-receipt'], ['F-D06', 'during-reconciliation'],
  ['F-D07', 'after-effect'],
] as const;
test('F-L00 uninstrumented executable answers real IPC and shuts down', { timeout: 60_000 }, () =>
  scenario('F-L00', async (cwd, f, hosts) => {
    const host = daemon(cwd, f, '', '', false); hosts.push(host); await host.ready();
    assert.equal(host.evidence().args.includes('--import'), false);
    assert.equal((await rpc(join(cwd, 'daemon.sock'), { command: 'status' })).running, true);
    assert.deepEqual(await host.stop('SIGTERM'), { code: 0, signal: null });
  }));
for (const mode of ['receipt-lost', 'fail-before', 'unknown', 'timeout-applied', 'duplicate-keyed', 'duplicate-unkeyed']) {
  test(`F-E-${mode} controlled external effect adapter`, { timeout: 90_000 }, () =>
    scenario(`F-E-${mode}`, async (cwd, f, hosts, _actors, states) => {
      const host = daemon(cwd, f, mode === 'receipt-lost' ? 'after-effect' : '', mode); hosts.push(host); await host.ready();
      host.send('scan');
      if (mode === 'receipt-lost') { await host.wait('checkpoint'); assert.deepEqual(await host.stop('SIGKILL'), { code: null, signal: 'SIGKILL' }); }
      else await host.wait('scan-done');
      const before = await snapshot(cwd, f); states.push(before);
      const unknown = ['receipt-lost', 'unknown', 'timeout-applied'].includes(mode);
      assert.equal((before.controlledEffects ?? '').trim().split('\n').filter(Boolean).length,
        mode === 'fail-before' ? 0 : mode === 'duplicate-unkeyed' ? 2 : 1);
      await host.stop();
      const next = daemon(cwd, f); hosts.push(next); await next.ready(); await next.scan(); await next.scan();
      const after = await snapshot(cwd, f); states.push(after);
      assert.deepEqual(after.approval, before.approval);
      assert.equal(after.entries, before.entries); assert.equal(after.controlledEffects, before.controlledEffects);
      if (unknown) assert.deepEqual(after.run.workers[0], before.run.workers[0]);
      assert.equal(before.approval.executionOutcome, unknown ? 'pending' : mode === 'fail-before' ? 'failed' : 'succeeded');
    }));
}
for (const [id, point] of cases) {
  test(`${id} real daemon SIGKILL ${point}`, { timeout: 120_000 }, async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'd9-full-'));
    const hosts: ReturnType<typeof daemon>[] = [];
    const states: unknown[] = [];
    try {
      const f = await seed(cwd);
      if (id === 'F-D06') {
        const bootstrap = daemon(cwd, f, 'before-resume'); hosts.push(bootstrap); await bootstrap.ready();
        bootstrap.send('scan'); await bootstrap.wait('checkpoint');
        assert.deepEqual(await bootstrap.stop('SIGKILL'), { code: null, signal: 'SIGKILL' });
        states.push(await snapshot(cwd, f)); closeAllSharedLedgers();
      }
      const first = daemon(cwd, f, point); hosts.push(first); await first.ready();
      // Exercise the real scheduler on the approval-blocked run before scanning.
      first.send('tick', f.runId); await first.wait('tick-done');
      first.send('scan'); await first.wait('checkpoint', 0, m => m.name === point);
      assert.deepEqual(await first.stop('SIGKILL'), { code: null, signal: 'SIGKILL' });
      const before = await snapshot(cwd, f); states.push(before);
      const spent = ['after-consume', 'after-effect', 'after-receipt'].includes(point);
      const effected = ['after-effect', 'after-receipt'].includes(point);
      assert.equal(before.approval.status, spent ? 'consumed' : 'approved');
      assert.equal(before.approval.executionOutcome, point === 'after-receipt' ? 'succeeded' : spent ? 'pending' : undefined);
      assert.equal(before.effect, effected ? 'D9 full daemon effect\n' : null);
      assert.equal(before.run.workers[0].status, 'blocked');
      assert.equal(before.continuation !== undefined, ['before-resume', 'during-reconciliation'].includes(point));
      for (let cycle = 0; cycle < (id === 'F-D07' ? 3 : 1); cycle++) {
        closeAllSharedLedgers();
        const next = daemon(cwd, f); hosts.push(next); await next.ready();
        assert.notEqual(next.child.pid, first.child.pid);
        const completedScan = await next.scan();
        assert.ok((completedScan.records as { id: string }[]).some(a => a.id === f.approvalId));
        await next.scan();
        const after = await snapshot(cwd, f); states.push(after);
        const recovered = ['before-resume', 'during-reconciliation', 'after-receipt'].includes(point);
        if (recovered) {
          assert.ok(next.messages.some(m => m.event === 'run-committed' && m.id === f.runId &&
            (m.workers as { id: string; status: string; attempt: number }[]).some(w =>
              w.id === f.workerId && w.status === 'pending' && w.attempt === 1)), 'durably requeued original worker');
          assert.ok(['pending', 'blocked'].includes(after.run.workers[0].status));
        } else assert.equal(after.run.workers[0].status, 'blocked');
        assert.equal(after.run.workers[0].attempt, 1);
        assert.equal(after.continuation, undefined);
        assert.equal(after.effect, recovered ? 'D9 full daemon effect\n' : before.effect);
        assert.equal((after.entries ?? '').trim().split('\n').filter(Boolean).length, recovered || effected ? 1 : 0);
        if (spent) { assert.deepEqual(after.approval, before.approval); assert.equal(after.mtime, before.mtime); }
        if (!recovered) assert.deepEqual(after.run.workers[0], before.run.workers[0]);
        if (['before-resume', 'during-reconciliation'].includes(point)) assert.equal(after.ownership.length, 0);
        else assert.deepEqual(after.ownership, before.ownership, 'recovery never takes over dead execution leases');
        assert.deepEqual(await next.stop(id === 'F-D07' ? 'SIGKILL' : 'SIGTERM'),
          id === 'F-D07' ? { code: null, signal: 'SIGKILL' } : { code: 0, signal: null });
      }
    } finally {
      for (const host of hosts) await host.stop();
      closeAllSharedLedgers();
      if (artifactRoot) {
        await mkdir(artifactRoot, { recursive: true });
        await writeFile(join(artifactRoot, `${id}.json`), JSON.stringify({ cwd,
          commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
          branch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), sourceHashes,
          config: JSON.parse(await readFile(join(cwd, '.alix/config.json'), 'utf8')),
          hosts: hosts.map(h => h.evidence()), states }, null, 2));
      }
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
