// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-8 Task 4 — `apply()` delegating CAP-6 `CapabilityMutationExecutor.executeStep`.
 *
 * Locked ruling #1: service.apply() is thin delegation. No second mutation
 * execution path. CAP-6 owns validation, atomicity, rollback, registry
 * projection, governance-result dispatch.
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
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';
import type { CapabilityServiceOptions } from '../../src/capability/types/service-results.js';

let dir: string;
let sessionDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cap8-apply-'));
  sessionDir = mkdtempSync(join(tmpdir(), 'cap8-apply-sess-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(sessionDir, { recursive: true, force: true });
});

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
  return { service: new CapabilityService(co), catalog, registry, executor };
}

function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'core.newcap', version: '1.0.0', kind: 'core', title: 'NewCap', description: 'd',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.newcap', type: 'native' }],
    ...over,
  };
}

describe('AC#1/AC#3 + locked ruling #1 — service.apply() delegates verbatim to CAP-6 executor', () => {
  it('apply(capability.create) goes through executor and projects CapabilityApplyResult', async () => {
    const { service, catalog } = setup();
    const d = def({ id: 'core.newcap' });
    const result = await service.apply({
      step: {
        stepId: 's1', operation: 'capability.create',
        // CAP-5's validateCapabilityMutation runs against step.parameters and
        // requires the `operation` discriminator inside the mutation payload.
        parameters: { operation: 'capability.create', definition: d, initialLifecycle: 'emerging' },
        idempotent: false, preconditions: {}, postconditions: {},
      },
    });
    expect(result.success).toBe(true);
    expect(result.operation).toBe('capability.create');
    expect(result.affected).toEqual(['core.newcap']);
    // artifactId is a SHA-256 hex digest produced by CAP-6's executor; brief's
    // "/^ar-/" expectation was wrong — the source shape is a 64-char hex.
    expect(typeof result.artifactId).toBe('string');
    expect(result.artifactId).toMatch(/^[a-f0-9]{64}$/);
    expect(catalog.has('core.newcap')).toBe(true);
  });

  it('apply(capability.transition active → mature) writes lifecycle through CAP-6 path', async () => {
    const { service, catalog, registry } = setup();
    catalog.register(def({}), def({}).bindings[0]!);
    registry.reload();
    registry.setLifecycleState('core.newcap', 'active');
    const result = await service.apply({
      step: {
        stepId: 's2', operation: 'capability.transition',
        // Same fix: operation discriminator lives inside parameters for
        // CAP-5 mutation validation (locked #481 transition shape).
        parameters: { operation: 'capability.transition', capabilityId: 'core.newcap', from: 'active', to: 'mature' },
        idempotent: true, preconditions: {}, postconditions: {},
      },
    });
    expect(result.success).toBe(true);
    expect(registry.getLifecycleState('core.newcap')).toBe('mature');
  });

  it('apply(rejected mutation) returns success=false without mutating state (atomicity)', async () => {
    const { service, catalog, registry } = setup();
    // Empty bindings — fails CAP-5 validation inside CAP-6 executor.
    const bad = { ...def({ id: 'core.bad' }), bindings: [] } as unknown as CapabilityDefinition;
    const result = await service.apply({
      step: {
        stepId: 'bad', operation: 'capability.create',
        parameters: { operation: 'capability.create', definition: bad, initialLifecycle: 'emerging' },
        idempotent: false, preconditions: {}, postconditions: {},
      },
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(catalog.has('core.bad')).toBe(false);
    // Registry has no lifecycle/availability entries for capabilities that
    // never registered (getLifecycleState returns undefined).
    expect(registry.getLifecycleState('core.bad')).toBeUndefined();
  });

  it('locked ruling #1 invariant: service never calls catalog.register/mutationPort directly', async () => {
    // Structural sentinel: read service module source and assert it does NOT
    // import or call catalog.register / mutationPort / capturePreState, etc.
    const src = readFileSync(
      new URL('../../src/capability/capability-service.ts', import.meta.url),
      'utf8',
    );
    expect(src).not.toMatch(/catalog\.register\(/);
    expect(src).not.toMatch(/mutationPort/);
    expect(src).not.toMatch(/capturePreState|restorePreState/);
    expect(src).toMatch(/executor\.executeStep/);
  });
});
