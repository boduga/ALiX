import { describe, it, expect } from 'vitest';
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor } from '../../src/capability/provider-executor.js';
import { NativeExecutor } from '../../src/capability/executors.js';

describe('ProviderExecutorRegistry', () => {
  it('registers and retrieves a provider by type', () => {
    const reg = new ProviderExecutorRegistry();
    const exec = new NativeProviderExecutor(new NativeExecutor());
    reg.register('native', exec);
    expect(reg.get('native')).toBe(exec);
    expect(reg.has('native')).toBe(true);
    expect(reg.listTypes()).toEqual(['native']);
  });

  it('returns undefined for an unregistered type', () => {
    expect(new ProviderExecutorRegistry().get('mcp')).toBeUndefined();
  });

  it('rejects duplicate registration for the same type', () => {
    const reg = new ProviderExecutorRegistry();
    reg.register('native', new NativeProviderExecutor(new NativeExecutor()));
    expect(() => reg.register('native', new NativeProviderExecutor(new NativeExecutor()))).toThrow(/already registered/i);
  });
});
