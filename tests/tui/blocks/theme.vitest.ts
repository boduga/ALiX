import { describe, it, expect } from 'vitest';
import { defaultTheme } from '../../../src/tui/blocks/theme.js';

describe('defaultTheme', () => {
  it('returns non-empty styled strings for every Theme method', () => {
    expect(defaultTheme.heading(1, 'Title')).toMatch(/\x1b\[/);
    expect(defaultTheme.heading(2, 'Title')).toMatch(/\x1b\[/);
    expect(defaultTheme.heading(3, 'Title')).toMatch(/\x1b\[/);
    expect(defaultTheme.headingRule(1)).toMatch(/[═=\-─]/);
    expect(defaultTheme.bold('x')).toMatch(/\x1b\[/);
    expect(defaultTheme.italic('x')).toMatch(/\x1b\[/);
    expect(defaultTheme.inlineCode('x')).toMatch(/\x1b\[/);
    expect(defaultTheme.codeLangLabel('python')).toMatch(/\x1b\[/);
    expect(defaultTheme.codeKeyword('def')).toMatch(/\x1b\[/);
    expect(defaultTheme.codeString('"x"')).toMatch(/\x1b\[/);
    expect(defaultTheme.codeComment('# y')).toMatch(/\x1b\[/);
    expect(defaultTheme.codeNumber('1')).toMatch(/\x1b\[/);
    expect(defaultTheme.codeFunction('fib')).toMatch(/\x1b\[/);
    // codeOperator and codePunctuation are designed to blend with code,
    // so they return text unchanged (theme comment: "no styling").
    expect(defaultTheme.codeOperator('=')).toBe('=');
    expect(defaultTheme.codePunctuation('(')).toBe('(');
    expect(defaultTheme.codePlain('x')).toBe('x');
    expect(defaultTheme.quote('x')).toMatch(/\x1b\[/);
    expect(defaultTheme.link('text', 'https://example.com')).toMatch(/\x1b\[/);
  });

  it('produces ANSI codes that pass through TerminalCanvas.write without consuming columns', () => {
    // Sanity: the prefix is what gets stamped onto cells. The visible
    // payload should be the unescaped text.
    expect(defaultTheme.bold('hello')).toContain('hello');
    expect(defaultTheme.italic('hello')).toContain('hello');
    expect(defaultTheme.inlineCode('hello')).toContain('hello');
  });

  it('exposes raw ANSI prefix strings for borders and bars', () => {
    expect(defaultTheme.codeBorder).toMatch(/\x1b\[/);
    expect(defaultTheme.quoteBar).toMatch(/\x1b\[/);
    expect(defaultTheme.rule).toMatch(/\x1b\[/);
  });
});
