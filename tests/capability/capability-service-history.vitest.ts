// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/** CAP-8 Task 6 — service.history() is an EventLog projection (locked ruling #5). */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
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
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';
import type { CapabilityServiceOptions } from '../../src/capability/types/service-results.js';

let dir: string;
let sessionDir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap8-hist-')); sessionDir = mkdtempSync(join(tmpdir(), 'cap8-hist-sess-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); rmSync(sessionDir, { recursive: true, force: true }); });

function setup() {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(new NativeExecutor()));
  const resolver = new CapabilityResolver(registry, providers);
  const executor = new CapabilityMutationExecutor({ catalog, registry });
  const eventLog = new EventLog(sessionDir);
  const co: CapabilityServiceOptions = { catalog, resolver, mutationExecutor: executor, eventLog };
  return { service: new CapabilityService(co), catalog, registry, executor, eventLog };
}

function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'd',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    ...over,
  };
}

describe('Locked ruling #5 + AC#6 — history() is EventLog projection (NO catalog reconstruction)', () => {
  it('filters events whose capabilityId matches, returns CapabilityHistoryResult', async () => {
    const { service, eventLog } = setup();
    await eventLog.append({
      type: 'capability.create', actor: 'system', sessionId: 's1',
      payload: { capabilityId: 'core.echo' },
    });
    await eventLog.append({
      type: 'capability.update', actor: 'system', sessionId: 's1',
      payload: { capabilityId: 'core.echo' },
    });
    await eventLog.append({
      type: 'capability.create', actor: 'system', sessionId: 's1',
      payload: { capabilityId: 'core.other' },
    });
    await eventLog.append({
      type: 'capability.transition', actor: 'system', sessionId: 's1',
      payload: { capabilityId: 'core.echo', from: 'active', to: 'mature' },
    });
    const r = await service.history('core.echo');
    const types = r.events.map(e => e.type);
    expect(types).toEqual(['capability.create', 'capability.update', 'capability.transition']);
    expect(r.total).toBe(3);
    expect(r.id).toBe('core.echo');
  });

  it('respects `limit`; total is full-match count, items is capped', async () => {
    const { service, eventLog } = setup();
    for (let i = 0; i < 5; i++) {
      await eventLog.append({
        type: 'capability.transition', actor: 'system', sessionId: 's1',
        payload: { capabilityId: 'core.echo', from: 'active', to: 'mature', step: i },
      });
    }
    const r = await service.history('core.echo', { limit: 2 });
    expect(r.events).toHaveLength(2);
    expect(r.total).toBe(5);
    // Lock LAST-N (tail) semantics: with limit=2 of 5 events, we must see steps 3 and 4,
    // NOT steps 0 and 1. A switch to slice(0, limit) (head semantics) would silently
    // regress the contract — this assertion makes that change fail loudly.
    const steps = r.events.map((e) => (e.payload as { step?: number }).step);
    expect(steps).toEqual([3, 4]);
  });

  it('returns total=0 when no events match (no fabrication; no lineage reconstruction from catalog)', async () => {
    const { service, catalog } = setup();
    const d = def({ id: 'core.echo' });
    catalog.register(d, d.bindings[0]!); // current state exists
    const r = await service.history('core.echo');
    expect(r.total).toBe(0);
    expect(r.events).toEqual([]);
  });

  it('does NOT reconstruct from catalog state — pure EventLog facts', () => {
    // Structural sentinel: the `history()` method body does NOT touch the catalog or
    // registry snapshot helpers. (Other methods like `inspect()` legitimately use
    // `catalog.get` — we scope this check to history() only.)
    const src = readFileSync(new URL('../../src/capability/capability-service.ts', import.meta.url), 'utf8');
    const historyMatch = src.match(/async history\([\s\S]*?\n  \}/);
    expect(historyMatch).not.toBeNull();
    const historyBody = historyMatch![0];
    expect(historyBody).not.toMatch(/catalog\.get\(/);
    expect(historyBody).not.toMatch(/catalog\.list\(/);
    expect(historyBody).not.toMatch(/catalog\.listPublications/);
    expect(historyBody).not.toMatch(/registry\./);
  });

  it('ascending seq ordering (locked ruling #5 — no reordering)', async () => {
    const { service, eventLog } = setup();
    await eventLog.append({
      type: 'capability.create', actor: 'system', sessionId: 's1',
      payload: { capabilityId: 'core.echo' },
    });
    await eventLog.append({
      type: 'capability.update', actor: 'system', sessionId: 's1',
      payload: { capabilityId: 'core.echo' },
    });
    await eventLog.append({
      type: 'capability.transition', actor: 'system', sessionId: 's1',
      payload: { capabilityId: 'core.echo', from: 'active', to: 'mature' },
    });
    const r = await service.history('core.echo');
    const seqs = r.events.map(e => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});
