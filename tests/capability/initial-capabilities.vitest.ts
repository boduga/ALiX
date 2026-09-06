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

  it('registers session-native capabilities only (no tool.* static entries)', () => {
    const reg = makeRegistry(dir);
    const native = new NativeExecutor();
    registerInitialCapabilities(reg, native);
    expect(reg.find('core.session.list')).toBeDefined();
    expect(reg.find('core.session.show')).toBeDefined();
    expect(reg.query({ kinds: ['core'] }).length).toBeGreaterThanOrEqual(2);
    // Tool capabilities are NOT part of the static list — they derive from
    // the canonical tool registry (registry-capabilities.ts).
    expect(reg.find('tool.file.read')).toBeUndefined();
    expect(reg.find('tool.shell.run')).toBeUndefined();
    expect(reg.query({ kinds: ['tool'] })).toHaveLength(0);
  });
});
