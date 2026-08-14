// tests/capability/platform.vitest.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityPlatform } from '../../src/capability/platform.js';
import { registerInitialCapabilities } from '../../src/capability/initial-capabilities.js';
import { registerSessionCapabilities } from '../../src/integrations/session-capabilities.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';

describe('CapabilityPlatform bootstrap', () => {
  let dir: string;
  let sessionDir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap8-plat-')); sessionDir = mkdtempSync(join(tmpdir(), 'cap8-plat-sess-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); rmSync(sessionDir, { recursive: true, force: true }); });

  // R10 — test-owned catalog composed into the platform; `registerInitialCapabilities`
  // and `registerSessionCapabilities` accept a CapabilityRegistry, so wrap our catalog
  // in one with the catalog-backed mutation port (idempotent registration).
  function makePlatformWithRegistry(): { platform: CapabilityPlatform; registry: CapabilityRegistry } {
    const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    const platform = new CapabilityPlatform({ catalog, eventLog: { append: async () => {}, readAll: async () => [] } as never });
    const registry = new CapabilityRegistry(catalog);
    registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
    return { platform, registry };
  }

  function bootstrapPlatform(): CapabilityPlatform {
    const { platform, registry } = makePlatformWithRegistry();
    registerInitialCapabilities(registry, platform.native);
    return platform;
  }

  async function bootstrapPlatformWithSession(): Promise<CapabilityPlatform> {
    const { platform, registry } = makePlatformWithRegistry();
    registerInitialCapabilities(registry, platform.native);
    await registerSessionCapabilities(registry, platform.native);
    return platform;
  }

  it('composes all five services and invokes end-to-end', async () => {
    const platform = await bootstrapPlatformWithSession();
    const inv = platform.invoke('core.session.list', {}, { actor: 'operator', cwd: process.cwd(), workspace: process.cwd() });
    const result = await inv.wait();
    expect(result.status).toBe('completed');
    expect(result.output).toBeDefined();
  });

  it('fails core.session.show cleanly when sessionId is missing', async () => {
    const platform = await bootstrapPlatformWithSession();
    const inv = platform.invoke('core.session.show', {}, { actor: 'operator', cwd: process.cwd(), workspace: process.cwd() });
    const result = await inv.wait();
    expect(result.status).toBe('failed');
    expect(result.error).toBe('sessionId argument required');
  });

  it('exposes discovery through the public service surface', () => {
    const platform = bootstrapPlatform();
    // R10 — public behavior asserts through platform.service (sole capability surface).
    const items = platform.service.list().items;
    const coreCount = items.filter(i => i.kind === 'core').length;
    expect(coreCount).toBeGreaterThanOrEqual(2);
  });
});
