import { describe, it, expect } from 'vitest';

describe('dir-search', () => {
  it('loads without error', async () => {
    const mod = await import('../../src/utils/dir-search.js');
    expect(mod).toBeDefined();
  });
});
