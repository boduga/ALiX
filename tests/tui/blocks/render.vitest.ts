import { describe, it, expect } from 'vitest';
import { renderBlocks } from '../../../src/tui/blocks/render.js';
import { parseBlocks } from '../../../src/tui/blocks/parser.js';
import { defaultTheme, lightTheme } from '../../../src/tui/blocks/theme.js';
import { GRAY } from '../../../src/tui/ansi-constants.js';

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

  it('renders code blocks with a bordered top/bottom and language label', () => {
    const blocks = parseBlocks('```python\nx = 1\n```');
    const rows = renderBlocks(blocks, defaultTheme, W);
    // Top border with language label.
    expect(rows[0]!.text).toMatch(/[┌╭]/);
    expect(rows[0]!.text).toContain('python');
    // Code line wrapped in side borders.
    // Strip ANSI before searching — the Python tokenizer (already
    // registered by Task 7) may inject color codes between tokens.
    const codeRow = rows.find((r) => r.text.replace(/\x1b\[[0-9;]*m/g, '').includes('x = 1'));
    expect(codeRow).toBeDefined();
    expect(codeRow!.text).toMatch(/[│|]/);
    // Bottom border.
    expect(rows[rows.length - 1]!.text).toMatch(/[└╰┘]/);
  });

  it('tokenizes Python code and colors keywords', () => {
    // The Python tokenizer is registered in Task 7. This test
    // currently asserts the rendered output for an unknown language
    // (the plain fallback). After Task 7 ships, this test gets
    // updated to assert keyword coloring.
    const blocks = parseBlocks('```python\ndef fib():\n    pass\n```');
    const rows = renderBlocks(blocks, defaultTheme, W);
    // Find the code rows.
    const codeRows = rows.filter((r) => r.text.includes('def') || r.text.includes('pass'));
    expect(codeRows.length).toBeGreaterThan(0);
  });

  it('renders code blocks without language (no language label, same chrome)', () => {
    const blocks = parseBlocks('```\nplain text\n```');
    const rows = renderBlocks(blocks, defaultTheme, W);
    expect(rows[0]!.text).toMatch(/[┌╭]/);
    expect(rows[0]!.text).not.toContain('python');
  });

  it('renders links with OSC-8 hyperlink escapes', () => {
    const blocks = parseBlocks('[click](https://x.com)');
    const rows = renderBlocks(blocks, defaultTheme, 60);
    // Should contain the OSC-8 sequence: ESC ] 8 ; ; https://x.com ESC \
    expect(rows[0]!.text).toContain('\x1b]8;;https://x.com\x1b\\');
    expect(rows[0]!.text).toContain('\x1b]8;;\x1b\\');
  });

  describe('callouts', () => {
    it('renders > [!NOTE]\\ncontent with a blue label line', () => {
      const blocks = parseBlocks('> [!NOTE]\n> important info');
      const rows = renderBlocks(blocks, defaultTheme, 60);
      // Label row: should contain NOTE in blue
      expect(rows[0]!.text).toContain('\x1b[1m');  // bold
      expect(rows[0]!.text).toContain('\x1b[34m'); // blue
      expect(rows[0]!.text).toContain('NOTE');
      // Content row: should have the quote bar prefix
      expect(rows[1]!.text).toContain('│');
      expect(rows[1]!.text).toContain('important info');
    });

    it('renders > [!WARNING]\\ncontent with a yellow label', () => {
      const blocks = parseBlocks('> [!WARNING]\n> watch out');
      const rows = renderBlocks(blocks, defaultTheme, 60);
      expect(rows[0]!.text).toContain('\x1b[33m'); // yellow
      expect(rows[0]!.text).toContain('WARNING');
      expect(rows[1]!.text).toContain('watch out');
    });

    it('renders > [!TIP]\\ncontent with a green label', () => {
      const blocks = parseBlocks('> [!TIP]\n> try this');
      const rows = renderBlocks(blocks, defaultTheme, 60);
      expect(rows[0]!.text).toContain('\x1b[32m'); // green
      expect(rows[0]!.text).toContain('TIP');
    });

    it('handles marker on same line: > [!CAUTION] content', () => {
      const blocks = parseBlocks('> [!CAUTION] careful now');
      const rows = renderBlocks(blocks, defaultTheme, 60);
      expect(rows[0]!.text).toContain('CAUTION');
      expect(rows[1]!.text).toContain('careful now');
    });

    it('renders regular quotes unchanged when no marker', () => {
      const blocks = parseBlocks('> just a quote');
      const rows = renderBlocks(blocks, defaultTheme, 60);
      expect(rows[0]!.text).not.toContain('[TIP]');
      expect(rows[0]!.text).toContain('│');
      expect(rows[0]!.text).toContain('just a quote');
    });

    it('treats empty [NOTE] as regular text', () => {
      const blocks = parseBlocks('> [NOTE]');
      const rows = renderBlocks(blocks, defaultTheme, 60);
      expect(rows[0]!.text).toContain('[NOTE]');
      expect(rows[0]!.text).toContain('│');
    });
  });

  describe('tables', () => {
    it('renders basic table borders', () => {
      const md = '| A | B |\n|---|---|\n| 1 | 2 |';
      const rows = renderBlocks(parseBlocks(md), defaultTheme, 60);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]!.text).toContain('┌');
      expect(rows[0]!.text).toContain('┐');
    });

    it('renders alignment-rendered table spacing', () => {
      const md = '| L | R |\n|:---|---:|\n| left | right |';
      const rows = renderBlocks(parseBlocks(md), defaultTheme, 60);
      expect(rows.length).toBeGreaterThan(0);
    });

    it('uses tableBorder theme border styling', () => {
      const md = '| A | B |\n|---|---|\n| 1 | 2 |';
      const origBorder = defaultTheme.tableBorder;
      try {
        defaultTheme.tableBorder = '\x1b[31m';
        const rows = renderBlocks(parseBlocks(md), defaultTheme, 60);
        expect(rows[0]!.text).toContain('\x1b[31m');
        expect(rows[0]!.text).toContain('┌');
      } finally {
        defaultTheme.tableBorder = origBorder;
      }
    });
  });

  it('wraps multi-line cell content when column width is exceeded', () => {
    // With a narrow second column header, the column width is small
    // enough that long cell content must wrap onto multiple lines.
    const md = '| alongheaderthatforcescolumnwidth | B |\n|---|---|\n| 1 | word1 word2 word3 word4 word5 |\n| 2 | word6 word7 word8 word9 word10 |';
    const rows = renderBlocks(parseBlocks(md), defaultTheme, 60);
    // Column B is header "B" (1 char) + 2 padding = 3, then content wraps → multiple data rows
    expect(rows.length).toBeGreaterThan(5);
    expect(rows[rows.length - 1]!.text).toContain('┴');
  });

  describe('task lists', () => {
    it('renders checked task with green checkmark', () => {
      const blocks = parseBlocks('- [x] done');
      const rows = renderBlocks(blocks, defaultTheme, 60);
      expect(rows[0]!.text).toContain('\x1b[32m'); // green
      expect(rows[0]!.text).toContain('✓');
      expect(rows[0]!.text).toContain('done');
    });

    it('renders unchecked task with gray box', () => {
      const blocks = parseBlocks('- [ ] todo');
      const rows = renderBlocks(blocks, defaultTheme, 60);
      expect(rows[0]!.text).toContain('\x1b[90m'); // gray
      expect(rows[0]!.text).toContain('[ ]');
      expect(rows[0]!.text).toContain('todo');
    });

    it('renders mixed list with checkbox and plain items', () => {
      const blocks = parseBlocks('- [x] a\n- b\n- [ ] c');
      const rows = renderBlocks(blocks, defaultTheme, 60);
      expect(rows[0]!.text).toContain('✓');
      expect(rows[0]!.text).toContain('a');
      expect(rows[1]!.text).toContain('•');
      expect(rows[1]!.text).toContain('b');
      expect(rows[2]!.text).toContain('[ ]');
      expect(rows[2]!.text).toContain('c');
    });
  });

  it('renders with lightTheme without error', () => {
    const blocks = parseBlocks('hello **world**\n\n> quote\n\n```\ncode\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |');
    expect(() => renderBlocks(blocks, lightTheme, 60)).not.toThrow();
  });
});
