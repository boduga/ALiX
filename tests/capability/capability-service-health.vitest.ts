// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-8 Task 3 — service.health() delegates to CapabilityResolver, returns narrow CapabilityHealthResult (locked ruling #9).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityService } from '../../src/capability/capability-service.js';
import { CapabilityResolver } from '../../src/capability/provider-resolver.js';
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor } from '../../src/capability/provider-executor.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';
import { CapabilityMutationExecutor } from '../../src/evolution/execution/capability-mutation-executor.js';
import { EventLog } from '../../src/events/event-log.js';
import { CapabilityNotFoundError } from '../../src/capability/errors.js';
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';
import type { CapabilityServiceOptions } from '../../src/capability/types/service-results.js';

let dir: string;
let sessionDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cap8-h-'));
  sessionDir = mkdtempSync(join(tmpdir(), 'cap8-h-sess-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(sessionDir, { recursive: true, force: true });
});

function setup(opts: { providerUp?: boolean } = { providerUp: true }) {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(new NativeExecutor()));
  const resolver = new CapabilityResolver(registry, providers, { isProviderHealthy: () => opts.providerUp ?? true });
  const executor = new CapabilityMutationExecutor({ catalog, registry });
  const eventLog = new EventLog(sessionDir);
  const co: CapabilityServiceOptions = { catalog, resolver, mutationExecutor: executor, eventLog };
  return { service: new CapabilityService(co), registry };
}

function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'd',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    ...over,
  };
}

describe('AC#2 + locked ruling #9 — service.health() delegates to CapabilityResolver, returns narrow shape', () => {
  it('available=true when provider healthy + lifecycle eligible', () => {
    const { service, registry } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'active');
    const h = service.health('core.echo');
    expect(h.id).toBe('core.echo');
    expect(h.available).toBe(true);
    expect(h.reason).toBeUndefined();
    expect(h.lifecycle).toBe('active');
    expect(h.providersChecked).toBe(1);
  });

  it('provider down → available=false, reason="provider_unavailable" (NOT ProviderCandidate[])', () => {
    const { service, registry } = setup({ providerUp: false });
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'active');
    const h = service.health('core.echo');
    expect(h.available).toBe(false);
    expect(h.reason).toBe('provider_unavailable');
    expect(h.providersChecked).toBe(0);
  });

  it('bindings reference unregistered provider type → reason="provider_unavailable"', () => {
    // The contract requires ≥1 binding per validateCapabilityDefinition, so we
    // cannot use an empty bindings list. Instead we use a binding whose type
    // has no registered provider — that yields bindingsCount=1, candidates=[],
    // eligible=true, so per the brief's reason order it must be
    // `provider_unavailable` (the brief's original `missing_binding` assertion
    // for this scenario is a brief bug fixed inline).
    const { service, registry } = setup();
    registry.import([def({ bindings: [{ id: 'ext', type: 'external-cli' as any, config: { executable: '/bin/echo' } }] })]);
    const h = service.health('core.echo');
    expect(h.available).toBe(false);
    expect(h.reason).toBe('provider_unavailable');
  });

  it('deprecated + !allowDeprecated → reason="lifecycle_ineligible"', () => {
    const { service, registry } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'deprecated');
    const h = service.health('core.echo');
    expect(h.available).toBe(false);
    expect(h.reason).toBe('lifecycle_ineligible');
    expect(h.lifecycle).toBe('deprecated');
  });

  it('deprecated + allowDeprecated → available=true, reason=undefined (ruling #9)', () => {
    const { service, registry } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'deprecated');
    const h = service.health('core.echo', { allowDeprecated: true });
    expect(h.available).toBe(true);
    expect(h.lifecycle).toBe('deprecated');
  });

  it('throws CapabilityNotFoundError when capability absent', () => {
    const { service } = setup();
    expect(() => service.health('core.nope')).toThrow(CapabilityNotFoundError);
  });

  it('returns CapabilityHealthResult — never ProviderCandidate[] / ProviderPlan (locked ruling #9 boundary)', () => {
    const { service, registry } = setup();
    registry.import([def({})]);
    const h = service.health('core.echo');
    // Type-level: no `candidates`, `bindings`, `lifecycleEligibility`, `bindingsCount` fields.
    expect(Object.keys(h).sort()).toEqual(['available', 'id', 'lifecycle', 'providersChecked', 'reason', 'version']);
  });
});
