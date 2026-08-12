// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { CapabilityService } from '../../src/capability/capability-service.js';
import { CapabilityResolver, type ResolverContext } from '../../src/capability/provider-resolver.js';
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor } from '../../src/capability/provider-executor.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap7-svc-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function setup() {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(new NativeExecutor()));
  const resolver = new CapabilityResolver(registry, providers);
  const service = new CapabilityService({ resolver, registry });
  return { catalog, registry, providers, resolver, service };
}
function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'x',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    ...over,
  };
}

describe('AC#5 — CapabilityService delegates to CapabilityResolver (identical result)', () => {
  it('service.resolve(id) returns the same plan as resolver.resolve(id) (default ctx)', () => {
    const { registry, service, resolver } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'active');
    const fromService = service.resolve('core.echo');
    const fromResolver = resolver.resolve('core.echo', {});
    expect(fromService).toEqual(fromResolver);
  });

  it('service.resolve(id, { allowDeprecated: true }) returns the same plan as resolver.resolve(id, { allowDeprecated: true })', () => {
    const { registry, service, resolver } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'deprecated');
    const ctx: ResolverContext = { allowDeprecated: true };
    expect(service.resolve('core.echo', ctx)).toEqual(resolver.resolve('core.echo', ctx));
  });

  it('service.resolve(id) is lifecycle-axis sensitive (deprecated excluded by default; same exclusion as the resolver)', () => {
    const { registry, service, resolver } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'deprecated');
    const fromService = service.resolve('core.echo');
    const fromResolver = resolver.resolve('core.echo', {});
    expect(fromService[0]!.steps[0]!.lifecycleEligibility).toEqual(fromResolver[0]!.steps[0]!.lifecycleEligibility);
    expect(fromService[0]!.steps[0]!.lifecycleEligibility.eligible).toBe(false);
  });
});

describe('AC#5/AC#6 — structural: CapabilityService does not independently reproduce the eligibility table (locked ruling #4)', () => {
  it('service module does not import LIFECYCLE_ELIGIBILITY (table ownership is the resolver — locked ruling #2)', () => {
    // Read the source file as text and assert the named import is absent.
    // This is a structural sentinel: a future PR that adds `import { LIFECYCLE_ELIGIBILITY }`
    // to the service module is a locked-ruling-#4 violation and must fail review.
    const src = readFileSync(new URL('../../src/capability/capability-service.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/import\s*\{[^}]*\bLIFECYCLE_ELIGIBILITY\b[^}]*\}\s*from\s*["']\.\/lifecycle-eligibility\.js["']/);
  });

  it('service module does not import setLifecycleState (lifecycle is read-only for the service — AC#3)', () => {
    const src = readFileSync(new URL('../../src/capability/capability-service.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/setLifecycleState/);
  });

  it('service module does not import setAvailability (availability is the resolver\'s axis — AC#6)', () => {
    const src = readFileSync(new URL('../../src/capability/capability-service.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/setAvailability/);
  });

  it('service.resolve() forwards the ResolverContext verbatim (no service-level augmentation)', () => {
    // The service must NOT add, remove, or transform ResolverContext fields.
    // A future PR that adds `service.resolve` post-processing is a locked-
    // ruling-#4 violation; this test pins the delegation shape.
    const { registry, service, resolver } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'active');
    const ctx: ResolverContext = { allowDeprecated: true };
    // Both calls produce structurally identical plans.
    expect(JSON.stringify(service.resolve('core.echo', ctx))).toBe(JSON.stringify(resolver.resolve('core.echo', ctx)));
  });
});
