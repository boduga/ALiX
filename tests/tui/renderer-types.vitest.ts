import { describe, it, expect } from 'vitest';
import { NoopRenderer } from '../../src/tui/renderer/contract.js';
import type { OperatorRenderer } from '../../src/tui/renderer/types.js';

describe('NoopRenderer', () => {
  it('reports no capabilities', () => {
    const r: OperatorRenderer = new NoopRenderer();
    expect(r.capabilities().name).toBe('noop');
  });
  it('lifecycle does not throw', async () => {
    const r = new NoopRenderer();
    await expect(r.initialize({} as any)).resolves.toBeUndefined();
    expect(() => r.render({} as any)).not.toThrow();
    r.resize(80, 24);
    await expect(r.shutdown()).resolves.toBeUndefined();
  });
});
