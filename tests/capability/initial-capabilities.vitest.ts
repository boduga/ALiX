// tests/capability/initial-capabilities.vitest.ts
import { describe, it, expect } from 'vitest';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { registerInitialCapabilities } from '../../src/capability/initial-capabilities.js';

describe('initial capabilities', () => {
  it('registers core session + tool capabilities', () => {
    const reg = new CapabilityRegistry();
    const native = new NativeExecutor();
    registerInitialCapabilities(reg, native);
    expect(reg.find('core.session.list')).toBeDefined();
    expect(reg.find('core.session.show')).toBeDefined();
    expect(reg.find('tool.file.read')).toBeDefined();
    expect(reg.find('tool.shell.run')).toBeDefined();
    expect(reg.query({ kinds: ['core'] }).length).toBeGreaterThanOrEqual(2);
    expect(reg.query({ kinds: ['tool'] }).length).toBeGreaterThanOrEqual(2);
  });
});
