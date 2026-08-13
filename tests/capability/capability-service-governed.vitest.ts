// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-8 Task 5 — `propose()` / `measure()` forward-wired stubs + `recommend()`
 * read-only contract.
 *
 * Locked ruling #4: propose()/measure() throw a stable error class
 * (`CapabilityServiceNotImplementedError`, code `not_implemented_yet`). They do
 * NOT return empty/envelope results and do NOT encode roadmap state in the
 * message. CAP-9/CAP-10 replace the body, keeping the same contract.
 *
 * Locked ruling #3: `recommend()` is read-only — plain suggestions, never A7
 * governance.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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
import { CapabilityServiceNotImplementedError } from '../../src/capability/errors/service-not-implemented.js';
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';
import type { CapabilityServiceOptions } from '../../src/capability/types/service-results.js';

let dir: string;
let sessionDir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap8-gov-')); sessionDir = mkdtempSync(join(tmpdir(), 'cap8-gov-sess-')); });
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
  return { service: new CapabilityService(co), catalog, registry };
}

function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'd',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    ...over,
  };
}

describe('Locked ruling #4 — propose() / measure() are forward-wired stubs', () => {
  it('service.propose exists; rejects with CapabilityServiceNotImplementedError, code = "not_implemented_yet"', async () => {
    const { service } = setup();
    let caught: unknown;
    try {
      await service.propose({ intent: 'add capability core.echo' });
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(CapabilityServiceNotImplementedError);
    expect((caught as CapabilityServiceNotImplementedError).code).toBe('not_implemented_yet');
    expect((caught as CapabilityServiceNotImplementedError).message).not.toMatch(/awaiting_cap_(9|10)/i);
  });

  it('service.measure exists; rejects with CapabilityServiceNotImplementedError, code = "not_implemented_yet"', async () => {
    const { service } = setup();
    let caught: unknown;
    try {
      // CAP-10 ruling #2 — measure() takes { capabilityId, version,
      // baselineObservationId? } (CAP-9 forward-wired stub only accepted
      // `unknown`; CAP-10 narrows the signature).
      await service.measure({ capabilityId: 'core.echo', version: '1.0.0' });
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(CapabilityServiceNotImplementedError);
    expect((caught as CapabilityServiceNotImplementedError).code).toBe('not_implemented_yet');
    expect((caught as CapabilityServiceNotImplementedError).message).not.toMatch(/awaiting_cap_(9|10)/i);
  });

  it('propose()/measure() do not mutate catalog / registry state', async () => {
    const { service, catalog, registry } = setup();
    catalog.register(def({}), def({}).bindings[0]!);
    registry.reload();
    const beforeItems = registry.list().length;
    try { await service.propose({}); } catch { /* expected */ }
    try { await service.measure({ capabilityId: 'core.echo', version: '1.0.0' }); } catch { /* expected */ }
    expect(registry.list().length).toBe(beforeItems);
  });

  it('propose()/measure() do not invoke unrelated capability machinery', () => {
    // Structural: service source does NOT import the proposal builder / measurer
    // / capability-evolution intelligence writers.
    const src = readFileSync(new URL('../../src/capability/capability-service.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/capability-proposal-builder|capability-lifecycle-measurer|capability-evolution-intelligence/);
    expect(src).not.toMatch(/throw new Error\(.unimplemented.|NoOp/);
    // The only error is the stable class.
    expect(src).toMatch(/CapabilityServiceNotImplementedError/);
  });
});

describe('Locked ruling #3 — recommend() never triggers A7 governance machinery', () => {
  it('service source does not import proposal builder (structural pin)', () => {
    const src = readFileSync(new URL('../../src/capability/capability-service.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/capability-proposal-builder/);
    expect(src).not.toMatch(/generateProposal|buildProposal|proposeMutation/);
  });

  it('recommend() is read-only: returns plain suggestions and mutates no state', () => {
    const { service, catalog, registry } = setup();
    catalog.register(def({}), def({}).bindings[0]!);
    registry.reload();
    const before = registry.list().length;
    const res = service.recommend({ text: 'echo' });
    expect(res.total).toBe(res.suggestions.length);
    expect(registry.list().length).toBe(before);
  });
});
