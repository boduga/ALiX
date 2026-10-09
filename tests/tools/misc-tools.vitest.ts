import { describe, it, expect } from 'vitest';

describe('misc-tools', () => {
  it('loads without error', async () => {
    const mod = await import('../../src/capabilities/tools/misc-tools.js');
    expect(mod).toBeDefined();
  });
});
