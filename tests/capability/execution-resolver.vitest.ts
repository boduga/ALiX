import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionResolver } from '../../src/capability/execution-resolver.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CapabilityNotFoundError } from '../../src/capability/errors.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';
import type { Capability, CapabilityContext } from '../../src/capability/types.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap3-resolver-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

// CAP-3: registry is a catalog projection — build over a temp-dir catalog + port.
function makeRegistry(): CapabilityRegistry {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  return registry;
}

function ctx(): CapabilityContext {
  return {
    invocationId: 'inv-1', requestId: 'req-1', actor: 'operator',
    permissions: ['operator'], cwd: '/', workspace: '/', sessionId: 's1',
    cancellationToken: new AbortController().signal,
    eventBus: { emit: () => {} },
  };
}

describe('ExecutionResolver', () => {
  it('resolves a native capability to a single-step native plan with capabilityId', () => {
    const reg = makeRegistry();
    reg.register({
      id: 'core.session.list', version: '1.0', kind: 'core', title: 'List', description: 'x',
      tags: [], category: 'session', risk: 'low', requiredPermissions: ['operator'],
      execution: { strategy: 'native', timeout: 5000, cancellable: true },
    });
    const plans = new ExecutionResolver(reg).resolve('core.session.list', ctx());
    expect(plans).toHaveLength(1);
    expect(plans[0]!.capabilityId).toBe('core.session.list');
    expect(plans[0]!.steps).toHaveLength(1);
    expect(plans[0]!.steps[0]!.executor).toBe('native');
    expect(plans[0]!.steps[0]!.timeout).toBe(5000);
  });

  it('applies the strategy default timeout when absent', () => {
    const reg = makeRegistry();
    reg.register({
      id: 'git.commit', version: '1.0', kind: 'core', title: 'Commit', description: 'x',
      tags: [], category: 'git', risk: 'high', requiredPermissions: ['developer'],
      execution: { strategy: 'cli' }, extensions: { executable: 'git' },
    });
    const plans = new ExecutionResolver(reg).resolve('git.commit', ctx());
    expect(plans[0]!.steps[0]!.timeout).toBe(30_000);
  });

  it('throws CapabilityNotFoundError for an unknown capability id', () => {
    const resolver = new ExecutionResolver(makeRegistry());
    expect(() => resolver.resolve('nope.missing', ctx())).toThrow(CapabilityNotFoundError);
  });

  // ── Phase 3 (#308): composition pipelines ─────────────────────────

  it('resolves a capability with dependencies into a multi-step plan (deps first, then self)', () => {
    const reg = makeRegistry();
    reg.register({
      id: 'dep.a', version: '1.0', kind: 'core', title: 'A', description: 'x',
      tags: [], category: 'session', risk: 'low', requiredPermissions: ['operator'],
      execution: { strategy: 'native', timeout: 5000, cancellable: true },
    });
    reg.register({
      id: 'dep.b', version: '1.0', kind: 'core', title: 'B', description: 'x',
      tags: [], category: 'session', risk: 'low', requiredPermissions: ['operator'],
      execution: { strategy: 'native', timeout: 5000, cancellable: true },
    });
    reg.register({
      id: 'core.composed', version: '1.0', kind: 'core', title: 'Composed', description: 'x',
      tags: [], category: 'session', risk: 'low', requiredPermissions: ['operator'],
      dependencies: ['dep.a', 'dep.b'],
      execution: { strategy: 'native', timeout: 5000, cancellable: true },
    });

    const plans = new ExecutionResolver(reg).resolve('core.composed', ctx());
    expect(plans).toHaveLength(1);
    // 2 dependency steps + the composed capability's own step = 3 steps.
    expect(plans[0]!.steps).toHaveLength(3);
    // Dependencies run first, each carrying its own capabilityId + executor.
    expect(plans[0]!.steps[0]).toMatchObject({ executor: 'native', capabilityId: 'dep.a' });
    expect(plans[0]!.steps[1]).toMatchObject({ executor: 'native', capabilityId: 'dep.b' });
    // The final step is the composed capability itself.
    expect(plans[0]!.steps[2]).toMatchObject({ capabilityId: 'core.composed' });
  });

  it('rejects a cyclic dependency graph', () => {
    const reg = makeRegistry();
    reg.register({
      id: 'cyc.a', version: '1.0', kind: 'core', title: 'A', description: 'x',
      tags: [], category: 'session', risk: 'low', requiredPermissions: ['operator'],
      dependencies: ['cyc.b'], execution: { strategy: 'native' },
    });
    reg.register({
      id: 'cyc.b', version: '1.0', kind: 'core', title: 'B', description: 'x',
      tags: [], category: 'session', risk: 'low', requiredPermissions: ['operator'],
      dependencies: ['cyc.a'], execution: { strategy: 'native' },
    });
    expect(() => new ExecutionResolver(reg).resolve('cyc.a', ctx())).toThrow(/cycle|circular/i);
  });
});
