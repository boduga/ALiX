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

  it('getTheme() with COLORFGBG=15;15 returns lightTheme (light bg)', () => {
    const saved = process.env.COLORFGBG;
    process.env.COLORFGBG = '15;15';
    try {
      expect(getTheme()).toBe(lightTheme);
    } finally {
      if (saved !== undefined) process.env.COLORFGBG = saved;
      else delete process.env.COLORFGBG;
    }
  });

  it('getTheme() with COLORFGBG=0;0 returns defaultTheme (dark bg)', () => {
    const saved = process.env.COLORFGBG;
    process.env.COLORFGBG = '0;0';
    try {
      expect(getTheme()).toBe(defaultTheme);
    } finally {
      if (saved !== undefined) process.env.COLORFGBG = saved;
      else delete process.env.COLORFGBG;
    }
  });

  it('themes are fully populated and return styled output', () => {
    for (const [name, theme] of Object.entries({ defaultTheme, lightTheme })) {
      // Every non-property method returns ANSI-styled output
      expect(theme.bold('x')).toContain('\x1b[');
      expect(theme.italic('x')).toContain('\x1b[');
      expect(theme.inlineCode('x')).toContain('\x1b[');
      expect(theme.strikethrough('x')).toContain('\x1b[');
      expect(theme.heading(1, 'x')).toContain('\x1b[');
      expect(theme.headingRule(1)).toContain('\x1b[');
      expect(theme.codeKeyword('x')).toContain('\x1b[');
      expect(theme.codeString('x')).toContain('\x1b[');
      expect(theme.codeComment('x')).toContain('\x1b[');
      expect(theme.codeNumber('x')).toContain('\x1b[');
      expect(theme.codeFunction('x')).toContain('\x1b[');
      expect(theme.link('x', 'https://ex.com')).toContain('\x1b[');
      expect(theme.codeLangLabel('x')).toContain('\x1b[');
      expect(theme.calloutLabel('NOTE')).toContain('\x1b[');

      // Raw prefix properties exist
      expect(typeof theme.codeBorder).toBe('string');
      expect(typeof theme.codeOperator).toBe('function');
      expect(typeof theme.codePunctuation).toBe('function');
      expect(typeof theme.codePlain).toBe('function');
      expect(typeof theme.quoteBar).toBe('string');
      expect(typeof theme.quote).toBe('function');
      expect(typeof theme.rule).toBe('string');
      expect(typeof theme.taskChecked).toBe('string');
      expect(typeof theme.taskUnchecked).toBe('string');
      expect(typeof theme.tableBorder).toBe('string');
    }
  });
});
