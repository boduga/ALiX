import { describe, it, expect } from 'vitest';

describe('runTui bootstrap (thin)', () => {
  it('exports a runTui function', async () => {
    const mod = await import('../../../src/cli/commands/tui.js');
    expect(typeof mod.runTui).toBe('function');
    expect(mod.runTui.length).toBeLessThanOrEqual(3);
  });
});
