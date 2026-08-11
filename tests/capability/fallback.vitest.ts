import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityRuntime } from '../../src/capability/runtime.js';
import { ProviderResolver } from '../../src/capability/provider-resolver.js';
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor, ToolProviderExecutor, McpProviderExecutor, ExternalCliProviderExecutor, type SpawnLike } from '../../src/capability/provider-executor.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';
import { HookRegistry } from '../../src/capability/hook-registry.js';
import { EventBus } from '../../src/capability/event-bus.js';
import type { CapabilityContext, ExecutorRunResult } from '../../src/capability/types.js';
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';
import type { ToolCallRequest } from '../../src/tools/types.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap4-fallback-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function makeRegistry() {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  return registry;
}
function def(over: Partial<CapabilityDefinition>): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'x',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }], ...over,
  };
}
type FakeCallTool = (name: string, args: Record<string, unknown>) => Promise<{ kind: 'success'; content?: string; output?: string } | { kind: 'error'; message: string; retryable?: boolean }>;
type FakeHandler = (args: Record<string, unknown>, ctx: CapabilityContext) => Promise<ExecutorRunResult>;

function makeRuntime(opts: { mcp?: FakeCallTool; spawn?: SpawnLike; handlers?: Record<string, FakeHandler> } = {}) {
  const reg = makeRegistry();
  const native = new NativeExecutor();
  for (const [id, h] of Object.entries(opts.handlers ?? {})) native.registerHandler(id, h);
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(native));
  if (opts.mcp) providers.register('mcp', new McpProviderExecutor({ callTool: opts.mcp }));
  if (opts.spawn) providers.register('external-cli', new ExternalCliProviderExecutor(opts.spawn));
  const bus = new EventBus();
  const runtime = new CapabilityRuntime(reg, new HookRegistry(), new ProviderResolver(reg, providers), bus);
  return { reg, runtime, providers, bus };
}

describe('CAP-4 R1 fallback contract', () => {
  it('fails over to the next candidate when the first returns a fallback-eligible error (ordered priority)', async () => {
    const order: string[] = [];
    const { reg, runtime } = makeRuntime({
      mcp: async () => { order.push('mcp'); return { kind: 'error', message: 'upstream', retryable: true }; },
      handlers: { 'code.repository.impact': async () => { order.push('native'); return { output: 'native-result' }; } },
    });
    reg.import([def({
      id: 'code.repository.impact', allowFallbacks: true, bindings: [
        { id: 'mcp:github', type: 'mcp', config: { toolName: 'impact' } },
        { id: 'code.repository.impact', type: 'native' },
      ],
    })]);
    const result = await runtime.invoke('code.repository.impact', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(result.status).toBe('completed');
    expect(result.output).toBe('native-result');
    expect(order).toEqual(['mcp', 'native']);   // bounded single pass
  });

  it('allowFallbacks false pins to binding[0]: exhaustion, no failover to binding[1]', async () => {
    const nativeCalls: string[] = [];
    const { reg, runtime } = makeRuntime({
      mcp: async () => ({ kind: 'error', message: 'busy', retryable: true }),
      handlers: { 'pinned.cap': async () => { nativeCalls.push('native'); return { output: 'native' }; } },
    });
    reg.import([def({
      id: 'pinned.cap', allowFallbacks: false, bindings: [
        { id: 'mcp:github', type: 'mcp', config: { toolName: 'x' } },
        { id: 'pinned.cap', type: 'native' },
      ],
    })]);
    const result = await runtime.invoke('pinned.cap', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(result.status).toBe('failed');
    expect(nativeCalls).toHaveLength(0);   // pin: never proceeds to binding[1]
    expect(reg.getAvailability('pinned.cap')).toEqual({ available: false, reason: 'provider_unavailable' });
    expect(reg.getLifecycleState('pinned.cap')).toBe('emerging');   // availability ≠ lifecycle
  });

  it('a fatal error fails immediately without trying the next candidate', async () => {
    const nativeCalls: string[] = [];
    const { reg, runtime } = makeRuntime({
      mcp: async () => ({ kind: 'error', message: 'malformed request', retryable: false }),
      handlers: { 'fatal.cap': async () => { nativeCalls.push('native'); return { output: 'native' }; } },
    });
    reg.import([def({
      id: 'fatal.cap', bindings: [
        { id: 'mcp:github', type: 'mcp', config: { toolName: 'x' } },
        { id: 'fatal.cap', type: 'native' },
      ],
    })]);
    const result = await runtime.invoke('fatal.cap', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/malformed request/);
    expect(nativeCalls).toHaveLength(0);   // fatal: no fallback
  });

  it('exhaustion marks provider_unavailable and leaves lifecycle unchanged', async () => {
    const { reg, runtime } = makeRuntime({
      mcp: async () => ({ kind: 'error', message: 'upstream', retryable: true }),
    });
    reg.import([def({
      id: 'exhaust.cap', bindings: [
        { id: 'mcp:a', type: 'mcp', config: { toolName: 'a' } },
        { id: 'mcp:b', type: 'mcp', config: { toolName: 'b' } },
      ],
    })]);
    const result = await runtime.invoke('exhaust.cap', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(result.status).toBe('failed');
    expect(reg.getAvailability('exhaust.cap')).toEqual({ available: false, reason: 'provider_unavailable' });
    expect(reg.getLifecycleState('exhaust.cap')).toBe('emerging');
    expect(result.servingProvider).toBeUndefined();   // failure never carries a provider identity
  });

  it('code.repository.impact keeps its identity across gitnexus→mcp→native fallback', async () => {
    const order: string[] = [];
    const { reg, runtime } = makeRuntime({
      spawn: async () => {
        order.push('gitnexus');
        const e = new Error('spawn gitnexus ENOENT') as Error & { code: string };
        e.code = 'ENOENT';
        throw e;
      },
      mcp: async () => { order.push('mcp'); return { kind: 'error', message: 'disconnected', retryable: true }; },
      handlers: { 'code.repository.impact': async () => { order.push('native'); return { output: 'impact-report' }; } },
    });
    reg.import([def({
      id: 'code.repository.impact', allowFallbacks: true, bindings: [
        { id: 'gitnexus', type: 'external-cli', config: { executable: 'gitnexus', operation: ['impact'] } },
        { id: 'mcp:github', type: 'mcp', config: { toolName: 'impact' } },
        { id: 'code.repository.impact', type: 'native' },
      ],
    })]);
    const result = await runtime.invoke('code.repository.impact', { file: 'src/x.ts' }, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(result.status).toBe('completed');
    expect(result.output).toBe('impact-report');
    expect(order).toEqual(['gitnexus', 'mcp', 'native']);
    // Capability identity constant; provider identity changed across attempts (#476).
    expect(reg.get('code.repository.impact')!.definition.id).toBe('code.repository.impact');
    expect(result.servingProvider).toEqual({ providerId: 'code.repository.impact', providerType: 'native', bindingIndex: 2 });
  });

  it('capability failure (fatal) does NOT fall back; provider failure (unavailable) does — the acceptance distinction', async () => {
    // Two tool bindings, distinct toolNames: 'shell.run' fails fatally (a
    // deterministic rejection), 'fallback.run' fails with a provider outage.
    const calls: string[] = [];
    const exec = new ToolProviderExecutor({
      execute: async (req: ToolCallRequest) => {
        calls.push(req.name);
        if (req.name === 'shell.run') return { kind: 'error', message: 'Permission denied by policy', retryable: false };
        if (req.name === 'fallback.run') return { kind: 'error', message: 'upstream down', retryable: true };
        return { kind: 'error', message: 'unknown' };
      },
    });
    const reg = makeRegistry();
    const providers = new ProviderExecutorRegistry();
    providers.register('tool', exec);
    const runtime = new CapabilityRuntime(reg, new HookRegistry(), new ProviderResolver(reg, providers), new EventBus());

    // Capability failure → STOP (native fallback binding never tried).
    reg.import([def({ id: 'fatal.cap', bindings: [
      { id: 'tool:shell', type: 'tool', config: { toolName: 'shell.run' } },
      { id: 'fatal.cap', type: 'native' },   // would succeed if tried
    ] })]);
    const fatal = await runtime.invoke('fatal.cap', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(fatal.status).toBe('failed');
    expect(fatal.error).toBe('Permission denied by policy');

    // Provider failure → fallback (native binding serves).
    reg.import([def({ id: 'failover.cap', bindings: [
      { id: 'tool:fallback', type: 'tool', config: { toolName: 'fallback.run' } },
      { id: 'failover.cap', type: 'native' },
    ] })]);
    const native = new NativeExecutor();
    native.registerHandler('failover.cap', async () => ({ output: 'native-served' }));
    providers.register('native', new NativeProviderExecutor(native));
    const failover = await runtime.invoke('failover.cap', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(failover.status).toBe('completed');
    expect(failover.output).toBe('native-served');
    expect(calls).toEqual(['shell.run', 'fallback.run']);   // shell.run NOT retried on the fatal path
  });

  it('a provider failure on one capability does not take down a sibling on the same provider', async () => {
    const { reg, runtime } = makeRuntime({
      handlers: {
        'broken.cap': async () => ({ error: 'segfault' }),
        'healthy.cap': async () => ({ output: 'fine' }),
      },
    });
    reg.import([def({ id: 'broken.cap', bindings: [{ id: 'broken.cap', type: 'native' }] })]);
    reg.import([def({ id: 'healthy.cap', bindings: [{ id: 'healthy.cap', type: 'native' }] })]);
    const broken = await runtime.invoke('broken.cap', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(broken.status).toBe('failed');
    const healthy = await runtime.invoke('healthy.cap', {}, { actor: 'operator', cwd: '/', workspace: '/' }).wait();
    expect(healthy.status).toBe('completed');
    expect(healthy.output).toBe('fine');
  });

  // NOTE: `missing_binding` is structurally unreachable via the public API —
  // validateCapabilityDefinition requires >=1 binding, so bindings:[] cannot be
  // registered. The runtime keeps its defensive missing_binding branch (locked
  // vocabulary; future-proof for hand-edited catalogs); the sync-throw ternary's
  // bindingsCount === 0 case is likewise defensive. There is deliberately no
  // test for it.
});
