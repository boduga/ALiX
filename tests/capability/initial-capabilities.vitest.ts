// tests/capability/initial-capabilities.vitest.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { registerInitialCapabilities } from '../../src/capability/initial-capabilities.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';

// CAP-3: registry is a catalog projection — bootstrap via temp-dir catalog + port.
function makeRegistry(dir: string): CapabilityRegistry {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  return registry;
}

describe('initial capabilities', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap3-init-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('registers exactly the session-native set {core.session.list, core.session.show}', () => {
    const reg = makeRegistry(dir);
    const native = new NativeExecutor();
    registerInitialCapabilities(reg, native);
    // CAP-3: registry is a catalog projection — the full registered set comes
    // back through query({}) (list() == catalog state == registration).
    const ids = reg.query({}).map((c) => c.id).sort();
    expect(ids).toEqual(['core.session.list', 'core.session.show']);
    expect(reg.find('core.session.list')).toBeDefined();
    expect(reg.find('core.session.show')).toBeDefined();
    // No entry id starts with tool. — tool capabilities are NOT part of the
    // static list; they derive from the canonical tool registry
    // (registry-capabilities.ts).
    expect(ids.some((id) => id.startsWith('tool.'))).toBe(false);
    expect(reg.find('tool.file.read')).toBeUndefined();
    expect(reg.find('tool.shell.run')).toBeUndefined();
  });
});
