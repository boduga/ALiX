import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SubagentManager, resolveRenewalResult} from '../../src/agents/subagent-manager.js';
import type {AlixConfig, SubagentTask} from '../../src/operations/config/schema.js';
import {fixtureSupervisor, taskResult, deferred} from '../fixtures/task-worker-supervisor.js';
const dirs: string[] = [];
function cwd() { const path = mkdtempSync(join(tmpdir(), 'alix-supervised-')); dirs.push(path); return path; }
after(() => {for (const path of dirs) rmSync(path, {recursive: true, force: true});});
const config = {models: {default: {provider: 'fixture', name: 'fixture-model'}}} as AlixConfig;
function task(changes: Partial<SubagentTask> = {}): SubagentTask {
  return {id: 'worker', role: 'explorer', mode: 'read_only', prompt: 'test', ...changes};
}
function setup(options: Parameters<typeof fixtureSupervisor>[0] = {}, managerOptions: Record<string, unknown> = {}) {
  const fixture = fixtureSupervisor(options);
  const manager = new SubagentManager({sessionId: 'test', cwd: cwd(), config,
    workerSupervisor: fixture.supervisor, ...managerOptions});
  return {manager, fixture};
}
async function flush() { for (let i = 0; i < 10; i++) await new Promise<void>(resolve => setImmediate(resolve)); }

test('no supervisor, command override and observer all fail closed before execution', async () => {
  for (const options of [{}, {spawnOverride: {command: 'must-never-run'}},
    {supervisorWorkerLifecycle: {onSpawned: async () => assert.fail(), onExited: () => assert.fail()}}]) {
    const manager = new SubagentManager({sessionId: 'test', cwd: cwd(), config, ...options});
    await assert.rejects(manager.spawn(task()), /SECURITY HOLD/);
  }
});
test('canonical preparation precedes launch and receives no credential configuration', async () => {
  const {manager, fixture} = setup({}, {config: {...config, apiKeys: {openai: 'DO_NOT_FORWARD'}}});
  const result = await manager.spawn(task({contextBundle: 'context', expectedOutput: 'answer', inputPaths: ['input.md']}));
  assert.equal(result.status, 'success');
  assert.equal(fixture.tasks.length, 1);
  assert.equal(fixture.launches.length, 1);
  assert.equal(fixture.tasks[0].contextBundle, 'context');
  assert.ok(!JSON.stringify(fixture.tasks).includes('DO_NOT_FORWARD'));
  assert.ok(Object.isFrozen(fixture.tasks[0].identity));
});
test('preserves structured partial, failed and rejected findings', async () => {
  for (const status of ['partial', 'failed', 'rejected'] as const) for (const exitCode of [0, 1]) {
    const {manager} = setup({result: t => taskResult(t, {status, error: 'incomplete'}),
      wait: async () => ({exitCode, signal: null})});
    const result = await manager.spawn(task());
    assert.equal(result.status, status);
    assert.equal(result.findings[0].content, 'done');
    assert.equal(result.error, 'incomplete');
  }
});
test('abnormal native exit cannot preserve a success claim', async () => {
  const {manager} = setup({wait: async () => ({exitCode: 1, signal: null})});
  const result = await manager.spawn(task());
  assert.equal(result.status, 'failed');
  assert.equal(result.findings.length, 1);
});
test('callbacks and telemetry failures do not change result or cleanup', async () => {
  const {manager} = setup({}, {eventLog: {append() {throw new Error('telemetry failed');}}});
  manager.onResult(() => {throw new Error('presentation failed');});
  assert.equal((await manager.spawn(task())).status, 'success');
});
test('lifecycle uses parent session and preserves partial state once', async () => {
  const events: Array<{type: string; sessionId: string; payload: Record<string, unknown>}> = [];
  const {manager} = setup({result: t => taskResult(t, {status: 'partial'})},
    {eventLog: {append(e: any) {events.push(e); return Promise.resolve(e);}}});
  await manager.spawn(task({eventSessionId: 'parent'}));
  assert.ok(events.every(event => event.sessionId === 'parent'));
  assert.deepEqual(events.filter(e => e.type === 'agent.completed').map(e => e.payload.state), ['partial']);
});
test('cancel during preparation fences launch and settles only after cleanup', async () => {
  const gate = deferred<void>();
  const {manager, fixture} = setup({prepare: async () => gate.promise});
  const pending = manager.spawn(task());
  const rejected = assert.rejects(pending, /cancel/i);
  await flush();
  assert.equal(manager.cancel('worker'), true);
  gate.resolve();
  await rejected;
  assert.equal(fixture.launches.length, 0);
  assert.ok(fixture.revocations > 0);
});
test('shutdown immediately fences an in-flight spawn', async () => {
  const {manager, fixture} = setup();
  const pending = manager.spawn(task());
  const rejected = assert.rejects(pending, /cancel/i);
  manager.shutdown();
  await rejected;
  assert.equal(fixture.launches.length, 0);
});
test('cancellation during native launch cancels the late returned handle', async () => {
  const gate = deferred<void>();
  const {manager, fixture} = setup({launch: async () => gate.promise});
  const pending = manager.spawn(task());
  const rejected = assert.rejects(pending, /cancel/i);
  await flush();
  manager.cancel('worker');
  gate.resolve();
  await rejected;
  assert.equal(fixture.handles.length, 1);
  assert.equal(fixture.cancellations.length, 1);
});
test('wait rejection triggers cancellation before releasing ownership', async () => {
  const {manager, fixture} = setup({wait: async () => {throw new Error('wait failed');}});
  await assert.rejects(manager.spawn(task()), /wait failed/);
  assert.equal(fixture.cancellations.length, 1);
  assert.equal(fixture.revocations, 1);
});
test('uncertain cleanup quarantines successors and retains ownership tracking', async () => {
  const {manager, fixture} = setup({result: async () => {throw new Error('bad result');},
    revoke: async () => {throw new Error('revoke failed');}});
  await assert.rejects(manager.spawn(task({role: 'worker', mode: 'write', ownedPaths: ['report.md']})), /cleanup unresolved/);
  assert.equal((manager as any).leasesByTask.size, 1);
  await assert.rejects(manager.spawn(task({id: 'successor'})), /unresolved/);
  assert.equal(fixture.launches.length, 1);
  manager.shutdown();
});
test('duplicate IDs cannot replace pending attempts; batches retain order and isolation', async () => {
  const gates = new Map([['a', deferred<void>()], ['b', deferred<void>()]]);
  const {manager} = setup({result: async t => {await gates.get(t.identity.workerId)?.promise; return taskResult(t);}});
  const pending = manager.spawnMany([task({id: 'a'}), task({id: 'b'}), task({id: 'a'})]);
  await flush();
  assert.equal((manager as any).running.size, 2);
  gates.get('b')!.resolve(); gates.get('a')!.resolve();
  const results = await pending;
  assert.deepEqual(results.map(r => r.id), ['a', 'b', 'a']);
  assert.deepEqual(results.map(r => r.status), ['success', 'success', 'failed']);
});
test('standalone write ownership blocks a second manager and releases after confirmed exit', async () => {
  const root = cwd(), gate = deferred<void>();
  const holder = setup({result: async t => {await gate.promise; return taskResult(t);}}, {cwd: root});
  const successor = setup({}, {cwd: root});
  const pending = holder.manager.spawn(task({role: 'worker', mode: 'write', ownedPaths: ['report.md']}));
  await flush();
  await assert.rejects(successor.manager.spawn(task({role: 'worker', mode: 'write', id: 'other', ownedPaths: ['report.md']})), /overlapping/i);
  gate.resolve(); await pending;
  assert.equal((await successor.manager.spawn(task({role: 'worker', mode: 'write', id: 'next', ownedPaths: ['report.md']}))).status, 'success');
});
test('complete scheduler identities skip duplicate ownership; partial identities reject', async () => {
  const root = cwd();
  const {manager} = setup({}, {cwd: root});
  await manager.spawn(task({coordinationRunId: 'run', coordinationWorkerAttempt: 1, role: 'worker', mode: 'write', ownedPaths: ['report.md']}));
  assert.equal(existsSync(join(root, '.alix', 'ownership', 'ownership.json')), false);
  await assert.rejects(manager.spawn(task({coordinationRunId: 'run'})), /Incomplete/);
  await assert.rejects(manager.spawn(task({assignedAgentId: 'label'})), /Incomplete/);
});
test('renewal false or rejection fences execution rather than dropping tracked claims', async () => {
  for (const throws of [false, true]) {
    const gate = deferred<void>(), started = deferred<void>();
    const {manager} = setup({result: async t => {started.resolve(); await gate.promise; return taskResult(t);},
      revoke: async () => {throw new Error('uncertain termination');}});
    const pending = manager.spawn(task({role: 'worker', mode: 'write', ownedPaths: ['report.md']}));
    const rejected = assert.rejects(pending, /unresolved/);
    await started.promise;
    for (const registry of (manager as any).registries.values()) registry.renew = async () => {if (throws) throw new Error('lock failed'); return false;};
    await (manager as any).renewTaskLeases();
    gate.resolve(); await rejected;
    assert.equal((manager as any).leasesByTask.size, 1);
    await assert.rejects(manager.spawn(task({id: 'next'})), /unresolved/);
  }
});
test('lease release/renew helper retains its established race semantics', () => {
  assert.deepEqual(resolveRenewalResult(false, ['a']), {action: 'release', releaseIds: ['a']});
  assert.deepEqual(resolveRenewalResult(true, ['a']), {action: 'set', releaseIds: []});
  assert.deepEqual(resolveRenewalResult(true, []), {action: 'delete', releaseIds: []});
});


test('cancellation during lease release cannot emit or return success', async () => {
  const root = cwd(), entered = deferred<void>(), releaseGate = deferred<void>();
  const events: string[] = [];
  const {manager} = setup({}, {cwd: root, eventLog: {append(e: {type: string}) {events.push(e.type); return Promise.resolve(e);}}});
  const registry = (manager as any).registryFor(root);
  const release = registry.release.bind(registry);
  registry.release = async (id: string) => {entered.resolve(); await releaseGate.promise; return release(id);};
  const pending = manager.spawn(task({role: 'worker', mode: 'write', ownedPaths: ['report.md']}));
  const rejected = assert.rejects(pending, /cancel/i);
  await entered.promise;
  manager.cancel('worker');
  releaseGate.resolve();
  await rejected;
  assert.equal(events.filter(e => e === 'agent.cancelled').length, 1);
  assert.equal(events.includes('agent.completed'), false);
  assert.equal(events.includes('subagent.result'), false);
});

test('a renewal that completes after release cannot resurrect ownership tracking', async () => {
  const root = cwd(), started = deferred<void>(), resultGate = deferred<void>();
  const renewed = deferred<boolean>(), entered = deferred<void>();
  const {manager} = setup({result: async t => {started.resolve(); await resultGate.promise; return taskResult(t);}}, {cwd: root});
  const pending = manager.spawn(task({role: 'worker', mode: 'write', ownedPaths: ['report.md']}));
  await started.promise;
  const registry = (manager as any).registryFor(root);
  let releases = 0;
  const release = registry.release.bind(registry);
  registry.release = async (id: string) => {releases++; return release(id);};
  registry.renew = async () => {entered.resolve(); return renewed.promise;};
  const pass = (manager as any).renewTaskLeases();
  await entered.promise;
  resultGate.resolve(); await pending;
  renewed.resolve(true); await pass;
  assert.equal((manager as any).leasesByTask.size, 0);
  assert.equal(releases, 2, 'release the raced renewed claim without reinserting its entry');
});
