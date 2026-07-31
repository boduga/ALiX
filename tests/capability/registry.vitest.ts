import { describe, it, expect, vi } from 'vitest';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { HookRegistry } from '../../src/capability/hook-registry.js';
import { CapabilityValidationError } from '../../src/capability/errors.js';
import { EventBus } from '../../src/capability/event-bus.js';
import type { Capability } from '../../src/capability/types.js';

function makeCap(over: Partial<Capability> = {}): Capability {
  return {
    id: 'core.session.list', version: '1.0', kind: 'core', title: 'List sessions',
    description: 'List all sessions', tags: ['session'], category: 'session',
    risk: 'low', requiredPermissions: ['operator'], execution: { strategy: 'native' },
    ...over,
  };
}

describe('CapabilityRegistry', () => {
  it('registers, finds, unregisters', () => {
    const r = new CapabilityRegistry();
    r.register(makeCap());
    expect(r.find('core.session.list')?.title).toBe('List sessions');
    r.unregister('core.session.list');
    expect(r.find('core.session.list')).toBeUndefined();
  });

  it('rejects duplicate registration', () => {
    const r = new CapabilityRegistry();
    r.register(makeCap());
    expect(() => r.register(makeCap())).toThrow(/already registered/);
  });

  it('rejects invalid capability IDs', () => {
    const r = new CapabilityRegistry();
    for (const bad of ['SessionList', 'foo', '../../bad', 'noDotAtAll']) {
      expect(() => r.register(makeCap({ id: bad }))).toThrow(CapabilityValidationError);
    }
    // Valid namespaced IDs pass.
    for (const good of ['core.session.list', 'tool.file.read', 'mcp.github.issue.create']) {
      expect(() => r.register(makeCap({ id: good }))).not.toThrow();
    }
  });

  it('query filters by tags, category, risk, permissions, kinds, namespaces', () => {
    const r = new CapabilityRegistry();
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
    const r = new CapabilityRegistry();
    r.register(makeCap({ id: 'tool.file.read' }));
    r.register(makeCap({ id: 'tool.shell.run' }));
    r.register(makeCap({ id: 'core.session.list' }));
    expect(r.query({ namespaces: ['tool'] }).map(c => c.id)).toEqual(['tool.file.read', 'tool.shell.run']);
  });

  it('export is JSON-serializable round-trip', () => {
    const r = new CapabilityRegistry();
    r.register(makeCap());
    const round = JSON.parse(JSON.stringify(r.export()));
    expect(round.version).toBe(1);
    expect(round.functions).toHaveLength(1);
    expect(round.functions[0].id).toBe('core.session.list');
  });

  it('watch fires on register', () => {
    const r = new CapabilityRegistry();
    const cb = vi.fn();
    r.watch(cb);
    r.register(makeCap());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('bridges lifecycle events onto an attached EventBus', () => {
    const r = new CapabilityRegistry();
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
    const r = new CapabilityRegistry();
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
