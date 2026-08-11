import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderResolver } from '../../src/capability/provider-resolver.js';
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor } from '../../src/capability/provider-executor.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CapabilityNotFoundError } from '../../src/capability/errors.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';
import type { CapabilityContext } from '../../src/capability/types.js';
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap4-resolver-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function makeRegistry() {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  return registry;
}
function ctx(): CapabilityContext {
  return { invocationId: 'i', requestId: 'r', actor: 'operator', permissions: ['operator'],
    cwd: '/', workspace: '/', sessionId: 's', cancellationToken: new AbortController().signal,
    eventBus: { emit: () => {} } };
}
function makeProviderExecutorRegistry() {
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(new NativeExecutor()));
  return providers;
}
function def(over: Partial<CapabilityDefinition>): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'x',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    ...over,
  };
}

describe('ProviderResolver', () => {
  it('resolves a native capability to a single-step plan with one candidate', () => {
    const reg = makeRegistry();
    reg.import([def({})]);
    const plans = new ProviderResolver(reg, makeProviderExecutorRegistry()).resolve('core.echo', ctx());
    expect(plans).toHaveLength(1);
    expect(plans[0]!.capabilityId).toBe('core.echo');
    expect(plans[0]!.steps).toHaveLength(1);
    expect(plans[0]!.steps[0]!.candidates).toHaveLength(1);
    expect(plans[0]!.steps[0]!.candidates[0]!.binding.type).toBe('native');
  });

  it('candidates preserve bindings order (best-first)', () => {
    const reg = makeRegistry();
    reg.import([def({ bindings: [
      { id: 'gh', type: 'external-cli', config: { executable: 'gh' } },
      { id: 'mcp:github', type: 'mcp', config: { toolName: 'x' } },
      { id: 'core.echo', type: 'native' },
    ] })]);
    const providers = makeProviderExecutorRegistry();
    // mcp + external-cli are NOT registered here → only native is eligible.
    const plans = new ProviderResolver(reg, providers).resolve('core.echo', ctx());
    expect(plans[0]!.steps[0]!.candidates.map((c) => c.binding.id)).toEqual(['core.echo']);
  });

  it('filters bindings whose provider type has no registered executor', () => {
    const reg = makeRegistry();
    reg.import([def({ bindings: [{ id: 'gh', type: 'external-cli', config: { executable: 'gh' } }] })]);
    const plans = new ProviderResolver(reg, makeProviderExecutorRegistry()).resolve('core.echo', ctx());
    expect(plans[0]!.steps[0]!.candidates).toHaveLength(0);
    expect(plans[0]!.steps[0]!.bindingsCount).toBe(1);   // bindings existed; provider unavailable
  });

  it('allowFallbacks default true keeps every eligible candidate', () => {
    const reg = makeRegistry();
    reg.import([def({ allowFallbacks: true, bindings: [
      { id: 'native.a', type: 'native' }, { id: 'native.b', type: 'native' },
    ] })]);
    const plans = new ProviderResolver(reg, makeProviderExecutorRegistry()).resolve('core.echo', ctx());
    expect(plans[0]!.steps[0]!.candidates).toHaveLength(2);
  });

  it('allowFallbacks false pins to binding[0] only when eligible', () => {
    const reg = makeRegistry();
    reg.import([def({ allowFallbacks: false, bindings: [
      { id: 'native.a', type: 'native' }, { id: 'native.b', type: 'native' },
    ] })]);
    const plans = new ProviderResolver(reg, makeProviderExecutorRegistry()).resolve('core.echo', ctx());
    expect(plans[0]!.steps[0]!.candidates.map((c) => c.binding.id)).toEqual(['native.a']);
  });

  it('allowFallbacks false with an ineligible binding[0] yields no candidates (STOP, not fallthrough)', () => {
    const reg = makeRegistry();
    reg.import([def({ allowFallbacks: false, bindings: [
      { id: 'gh', type: 'external-cli', config: { executable: 'gh' } },
      { id: 'native.b', type: 'native' },
    ] })]);
    const plans = new ProviderResolver(reg, makeProviderExecutorRegistry()).resolve('core.echo', ctx());
    expect(plans[0]!.steps[0]!.candidates).toHaveLength(0);   // must NOT proceed to binding[1]
  });

  it('excludes bindings rejected by the isProviderHealthy probe', () => {
    const reg = makeRegistry();
    reg.import([def({ bindings: [
      { id: 'native.a', type: 'native' }, { id: 'native.b', type: 'native' },
    ] })]);
    const resolver = new ProviderResolver(reg, makeProviderExecutorRegistry(), {
      isProviderHealthy: (b) => b.id === 'native.b',   // native.a is circuit-open/unhealthy
    });
    const plans = resolver.resolve('core.echo', ctx());
    expect(plans[0]!.steps[0]!.candidates.map((c) => c.binding.id)).toEqual(['native.b']);
  });

  it('builds multi-step plans with dependencies first (composition preserved)', () => {
    const reg = makeRegistry();
    reg.import([def({ id: 'dep.a' }), def({ id: 'dep.b' }), def({ id: 'core.composed', dependencies: ['dep.a', 'dep.b'] })]);
    const plans = new ProviderResolver(reg, makeProviderExecutorRegistry()).resolve('core.composed', ctx());
    expect(plans[0]!.steps.map((s) => s.capabilityId)).toEqual(['dep.a', 'dep.b', 'core.composed']);
  });

  it('rejects a cyclic dependency graph', () => {
    const reg = makeRegistry();
    reg.import([def({ id: 'cyc.a', dependencies: ['cyc.b'] }), def({ id: 'cyc.b', dependencies: ['cyc.a'] })]);
    expect(() => new ProviderResolver(reg, makeProviderExecutorRegistry()).resolve('cyc.a', ctx())).toThrow(/cycle|circular/i);
  });

  it('throws CapabilityNotFoundError for an unknown capability id', () => {
    expect(() => new ProviderResolver(makeRegistry(), makeProviderExecutorRegistry()).resolve('nope.missing', ctx())).toThrow(CapabilityNotFoundError);
  });

  it('reads binding.config.timeoutMs into the step timeout (aligned with the SpawnLike spawn seam)', () => {
    const reg = makeRegistry();
    reg.import([def({ bindings: [{ id: 'core.echo', type: 'native', config: { timeoutMs: 1234 } }] })]);
    const plans = new ProviderResolver(reg, makeProviderExecutorRegistry()).resolve('core.echo', ctx());
    expect(plans[0]!.steps[0]!.timeout).toBe(1234);
  });

  it('defaults the step timeout to 30_000 when the binding config has no timeoutMs', () => {
    const reg = makeRegistry();
    reg.import([def({})]);   // bindings[0] has no config
    const plans = new ProviderResolver(reg, makeProviderExecutorRegistry()).resolve('core.echo', ctx());
    expect(plans[0]!.steps[0]!.timeout).toBe(30_000);
  });
});
