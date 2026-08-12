import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityResolver } from '../../src/capability/provider-resolver.js';
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor } from '../../src/capability/provider-executor.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';
import type { LifecycleState } from '../../src/adaptation/capability-evolution-types.js';

/**
 * CAP-7 — AC#3 axis-isolation tests.
 *
 * The matrix (Task 3) covers the truth-table cells of `lifecycle × override × provider`.
 * This file pins the STRUCTURAL property behind AC#3: the resolver is a read-only
 * observer of lifecycle and availability; it never mutates either axis, regardless
 * of provider health, fallback exhaustion, override, or plan depth.
 *
 * Locked ruling #7: lifecycle and availability are independent axes; this module
 * encodes neither in the other. The tests below are the executable form of that
 * invariant — a behaviour assertion that holds against any future change to the
 * resolver, the registry, or the provider health probe.
 */

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap7-iso-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function setup() {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(new NativeExecutor()));
  return { registry, providers };
}
function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'x',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    ...over,
  };
}

describe('AC#3 — provider availability failures do NOT mutate lifecycle', () => {
  const states: LifecycleState[] = ['emerging', 'active', 'mature', 'stagnant', 'declining', 'deprecated'];

  for (const state of states) {
    it(`lifecycle state '${state}' is unchanged after resolve (provider up)`, () => {
      const { registry, providers } = setup();
      registry.import([def({})]);
      registry.setLifecycleState('core.echo', state);
      const before = registry.getLifecycleState('core.echo');
      new CapabilityResolver(registry, providers).resolve('core.echo', {});
      expect(registry.getLifecycleState('core.echo')).toBe(before);
    });

    it(`lifecycle state '${state}' is unchanged after resolve (provider down)`, () => {
      const { registry, providers } = setup();
      registry.import([def({})]);
      registry.setLifecycleState('core.echo', state);
      const before = registry.getLifecycleState('core.echo');
      new CapabilityResolver(registry, providers, { isProviderHealthy: () => false }).resolve('core.echo', {});
      expect(registry.getLifecycleState('core.echo')).toBe(before);
    });

    it(`lifecycle state '${state}' is unchanged after resolve with allowDeprecated override`, () => {
      const { registry, providers } = setup();
      registry.import([def({})]);
      registry.setLifecycleState('core.echo', state);
      const before = registry.getLifecycleState('core.echo');
      new CapabilityResolver(registry, providers).resolve('core.echo', { allowDeprecated: true });
      expect(registry.getLifecycleState('core.echo')).toBe(before);
    });
  }

  it('multi-step plan: provider-down dependency does NOT change its lifecycle state', () => {
    const { registry, providers } = setup();
    registry.import([
      def({ id: 'dep.a', bindings: [{ id: 'dep.a', type: 'native' }] }),
      def({ id: 'core.composed', dependencies: ['dep.a'] }),
    ]);
    registry.setLifecycleState('dep.a', 'active');
    registry.setLifecycleState('core.composed', 'mature');
    const before = { dep: registry.getLifecycleState('dep.a'), head: registry.getLifecycleState('core.composed') };
    new CapabilityResolver(registry, providers, { isProviderHealthy: () => false }).resolve('core.composed', {});
    expect(registry.getLifecycleState('dep.a')).toBe(before.dep);
    expect(registry.getLifecycleState('core.composed')).toBe(before.head);
  });

  it('resolver does not call setAvailability (availability is observed via the injected health probe, not the registry)', () => {
    const { registry, providers } = setup();
    registry.import([def({})]);
    registry.setAvailability('core.echo', { available: true });
    new CapabilityResolver(registry, providers, { isProviderHealthy: () => false }).resolve('core.echo', {});
    // The resolver does not write to availability; the registry's prior value is intact.
    expect(registry.getAvailability('core.echo')).toEqual({ available: true });
  });
});
