import {describe, it, expect, vi} from 'vitest';
import {projectSupervisorTask, snapshotWorkerEvidence, snapshotPreparedRequest, validateTaskCompletion,
  requireTaskWorkerSupervisor, WORKER_TASK_LIMITS} from '../../src/agents/worker-task-supervisor.js';
import {SubagentManager} from '../../src/agents/subagent-manager.js';
import {fixtureSupervisor, taskResult, deferred} from '../fixtures/task-worker-supervisor.js';
import type {AlixConfig, SubagentTask} from '../../src/operations/config/schema.js';
const identity = {coordinationRunId: 'run', workerId: 'worker', attempt: 1};
const evidence = {identity, pid: 99999, uid: (process.getuid?.() ?? 1000) + 1, startTimeTicks: '123', registrationId: 'registration'};
const task: SubagentTask = {id: 'worker', role: 'explorer', mode: 'read_only', prompt: 'answer'};
const model = {provider: 'fixture', name: 'fixture'};
const projection = () => projectSupervisorTask(task, identity, '/tmp/workspace', model, 'ask');
function envelope() {return {protocolVersion: 1, evidence: structuredClone(evidence), result: taskResult(projection())};}
const config = {models: {default: model}} as AlixConfig;
describe('canonical task supervisor data contract, no OS qualification', () => {
  it('refuses absent and incomplete authority rather than using legacy launch', () => {
    expect(() => requireTaskWorkerSupervisor(undefined)).toThrow(/SECURITY HOLD/);
    expect(() => requireTaskWorkerSupervisor({launch: vi.fn(), revoke: vi.fn(), reconcile: vi.fn()} as never)).toThrow(/SECURITY HOLD/);
  });
  it('projects only task data and detaches nested mutable identity/scope', () => {
    const input = {...task, apiKeys: {openai: 'NEVER_FORWARD'}, ownedPaths: ['report.md']};
    const mutableIdentity = {...identity};
    const result = projectSupervisorTask(input, mutableIdentity, '/tmp/workspace', model, 'ask');
    input.ownedPaths[0] = 'other.md'; mutableIdentity.attempt = 9;
    expect(result.ownedPaths).toEqual(['report.md']);
    expect(result.identity.attempt).toBe(1);
    expect(JSON.stringify(result)).not.toContain('NEVER_FORWARD');
    expect(Object.isFrozen(result.model)).toBe(true);
  });
  it('rejects unsupported scenario handoff, overlarge text and invalid attempts', () => {
    expect(() => projectSupervisorTask({...task, scriptedScenarioJson: '{}'}, identity, '/tmp/workspace', model, 'ask')).toThrow();
    expect(() => projectSupervisorTask({...task, prompt: 'a'.repeat(WORKER_TASK_LIMITS.taskBytes)}, identity, '/tmp/workspace', model, 'ask')).toThrow();
    expect(() => projectSupervisorTask(task, {...identity, attempt: 0}, '/tmp/workspace', model, 'ask')).toThrow();
  });
  it('rejects changed prepared identity/root and unrequested keys', () => {
    const request = {identity, workspaceRoot: '/tmp/workspace', configurationId: 'opaque'};
    expect(snapshotPreparedRequest(request, projection()).configurationId).toBe('opaque');
    for (const invalid of [{...request, workspaceRoot: '/tmp/other'}, {...request, identity: {...identity, attempt: 2}},
      {...request, apiKeys: {}}, {...request, configurationId: ''}]) expect(() => snapshotPreparedRequest(invalid, projection())).toThrow();
  });
  it('binds every process-generation field and rejects same-UID evidence', () => {
    for (const invalid of [{...evidence, uid: process.getuid?.() ?? -1}, {...evidence, pid: 0},
      {...evidence, startTimeTicks: '0'}, {...evidence, registrationId: ''}]) expect(() => snapshotWorkerEvidence(invalid, identity)).toThrow();
    for (const delta of [{pid: 1}, {uid: evidence.uid + 1}, {startTimeTicks: '124'}, {registrationId: 'replacement'},
      {identity: {...identity, attempt: 2}}]) {
      const value = envelope(); Object.assign(value.evidence, delta);
      expect(() => validateTaskCompletion(value, evidence, task.role)).toThrow();
    }
  });
  it('validates a closed, detached structured result; unknown and missing fields fail', () => {
    const value = envelope(); const result = validateTaskCompletion(value, evidence, task.role);
    value.result.findings[0].content = 'changed';
    expect(result.findings[0].content).toBe('done');
    for (const invalid of [{...envelope(), protocolVersion: 2}, {...envelope(), secret: 'unknown'},
      {...envelope(), result: {...envelope().result, status: 'cancelled'}}, {...envelope(), result: {...envelope().result, id: 'other'}},
      {...envelope(), result: {...envelope().result, findings: [{type: 'summary', content: 'missing confidence'}]}}]) {
      expect(() => validateTaskCompletion(invalid, evidence, task.role)).toThrow();
    }
  });
  it('enforces UTF-8 byte, event, finding, reference and envelope bounds', () => {
    const variants = [
      {...envelope().result, events: ['é'.repeat(32769)]},
      {...envelope().result, events: Array(201).fill('')},
      {...envelope().result, findings: Array(129).fill(envelope().result.findings[0])},
      {...envelope().result, findings: [{...envelope().result.findings[0], refs: Array(17).fill('ref')}]},
      {...envelope().result, error: 'a'.repeat(16385)},
      {...envelope().result, findings: Array(8).fill({...envelope().result.findings[0], content: 'a'.repeat(65536)})},
    ];
    for (const result of variants) expect(() => validateTaskCompletion({...envelope(), result}, evidence, task.role)).toThrow();
  });
  it('exit zero with a missing completion fails after post-exit drain, then cancels', async () => {
    vi.useFakeTimers();
    try {
      const result = deferred<ReturnType<typeof taskResult>>();
      const fixture = fixtureSupervisor({result: () => result.promise, wait: async () => ({exitCode: 0, signal: null})});
      const manager = new SubagentManager({sessionId: 'test', config, workerSupervisor: fixture.supervisor});
      const pending = manager.spawn(task);
      const checked = expect(pending).rejects.toThrow(/unresolved/);
      await vi.advanceTimersByTimeAsync(1001);
      await checked;
      expect(fixture.cancellations).toHaveLength(1);
    } finally {vi.useRealTimers();}
  });
  it('does not impose a total deadline on healthy live workers', async () => {
    vi.useFakeTimers();
    try {
      const result = deferred<ReturnType<typeof taskResult>>();
      const fixture = fixtureSupervisor({result: () => result.promise});
      const manager = new SubagentManager({sessionId: 'test', config, workerSupervisor: fixture.supervisor});
      let settled = false;
      const pending = manager.spawn(task).finally(() => {settled = true;});
      await vi.advanceTimersByTimeAsync(3600000);
      expect(settled).toBe(false);
      result.resolve(taskResult(fixture.tasks[0]));
      expect((await pending).status).toBe('success');
    } finally {vi.useRealTimers();}
  });
});

describe('pending cancellation and shared dispatch fences', () => {
  it.each(['reject', 'timeout'] as const)('revocation %s settles despite permanently pending completion/wait', async mode => {
    vi.useFakeTimers();
    try {
      const events: string[] = [];
      const fixture = fixtureSupervisor({result: () => new Promise(() => {}), wait: () => new Promise(() => {}),
        revoke: () => mode === 'reject' ? Promise.reject(new Error('revoke denied')) : new Promise(() => {})});
      const manager = new SubagentManager({sessionId: 'test', config, workerSupervisor: fixture.supervisor,
        eventLog: {append(e: {type: string}) {events.push(e.type); return Promise.resolve(e);}} as never});
      const pending = manager.spawn(task);
      const rejected = expect(pending).rejects.toThrow(/cleanup unresolved/);
      await vi.advanceTimersByTimeAsync(0);
      expect(fixture.handles).toHaveLength(1);
      manager.cancel(task.id);
      await vi.advanceTimersByTimeAsync(5001);
      await rejected;
      await expect(pending).rejects.toMatchObject({name: 'ExecutionCancelledError'});
      await expect(manager.spawn({...task, id: 'successor'})).rejects.toThrow(/unresolved/);
      expect(fixture.launches).toHaveLength(1);
      expect((manager as any).running.size).toBe(1);
      expect(events).not.toContain('agent.cancelled');
      expect(events).not.toContain('agent.completed');
    } finally {vi.useRealTimers();}
  });
  it.each(['prepare', 'launch'] as const)('cancellation interrupts a permanently pending %s and cleans a late handle', async phase => {
    vi.useFakeTimers();
    try {
      const gate = deferred<void>();
      const fixture = fixtureSupervisor({[phase]: () => gate.promise,
        revoke: async () => {throw new Error('unresolved revocation');}});
      const manager = new SubagentManager({sessionId: 'test', config, workerSupervisor: fixture.supervisor});
      const pending = manager.spawn(task);
      const rejected = expect(pending).rejects.toThrow(/cleanup unresolved/);
      await vi.advanceTimersByTimeAsync(0);
      manager.cancel(task.id);
      await vi.advanceTimersByTimeAsync(5001);
      await rejected;
      await expect(pending).rejects.toMatchObject({name: 'ExecutionCancelledError'});
      await expect(manager.spawn({...task, id: 'successor'})).rejects.toThrow(/unresolved/);
      gate.resolve(); await vi.advanceTimersByTimeAsync(0);
      expect(fixture.launches.length).toBe(phase === 'launch' ? 1 : 0);
      if (phase === 'launch') expect(fixture.cancellations).toHaveLength(1);
    } finally {vi.useRealTimers();}
  });
  it('quarantine interrupts another task already awaiting preparation', async () => {
    const ready = deferred<void>(), held = deferred<void>(), fail = deferred<void>();
    const fixture = fixtureSupervisor({prepare: async t => {if (t.identity.workerId === 'b') {ready.resolve(); await held.promise;}},
      result: async t => {if (t.identity.workerId === 'a') {await fail.promise; throw new Error('result failed');} return taskResult(t);},
      revoke: async () => {throw new Error('cleanup failed');}});
    const manager = new SubagentManager({sessionId: 'test', config, workerSupervisor: fixture.supervisor});
    const a = manager.spawn({...task, id: 'a'}), b = manager.spawn({...task, id: 'b'});
    const rejectedA = expect(a).rejects.toThrow(/unresolved/), rejectedB = expect(b).rejects.toThrow(/unresolved/);
    await ready.promise;
    fail.resolve();
    await rejectedA; await rejectedB;
    held.resolve(); await new Promise<void>(resolve => setImmediate(resolve));
    expect(fixture.launches).toHaveLength(1);
    expect(fixture.launches[0].identity.workerId).toBe('a');
  });
});

describe('dispatch microtask fence', () => {
  it.each(['cancel', 'quarantine'] as const)('%s between validated preparation and queued dispatch cannot launch', async fence => {
    const fixture = fixtureSupervisor();
    const manager = new SubagentManager({sessionId: 'test', config, workerSupervisor: fixture.supervisor});
    const prepare = fixture.supervisor.prepareTask.bind(fixture.supervisor);
    fixture.supervisor.prepareTask = async input => {
      const request = await prepare(input);
      return {...request, get configurationId() {
        queueMicrotask(() => fence === 'cancel' ? manager.cancel(task.id) : (manager as any).enterQuarantine());
        return request.configurationId;
      }};
    };
    await expect(manager.spawn(task)).rejects.toThrow(fence === 'cancel' ? /cancel/i : /unresolved/);
    expect(fixture.launches).toHaveLength(0);
    if (fence === 'cancel') {
      fixture.supervisor.prepareTask = prepare;
      expect((await manager.spawn({...task, id: 'successor'})).status).toBe('success');
    }
  });
});


it('runtime configuration cannot enable a supplied qualification/test supervisor', async () => {
  const fixture = fixtureSupervisor();
  const manager = new SubagentManager({sessionId: 'test', config: {...config, workerSupervisor: fixture.supervisor} as AlixConfig});
  await expect(manager.spawn(task)).rejects.toThrow(/SECURITY HOLD/);
  expect(fixture.tasks).toHaveLength(0);
  expect(fixture.launches).toHaveLength(0);
});
