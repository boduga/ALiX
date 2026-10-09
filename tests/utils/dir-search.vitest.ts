import { describe, it, expect } from 'vitest';

describe('dir-search', () => {
  it('loads without error', async () => {
    const mod = await import('../../src/operations/utils/dir-search.js');
    expect(mod).toBeDefined();
  });
});
