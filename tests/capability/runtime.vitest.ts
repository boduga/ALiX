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
});
