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
import { CapabilityMutationExecutor } from '../../src/evolution/execution/capability-mutation-executor.js';
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';

/**
 * CAP-7 — AC#4 in-process lifecycle observability test.
 *
 * The executable form of locked ruling #3: *"After a successful A4 mutation
 * commit, CapabilityRegistry is the authoritative in-process projection
 * consumed by CapabilityResolver; no refresh, restart, polling, or event
 * subscription is required for lifecycle eligibility to reflect the new state."*
 *
 * Two paths exercise the invariant:
 *   - Path A — direct registry (`setLifecycleState` + `reload()`) proves the
 *     resolver reads the registry's current state on every resolve().
 *   - Path B — full A4 (`CapabilityMutationExecutor.executeStep` with a
 *     `capability.transition`) proves CAP-6's `registry.reload()` after the
 *     commit is the ONLY wiring needed: the same resolver instance sees the
 *     new lifecycle state on the next resolve(), with no event subscription,
 *     no polling, no restart, no resolver/registry re-instantiation.
 */

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap7-obs-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function setup() {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(new NativeExecutor()));
  return { catalog, registry, providers };
}
function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'x',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    ...over,
  };
}

describe('AC#4 — governed transition observed by the same resolver instance (CAP-7 in-process sync)', () => {
  it('Path A: direct setLifecycleState + reload is observed by the same resolver (the seam CAP-6 closes)', () => {
    const { registry, providers } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'emerging');
    const resolver = new CapabilityResolver(registry, providers);
    expect(resolver.resolve('core.echo', {})[0]!.steps[0]!.lifecycleEligibility.state).toBe('emerging');
    registry.setLifecycleState('core.echo', 'active');
    registry.reload();
    expect(resolver.resolve('core.echo', {})[0]!.steps[0]!.lifecycleEligibility.state).toBe('active');
  });

  it('Path B: a CAP-6 capability.transition is observed by the same resolver (no extra wiring)', async () => {
    const { catalog, registry, providers } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'active'); // seed: actual = 'active' so the transition's `from` precondition holds
    const resolver = new CapabilityResolver(registry, providers);
    const before = resolver.resolve('core.echo', {})[0]!.steps[0]!.lifecycleEligibility.state;
    expect(before).toBe('active');

    // CAP-6's executor: the same `registry` is the projection. After commit,
    // CAP-6 calls `registry.reload()` — the resolver sees the new state on
    // the next resolve(), with NO event bus subscription, NO polling, NO
    // resolver restart, NO registry re-instantiation.
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const step = {
      stepId: 's1', operation: 'capability.transition' as const,
      parameters: { operation: 'capability.transition' as const, capabilityId: 'core.echo', from: 'active' as const, to: 'mature' as const },
      idempotent: true, preconditions: {}, postconditions: {},
    };
    const res = await executor.executeStep(step, {});
    expect(res.success).toBe(true);

    // Same resolver instance, same registry — new state visible immediately.
    const after = resolver.resolve('core.echo', {})[0]!.steps[0]!.lifecycleEligibility;
    expect(after.state).toBe('mature');
    expect(after.eligible).toBe(true);
    expect(after.overrideUsed).toBe(false);
  });

  it('encoded invariant: no event subscription, no polling, no restart, no reload call is required', async () => {
    // This test makes the structural property explicit. The test does NOT:
    //   - subscribe to EventBus
    //   - start a timer / polling loop
    //   - recreate the resolver
    //   - recreate the registry
    //   - call registry.reload() outside the CAP-6 commit path
    // The state change is observed purely because CAP-6 calls
    // `registry.reload()` inside the transition commit (and because the
    // resolver reads the registry's current state on every resolve()).
    const { catalog, registry, providers } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'active');
    const resolver = new CapabilityResolver(registry, providers);
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const step = {
      stepId: 's1', operation: 'capability.transition' as const,
      parameters: { operation: 'capability.transition' as const, capabilityId: 'core.echo', from: 'active' as const, to: 'declining' as const },
      idempotent: true, preconditions: {}, postconditions: {},
    };
    await executor.executeStep(step, {});
    // The very next call (no awaits, no setup) sees the new state.
    expect(resolver.resolve('core.echo', {})[0]!.steps[0]!.lifecycleEligibility.state).toBe('declining');
  });
});
