// tests/capability/platform.vitest.ts
import { describe, it, expect } from 'vitest';
import { CapabilityPlatform } from '../../src/capability/platform.js';
import { registerInitialCapabilities } from '../../src/capability/initial-capabilities.js';
import { registerSessionCapabilities } from '../../src/integrations/session-capabilities.js';

describe('CapabilityPlatform bootstrap', () => {
  it('composes all five services and invokes end-to-end', async () => {
    const platform = new CapabilityPlatform();
    registerInitialCapabilities(platform.registry, platform.native);
    await registerSessionCapabilities(platform.registry, platform.native);
    const inv = platform.invoke('core.session.list', {}, { actor: 'operator', cwd: process.cwd(), workspace: process.cwd() });
    const result = await inv.wait();
    expect(result.status).toBe('completed');
    expect(result.output).toBeDefined();
  });

  it('exposes query for discovery', () => {
    const platform = new CapabilityPlatform();
    registerInitialCapabilities(platform.registry, platform.native);
    expect(platform.query({ kinds: ['core'] }).length).toBeGreaterThanOrEqual(2);
  });
});
