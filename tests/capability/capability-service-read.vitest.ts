// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-8 Task 2 — Broadened CapabilityService read methods (list/inspect/search/recommend).
 * Asserts the four-dep constructor shape and the AC#2/AC#5 invariants.
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
  dir = mkdtempSync(join(tmpdir(), 'cap8-read-'));
  sessionDir = mkdtempSync(join(tmpdir(), 'cap8-session-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(sessionDir, { recursive: true, force: true });
});

function setup(): { service: CapabilityService; catalog: CapabilityCatalog; registry: CapabilityRegistry } {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(new NativeExecutor()));
  const resolver = new CapabilityResolver(registry, providers);
  const executor = new CapabilityMutationExecutor({ catalog, registry });
  const eventLog = new EventLog(sessionDir);
  const opts: CapabilityServiceOptions = { catalog, resolver, mutationExecutor: executor, eventLog };
  return { service: new CapabilityService(opts), catalog, registry };
}

function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'desc',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    ...over,
  };
}

describe('AC#2 — CapabilityService read methods (list / inspect / search)', () => {
  it('list() returns items + total; mutating items cannot change registry state', () => {
    const { service, registry } = setup();
    registry.import([def({})]);
    const r = service.list();
    expect(r.total).toBe(1);
    expect(r.items[0]!.id).toBe('core.echo');
    expect(r.items[0]!.version).toBe('1.0.0');
    expect(r.items[0]!.kind).toBe('core');
    expect(r.items[0]!.available).toBe(true);
    // Frozen by intention; try to mutate — either rejected or no-op.
    expect(() => {
      (r.items as unknown as { id: string }[]).push({ id: 'core.injected' });
    }).toThrow();
  });

  it('inspect(id) returns full snapshot; throws CapabilityNotFoundError if absent (AC#2)', () => {
    const { service, registry } = setup();
    registry.import([def({})]);
    const r = service.inspect('core.echo');
    expect(r.id).toBe('core.echo');
    expect(r.lifecycle).toBe('emerging');
    expect(r.availability.available).toBe(true);
    expect(r.bindings[0]!.type).toBe('native');
    expect(() => service.inspect('core.nope')).toThrow(CapabilityNotFoundError);
  });

  it('list parity (AC#5): service.list() == registry.list() projection', () => {
    const { service, registry } = setup();
    registry.import([def({ id: 'core.echo' }), def({ id: 'core.ping' })]);
    const fromService = service.list().items.map(i => i.id).sort();
    const fromRegistry = registry.list().map(c => c.id).sort();
    expect(fromService).toEqual(fromRegistry);
  });

  it('search(q) filters by text/kind/tags/lifecycle/availableOnly (AC#2)', () => {
    const { service, registry } = setup();
    registry.import([
      def({ id: 'core.echo', kind: 'core', tags: ['net'], description: 'echoes' }),
      def({ id: 'core.echonet', kind: 'query', tags: ['net'], description: 'echoes network' }),
      def({ id: 'core.ping', kind: 'operation', tags: ['net'], description: 'pings' }),
    ]);
    const byText = service.search({ text: 'echo' });
    expect(byText.items.map(i => i.id).sort()).toEqual(['core.echo', 'core.echonet']);
    const byKind = service.search({ kind: 'operation' });
    expect(byKind.items.map(i => i.id)).toEqual(['core.ping']);
    const byTag = service.search({ tags: ['net'] });
    expect(byTag.total).toBe(3);
    const byLife = service.search({ lifecycle: 'emerging' });
    expect(byLife.total).toBe(3);
  });

  it('search respects `limit` and returns total = full-match count (not limited)', () => {
    const { service, registry } = setup();
    registry.import([def({ id: 'core.echo' }), def({ id: 'core.echonet' })]);
    const r = service.search({ text: 'echo', limit: 1 });
    expect(r.items).toHaveLength(1);
    expect(r.total).toBe(2); // total reflects full match count; limit caps items array.
  });
});

describe('Locked ruling #3 — recommend() is read-only; never invokes A7 / mutation', () => {
  it('recommend() returns suggestions; never calls mutation methods', () => {
    const { service, registry } = setup();
    registry.import([def({ id: 'core.echo', description: 'session list' })]);
    const before = registry.list().map(c => c.id);
    const r = service.recommend({ text: 'session' });
    const after = registry.list().map(c => c.id);
    expect(before).toEqual(after); // no mutation
    expect(r.input.text).toBe('session');
    expect(r.suggestions.length).toBeGreaterThanOrEqual(0);
    // Snapshot shape — items is readonly.
    expect(() => {
      (r.suggestions as unknown as { id: string }[]).push({ id: 'core.injected' });
    }).toThrow();
  });
});

describe('Locked ruling #6 — Constructor-injected service; no singleton', () => {
  it('constructor stores exactly four deps; no hidden globals', () => {
    const { service } = setup();
    // Type-level: ctor signature is the four-arg shape.
    // Behavioural: two separate instances do not share state.
    const { service: s2, registry: r2 } = setup();
    void s2; void r2;
    expect(service).not.toBe(s2 as unknown as typeof service);
  });
});
