import { describe, it, expect } from 'vitest';

describe('monitor-tool', () => {
  it('loads without error', async () => {
    const mod = await import('../../src/tools/monitor-tool.js');
    expect(mod).toBeDefined();
  });
});
