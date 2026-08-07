// tests/capability/runtime.vitest.ts
import { describe, it, expect } from 'vitest';
import { CapabilityRuntime } from '../../src/capability/runtime.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { HookRegistry } from '../../src/capability/hook-registry.js';
import { ExecutionResolver } from '../../src/capability/execution-resolver.js';
import { ExecutorRegistry, NativeExecutor } from '../../src/capability/executors.js';
import { EventBus } from '../../src/capability/event-bus.js';
import { CapabilityNotFoundError, ExecutorNotFoundError } from '../../src/capability/errors.js';

function setup() {
  const reg = new CapabilityRegistry();
  const hooks = new HookRegistry();
  const executors = new ExecutorRegistry();
  const native = new NativeExecutor();
  executors.register('native', native);
  const bus = new EventBus();
  const runtime = new CapabilityRuntime(reg, hooks, new ExecutionResolver(reg), executors, bus);
  return { reg, runtime, native, bus, hooks };
}

function registerEcho(reg: CapabilityRegistry) {
  reg.register({
    id: 'core.echo', version: '1.0', kind: 'core', title: 'Echo', description: 'echo',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    execution: { strategy: 'native', timeout: 5000, cancellable: true },
  });
}

describe('CapabilityRuntime', () => {
  it('invokes a native capability and resolves with output', async () => {
    const { reg, runtime, native } = setup();
    registerEcho(reg);
    native.registerHandler('core.echo', async (args) => ({ output: args }));
    const inv = runtime.invoke('core.echo', { msg: 'hi' }, { actor: 'operator', cwd: '/', workspace: '/' });
    const result = await inv.wait();
    expect(result.status).toBe('completed');
    expect(result.output).toEqual({ msg: 'hi' });
  });

  it('status getter reflects live state', async () => {
    const { reg, runtime, native } = setup();
    registerEcho(reg);
    let started = false;
    native.registerHandler('core.echo', async () => {
      started = true;
      await new Promise((r) => setTimeout(r, 10));
      return { output: 'ok' };
    });
    const inv = runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' });
    expect(inv.status).toBe('queued');
    await new Promise((r) => setTimeout(r, 20));
    expect(inv.status).toBe('completed');  // getter, not frozen snapshot
  });

  it('publishes start then completed in order', async () => {
    const { reg, runtime, native, bus } = setup();
    registerEcho(reg);
    native.registerHandler('core.echo', async (args) => ({ output: args }));
    const events: string[] = [];
    bus.subscribe((e) => events.push(e.type));
    await runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    const startIdx = events.indexOf('InvocationStarted');
    const endIdx = events.indexOf('InvocationCompleted');
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThan(startIdx);
  });

  it('inv.subscribe is scoped to its own invocation, not the global bus', async () => {
    const { reg, runtime, native } = setup();
    registerEcho(reg);
    native.registerHandler('core.echo', async () => ({ output: 'ok' }));
    const seen: string[] = [];
    const inv1 = runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' });
    inv1.subscribe((e) => seen.push(e.type));
    await inv1.wait();
    // A second invocation's events must not leak into inv1's subscriber.
    await runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(seen).toEqual(['InvocationStarted', 'InvocationCompleted']);
  });

  it('emits InvocationFailed when the executor errors', async () => {
    const { reg, runtime, native } = setup();
    registerEcho(reg);
    native.registerHandler('core.echo', async () => ({ error: 'boom' }));
    const result = await runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
  });

  it('cancel before execution starts prevents the executor from running', async () => {
    const { reg, runtime, native } = setup();
    registerEcho(reg);
    let executed = false;
    native.registerHandler('core.echo', async () => {
      executed = true;
      return { output: 'ran' };
    });
    const inv = runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' });
    inv.cancel();                      // cancel immediately, before async body runs
    await new Promise((r) => setTimeout(r, 20));
    const result = inv.result();
    expect(result?.status).toBe('cancelled');
    expect(executed).toBe(false);      // no race: executor never started
  });

  it('cancel marks an in-flight invocation cancelled', async () => {
    const { reg, runtime, native } = setup();
    registerEcho(reg);
    let released: () => void = () => {};
    native.registerHandler('core.echo', async () => {
      await new Promise<void>((r) => { released = r; });
      return { output: 'done' };
    });
    const inv = runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' });
    inv.cancel();
    released();
    const result = await inv.wait();
    expect(result.status).toBe('cancelled');
  });

  it('drains an InvocationCancelled event through inv.events() after cancel', async () => {
    const { reg, runtime, native } = setup();
    registerEcho(reg);
    let released: () => void = () => {};
    native.registerHandler('core.echo', async () => {
      await new Promise<void>((r) => { released = r; });
      return { output: 'done' };
    });
    const inv = runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' });
    inv.cancel();
    released();
    const collected: string[] = [];
    for await (const e of inv.events()) collected.push(e.type);
    expect(collected).toContain('InvocationCancelled');
  });

  it('drains an InvocationCompleted event through inv.events() on success', async () => {
    const { reg, runtime, native } = setup();
    registerEcho(reg);
    native.registerHandler('core.echo', async (args) => ({ output: args }));
    const inv = runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' });
    await inv.wait();
    const collected: string[] = [];
    for await (const e of inv.events()) collected.push(e.type);
    expect(collected).toContain('InvocationCompleted');
  });

  it('drains an InvocationFailed event through inv.events() on failure', async () => {
    const { reg, runtime, native } = setup();
    registerEcho(reg);
    native.registerHandler('core.echo', async () => ({ error: 'boom' }));
    const inv = runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' });
    await inv.wait();
    const collected: string[] = [];
    for await (const e of inv.events()) collected.push(e.type);
    expect(collected).toContain('InvocationFailed');
  });

  it('does not emit InvocationFailed after a mid-flight cancel settles', async () => {
    const { reg, runtime, native, bus } = setup();
    registerEcho(reg);
    let started = false;
    let released: () => void = () => {};
    native.registerHandler('core.echo', async () => {
      started = true;
      await new Promise<void>((r) => { released = r; });
      throw new Error('boom after cancel');
    });
    const events: string[] = [];
    bus.subscribe((e) => events.push(e.type));
    const inv = runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' });
    while (!started) await new Promise((r) => setTimeout(r, 1));
    inv.cancel();
    released();
    const result = await inv.wait();
    expect(result.status).toBe('cancelled');
    await new Promise((r) => setTimeout(r, 5)); // let the rejected executor's catch/fail run
    const lastFailed = events.lastIndexOf('InvocationFailed');
    const lastCancelled = events.lastIndexOf('InvocationCancelled');
    expect(lastFailed).toBeLessThan(lastCancelled);
  });

  it('runs hooks in order: validate, canInvoke, beforeInvoke, executor, afterInvoke', async () => {
    const { reg, runtime, native, hooks } = setup();
    registerEcho(reg);
    const order: string[] = [];
    native.registerHandler('core.echo', async () => { order.push('executor'); return { output: 'ok' }; });
    hooks.set('core.echo', {
      validate: () => { order.push('validate'); return undefined; },
      canInvoke: () => { order.push('canInvoke'); return true; },
      beforeInvoke: async () => { order.push('beforeInvoke'); },
      afterInvoke: async () => { order.push('afterInvoke'); },
    });
    await runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(order).toEqual(['validate', 'canInvoke', 'beforeInvoke', 'executor', 'afterInvoke']);
  });

  it('validate hook failure blocks execution', async () => {
    const { reg, runtime, native, hooks } = setup();
    registerEcho(reg);
    native.registerHandler('core.echo', async (args) => ({ output: args }));
    hooks.set('core.echo', { validate: (args) => (args.msg ? undefined : 'msg required') });
    const bad = await runtime.invoke('core.echo', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(bad.status).toBe('failed');
    expect(bad.error).toBe('msg required');
  });

  it('throws CapabilityNotFoundError for an unknown capability id', () => {
    const { runtime } = setup();
    expect(() => runtime.invoke('nope.x', {}, { actor: 'op', cwd: '/', workspace: '/' })).toThrow(CapabilityNotFoundError);
  });

  it('throws ExecutorNotFoundError when the strategy has no executor', () => {
    const { reg, runtime } = setup();
    reg.register({
      id: 'core.missing', version: '1.0', kind: 'core', title: 'X', description: 'x',
      tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
      execution: { strategy: 'does-not-exist' },
    });
    expect(() => runtime.invoke('core.missing', {}, { actor: 'op', cwd: '/', workspace: '/' })).toThrow(ExecutorNotFoundError);
  });

  // ── Phase 3 (#308): composition pipelines ─────────────────────────

  function registerComposed(reg: CapabilityRegistry) {
    reg.register({
      id: 'core.dep', version: '1.0', kind: 'core', title: 'Dep', description: 'dep',
      tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
      execution: { strategy: 'native', timeout: 5000, cancellable: true },
    });
    reg.register({
      id: 'core.composed', version: '1.0', kind: 'core', title: 'Composed', description: 'composed',
      tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
      dependencies: ['core.dep'],
      execution: { strategy: 'native', timeout: 5000, cancellable: true },
    });
  }

  it('runs dependency steps before the capability step (composition)', async () => {
    const { reg, runtime, native } = setup();
    registerComposed(reg);
    const order: string[] = [];
    native.registerHandler('core.dep', async (args) => {
      order.push('dep');
      return { output: { fromDep: args.input } };
    });
    native.registerHandler('core.composed', async (args) => {
      order.push('composed');
      // The dependency's output is available to the composed step.
      return { output: { saw: (args as { fromDep?: string }).fromDep } };
    });

    const inv = runtime.invoke('core.composed', { input: 'hello' }, { actor: 'op', cwd: '/', workspace: '/' });
    const result = await inv.wait();
    expect(result.status).toBe('completed');
    expect(order).toEqual(['dep', 'composed']);
    // The composed step received the dependency's output as input.
    expect(result.output).toEqual({ saw: 'hello' });
  });

  it('a failed dependency fails the whole composite', async () => {
    const { reg, runtime, native } = setup();
    registerComposed(reg);
    native.registerHandler('core.dep', async () => ({ error: 'dep failed' }));
    let composedRan = false;
    native.registerHandler('core.composed', async () => {
      composedRan = true;
      return { output: 'should not run' };
    });

    const result = await runtime.invoke('core.composed', {}, { actor: 'op', cwd: '/', workspace: '/' }).wait();
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/dep failed/);
    expect(composedRan).toBe(false);
  });

  it('mirrors core.session.summary: a composed capability consumes its dependency array output (#418)', async () => {
    const { reg, runtime, native } = setup();
    // core.session.list → returns an array of sessions.
    reg.register({
      id: 'core.session.list', version: '1.0', kind: 'core', title: 'List', description: 'x',
      tags: [], category: 'session', risk: 'low', requiredPermissions: ['operator'],
      execution: { strategy: 'native' },
    });
    // core.session.summary depends on the list.
    reg.register({
      id: 'core.session.summary', version: '1.0', kind: 'core', title: 'Summary', description: 'x',
      tags: [], category: 'session', risk: 'low', requiredPermissions: ['operator'],
      dependencies: ['core.session.list'],
      execution: { strategy: 'native' },
    });
    native.registerHandler('core.session.list', async () => ({
      output: [{ sessionId: 's1', createdAt: '2026' }, { sessionId: 's2', createdAt: '2026' }],
    }));
    native.registerHandler('core.session.summary', async (args) => {
      // The dependency's array output arrives as this step's input.
      const sessions = Array.isArray(args) ? args : [];
      return { output: { total: sessions.length, first: (sessions[0] as { sessionId?: string })?.sessionId ?? 'none' } };
    });

    const result = await runtime.invoke('core.session.summary', {}, { actor: 'op', cwd: '/', workspace: '/' }).wait();
    expect(result.status).toBe('completed');
    expect(result.output).toEqual({ total: 2, first: 's1' });
  });
});
