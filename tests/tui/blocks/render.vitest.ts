import { describe, it, expect } from 'vitest';
import { renderBlocks } from '../../../src/tui/blocks/render.js';
import { parseBlocks } from '../../../src/tui/blocks/parser.js';
import { defaultTheme } from '../../../src/tui/blocks/theme.js';

const W = 60;

describe('renderBlocks', () => {
  it('renders plain text with no styling', () => {
    const blocks = parseBlocks('hello world');
    const rows = renderBlocks(blocks, defaultTheme, W);
    expect(rows).toEqual([{ text: 'hello world', isFirst: true }]);
  });

  it('renders **bold** spans with the theme bold style', () => {
    const blocks = parseBlocks('hello **world**');
    const rows = renderBlocks(blocks, defaultTheme, W);
    expect(rows[0]!.text).toContain('\x1b[1m');
    expect(rows[0]!.text).toContain('world');
    expect(rows[0]!.text).toContain('hello');
  });

  it('renders *italic* spans with the theme italic style', () => {
    const blocks = parseBlocks('hello *world*');
    const rows = renderBlocks(blocks, defaultTheme, W);
    expect(rows[0]!.text).toContain('\x1b[3m');
    expect(rows[0]!.text).toContain('world');
  });

  it('renders `inline code` spans with inverse video', () => {
    const blocks = parseBlocks('use `foo()` here');
    const rows = renderBlocks(blocks, defaultTheme, W);
    expect(rows[0]!.text).toContain('\x1b[7m');
    expect(rows[0]!.text).toContain('foo()');
  });

  it('renders headings with bold + a rule line below', () => {
    const blocks = parseBlocks('# Title');
    const rows = renderBlocks(blocks, defaultTheme, W);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text).toContain('Title');
    expect(rows[1]!.text).toMatch(/[═=\-─]/); // rule characters
  });

  it('renders blockquotes with a left bar', () => {
    const blocks = parseBlocks('> hello');
    const rows = renderBlocks(blocks, defaultTheme, W);
    expect(rows[0]!.text).toMatch(/│/);
    expect(rows[0]!.text).toContain('hello');
  });

  it('renders horizontal rules as a full-width line', () => {
    const blocks = parseBlocks('---');
    const rows = renderBlocks(blocks, defaultTheme, W);
    expect(rows[0]!.text).toContain('─'.repeat(W - 10)); // trimmed for borders
    expect(rows[0]!.text.length).toBeGreaterThan(W / 2);
  });

  it('renders lists with bullet markers', () => {
    const blocks = parseBlocks('- one\n- two');
    const rows = renderBlocks(blocks, defaultTheme, W);
    expect(rows[0]!.text).toContain('•');
    expect(rows[0]!.text).toContain('one');
    expect(rows[1]!.text).toContain('•');
    expect(rows[1]!.text).toContain('two');
  });

  it('returns isFirst: true only on the first row of the first block', () => {
    const blocks = parseBlocks('first paragraph\n\nsecond paragraph');
    const rows = renderBlocks(blocks, defaultTheme, W);
    const firsts = rows.filter((r) => r.isFirst);
    expect(firsts).toHaveLength(1);
    expect(firsts[0]!.text).toContain('first');
  });

  it('wraps long lines to the given width', () => {
    const blocks = parseBlocks('a'.repeat(200));
    const rows = renderBlocks(blocks, defaultTheme, 40);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      // Strip ANSI before measuring length.
      const visible = row.text.replace(/\x1b\[[0-9;]*m/g, '');
      expect(visible.length).toBeLessThanOrEqual(40);
    }
  });

  it('returns a placeholder row for code blocks (full code rendering in Task 6)', () => {
    const blocks = parseBlocks('```python\nx = 1\n```');
    const rows = renderBlocks(blocks, defaultTheme, W);
    // Just verify it doesn't throw and produces something.
    expect(rows.length).toBeGreaterThan(0);
  });
});
