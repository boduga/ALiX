import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityResolver, type ResolverContext } from '../../src/capability/provider-resolver.js';
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
 * CAP-7 — Lifecycle × override × provider matrix (AC#1, AC#2, AC#3).
 *
 * This file is the executable specification of the AC#1 truth table.
 * 24 cells: 6 lifecycle states × 2 override values × 2 provider-availability values.
 * Cells assert:
 *   - `step.lifecycleEligibility.state` matches the row.
 *   - `eligible` is true unless (state === 'deprecated' && !allowDeprecated).
 *   - `overrideUsed` is true iff (state === 'deprecated' && allowDeprecated).
 *   - `candidates.length` is 1 if provider is up AND lifecycle gate passes,
 *     0 otherwise (provider down OR lifecycle blocked).
 *
 * Reviewer: read this file to verify AC#1 / AC#2 / AC#3 at a glance.
 */

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap7-matrix-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function makeRegistry() {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  return registry;
}
function makeProviders() {
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(new NativeExecutor()));
  return providers;
}
function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'x',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    ...over,
  };
}

interface Cell { state: LifecycleState; allowDeprecated: boolean; providerUp: boolean }
interface Outcome {
  eligible: boolean;
  overrideUsed: boolean;
  candidates: number;
}
function expected({ state, allowDeprecated, providerUp }: Cell): Outcome {
  const lifecycleBlocked = state === 'deprecated' && !allowDeprecated;
  const overrideUsed = state === 'deprecated' && allowDeprecated;
  return {
    eligible: !lifecycleBlocked,
    overrideUsed,
    candidates: providerUp && !lifecycleBlocked ? 1 : 0,
  };
}

describe('CAP-7 lifecycle × override × provider matrix (AC#1, AC#2, AC#3)', () => {
  const states: LifecycleState[] = ['emerging', 'active', 'mature', 'stagnant', 'declining', 'deprecated'];
  for (const state of states) {
    for (const allowDeprecated of [false, true]) {
      for (const providerUp of [true, false]) {
        const label = `${state} / allowDeprecated=${allowDeprecated} / providerUp=${providerUp}`;
        it(label, () => {
          const reg = makeRegistry();
          reg.import([def({})]);
          reg.setLifecycleState('core.echo', state);
          const resolver = new CapabilityResolver(
            reg, makeProviders(),
            { isProviderHealthy: () => providerUp },
          );
          const ctx: ResolverContext = allowDeprecated ? { allowDeprecated: true } : {};
          const plans = resolver.resolve('core.echo', ctx);
          const step = plans[0]!.steps[0]!;
          const want = expected({ state, allowDeprecated, providerUp });
          expect(step.lifecycleEligibility).toEqual({ state, eligible: want.eligible, overrideUsed: want.overrideUsed });
          expect(step.candidates).toHaveLength(want.candidates);
        });
      }
    }
  }

  it('AC#1 truth-table excerpts (spot-checks the ticket\'s enumerated cells)', () => {
    // active + healthy + !override → eligible, candidates=1
    {
      const reg = makeRegistry(); reg.import([def({})]); reg.setLifecycleState('core.echo', 'active');
      const step = new CapabilityResolver(reg, makeProviders()).resolve('core.echo', {})[0]!.steps[0]!;
      expect(step.lifecycleEligibility).toEqual({ state: 'active', eligible: true, overrideUsed: false });
      expect(step.candidates).toHaveLength(1);
    }
    // mature + provider-down + !override → lifecycle-eligible, candidates=0 (AC#3: lifecycle does NOT move)
    {
      const reg = makeRegistry(); reg.import([def({})]); reg.setLifecycleState('core.echo', 'mature');
      const resolver = new CapabilityResolver(reg, makeProviders(), { isProviderHealthy: () => false });
      const step = resolver.resolve('core.echo', {})[0]!.steps[0]!;
      expect(step.lifecycleEligibility).toEqual({ state: 'mature', eligible: true, overrideUsed: false });
      expect(step.candidates).toHaveLength(0);
      // Lifecycle state remains mature — no mutation from the resolver.
      expect(reg.getLifecycleState('core.echo')).toBe('mature');
    }
    // deprecated + healthy + !override → eligible=false, candidates=0
    {
      const reg = makeRegistry(); reg.import([def({})]); reg.setLifecycleState('core.echo', 'deprecated');
      const step = new CapabilityResolver(reg, makeProviders()).resolve('core.echo', {})[0]!.steps[0]!;
      expect(step.lifecycleEligibility).toEqual({ state: 'deprecated', eligible: false, overrideUsed: false });
      expect(step.candidates).toHaveLength(0);
    }
    // deprecated + healthy + override → eligible=true, overrideUsed=true, candidates=1
    {
      const reg = makeRegistry(); reg.import([def({})]); reg.setLifecycleState('core.echo', 'deprecated');
      const step = new CapabilityResolver(reg, makeProviders()).resolve('core.echo', { allowDeprecated: true })[0]!.steps[0]!;
      expect(step.lifecycleEligibility).toEqual({ state: 'deprecated', eligible: true, overrideUsed: true });
      expect(step.candidates).toHaveLength(1);
    }
  });
});
