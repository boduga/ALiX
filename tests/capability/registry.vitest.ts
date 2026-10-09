import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityRegistry } from '../../src/capabilities/capability/registry.js';
import { toolCapabilityId } from '../../src/capabilities/capability/registry-capabilities.js';
import { buildDefaultToolIndex } from '../../src/capabilities/tools/tool-registry.js';
import { HookRegistry } from '../../src/capabilities/capability/hook-registry.js';
import { CapabilityValidationError } from '../../src/capabilities/capability/errors.js';
import { EventBus } from '../../src/capabilities/capability/event-bus.js';
import { CapabilityCatalog } from '../../src/capabilities/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capabilities/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capabilities/capability/mutation-port.js';
import type { Capability } from '../../src/capabilities/capability/types.js';

function makeCap(over: Partial<Capability> = {}): Capability {
  return {
    id: 'core.session.list', version: '1.0', kind: 'core', title: 'List sessions',
    description: 'List all sessions', tags: ['session'], category: 'session',
    risk: 'low', requiredPermissions: ['operator'], execution: { strategy: 'native' },
    ...over,
  };
}

// CAP-3: registry is a catalog projection — construct via a temp-dir catalog
// + mutation port (composition-root pattern; identical to platform.ts wiring).
function makeRegistry(dir: string): { catalog: CapabilityCatalog; registry: CapabilityRegistry } {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  return { catalog, registry };
}

describe('CapabilityRegistry', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap3-reg-legacy-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('registers, finds, unregisters', () => {
    const r = makeRegistry(dir).registry;
    r.register(makeCap());
    expect(r.find('core.session.list')?.title).toBe('List sessions');
    r.unregister('core.session.list');
    expect(r.find('core.session.list')).toBeUndefined();
  });

  it('re-registering the same capability is an idempotent no-op (bootstrap may re-run)', () => {
    const r = makeRegistry(dir).registry;
    r.register(makeCap());
    expect(() => r.register(makeCap())).not.toThrow(); // catalog-backed port is idempotent
    expect(r.list()).toHaveLength(1);
  });

  it('rejects invalid capability IDs', () => {
    const r = makeRegistry(dir).registry;
    for (const bad of ['SessionList', 'foo', '../../bad', 'noDotAtAll']) {
      expect(() => r.register(makeCap({ id: bad }))).toThrow(CapabilityValidationError);
    }
    // Valid namespaced IDs pass.
    for (const good of ['core.session.list', 'tool.file.read', 'mcp.github.issue.create']) {
      expect(() => r.register(makeCap({ id: good }))).not.toThrow();
    }
  });

  it('admits every capability id the live registry actually projects', () => {
    const r = makeRegistry(dir).registry;
    // DERIVED from the real registry via the real projection, not a hand-typed
    // list. The previous version hardcoded `tool.web_search`, `tool.fetch`,
    // `tool.create_hook` and three more — every one stale, since the executor
    // ids are now dotted (`web.search`, `hook.create`) and the registry's `name`
    // IS the executor id. The test still passed, because it only checked that
    // hand-written strings satisfy a syntax gate: it asserted nothing about the
    // projection it claimed to cover.
    const projected = buildDefaultToolIndex()
      .registry.getAll()
      // Mirrors `registerRegistryToolCapabilities`: the `mcp.*` wildcard is not
      // a concrete invocable tool, and its projected id carries a glob the
      // palette grammar rejects. Excluded in production for the same reason.
      .filter((tool) => tool.name !== 'mcp.*')
      .map((tool) => toolCapabilityId(tool.name));
    for (const id of projected) {
      expect(() => r.register(makeCap({ id }))).not.toThrow();
    }
    expect(r.list()).toHaveLength(projected.length);

    // Pin WHY it is excluded, so nobody "repairs" it by loosening the grammar:
    // the wildcard genuinely cannot be a capability id.
    expect(() => r.register(makeCap({ id: toolCapabilityId('mcp.*') }))).toThrow(
      CapabilityValidationError,
    );
  });

  it('keeps the grammar strict outside dot-segments: first-segment underscores and the mcp.* wildcard stay rejected', () => {
    const r = makeRegistry(dir).registry;
    // Underscore is legal ONLY in dot-segments — never in the first segment.
    expect(() => r.register(makeCap({ id: 'core_session.list' }))).toThrow(CapabilityValidationError);
    expect(() => r.register(makeCap({ id: '_tool.file.read' }))).toThrow(CapabilityValidationError);
    expect(() => r.register(makeCap({ id: 'tool_.file.read' }))).toThrow(CapabilityValidationError);
    // The mcp.* wildcard is not a concrete tool — glob ids stay rejected.
    expect(() => r.register(makeCap({ id: 'tool.mcp.*' }))).toThrow(CapabilityValidationError);
    expect(r.list()).toHaveLength(0);
  });

  it('query filters by tags, category, risk, permissions, kinds, namespaces', () => {
    const r = makeRegistry(dir).registry;
    r.register(makeCap({ id: 'core.session.list', tags: ['session'], category: 'session', risk: 'low' }));
    r.register(makeCap({ id: 'tool.file.read', kind: 'tool', title: 'Read file', description: 'Read file contents', tags: ['file'], category: 'file', risk: 'medium' }));
    r.register(makeCap({ id: 'tool.file.write', kind: 'tool', title: 'Write file', description: 'Write file contents', tags: ['file'], category: 'file', risk: 'high', requiredPermissions: ['admin'] }));
    expect(r.query({ tags: ['file'] }).map(c => c.id)).toEqual(['tool.file.read', 'tool.file.write']);
    expect(r.query({ category: 'file', risk: 'high' }).map(c => c.id)).toEqual(['tool.file.write']);
    expect(r.query({ permissions: 'admin' }).map(c => c.id)).toEqual(['tool.file.write']);
    expect(r.query({ kinds: ['tool'] }).length).toBe(2);
    expect(r.query({ text: 'session' }).map(c => c.id)).toEqual(['core.session.list']);
  });

  it('query supports namespace prefix filtering', () => {
    const r = makeRegistry(dir).registry;
    r.register(makeCap({ id: 'tool.file.read' }));
    r.register(makeCap({ id: 'tool.shell.run' }));
    r.register(makeCap({ id: 'core.session.list' }));
    expect(r.query({ namespaces: ['tool'] }).map(c => c.id)).toEqual(['tool.file.read', 'tool.shell.run']);
  });

  it('export is JSON-serializable round-trip', () => {
    const r = makeRegistry(dir).registry;
    r.register(makeCap());
    const round = JSON.parse(JSON.stringify(r.export()));
    expect(round.version).toBe(1);
    expect(round.functions).toHaveLength(1);
    expect(round.functions[0].id).toBe('core.session.list');
  });

  it('watch fires on register', () => {
    const r = makeRegistry(dir).registry;
    const cb = vi.fn();
    r.watch(cb);
    r.register(makeCap());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('bridges lifecycle events onto an attached EventBus', () => {
    const r = makeRegistry(dir).registry;
    const bus = new EventBus();
    const types: string[] = [];
    bus.subscribe((e) => types.push(e.type));
    r.attach(bus);
    r.register(makeCap());
    expect(types).toContain('CapabilityRegistered');
    r.unregister('core.session.list');
    expect(types).toContain('CapabilityRemoved');
  });

  it('setStatus/getStatus keep runtime state separate from metadata', () => {
    const r = makeRegistry(dir).registry;
    r.register(makeCap());
    r.setStatus('core.session.list', { availability: 'degraded', health: 'warning' });
    expect(r.getStatus('core.session.list')?.availability).toBe('degraded');
    expect(r.find('core.session.list')?.execution.strategy).toBe('native'); // metadata untouched
  });
});

describe('HookRegistry', () => {
  it('stores hooks per capability id, separate from metadata', () => {
    const h = new HookRegistry();
    const hooks = { canInvoke: () => true };
    h.set('core.session.list', hooks);
    expect(h.get('core.session.list')).toBe(hooks);
    expect(h.get('other.x')).toBeUndefined();
  });
});
