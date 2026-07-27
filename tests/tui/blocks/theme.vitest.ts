import { describe, it, expect } from 'vitest';
import { getTheme, defaultTheme, lightTheme } from '../../../src/tui/blocks/theme.js';

describe('theme registry', () => {
  it('getTheme("dark") returns defaultTheme', () => {
    expect(getTheme('dark')).toBe(defaultTheme);
  });

  it('getTheme("light") returns lightTheme', () => {
    expect(getTheme('light')).toBe(lightTheme);
  });

  it('getTheme("unknown") returns defaultTheme', () => {
    expect(getTheme('unknown')).toBe(defaultTheme);
  });

  it('getTheme() with no arg and no COLORFGBG returns defaultTheme', () => {
    const saved = process.env.COLORFGBG;
    delete process.env.COLORFGBG;
    try {
      expect(getTheme()).toBe(defaultTheme);
    } finally {
      if (saved !== undefined) process.env.COLORFGBG = saved;
      else delete process.env.COLORFGBG;
    }
  });

  it('lightTheme is not defaultTheme', () => {
    expect(lightTheme).not.toBe(defaultTheme);
  });
});
