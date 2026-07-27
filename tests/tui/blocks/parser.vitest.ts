import { describe, it, expect } from 'vitest';
import { parseBlocks } from '../../../src/tui/blocks/parser.js';

describe('parseBlocks', () => {
  it('returns empty array for empty input', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks(' \n \n')).toEqual([]);
  });

  it('parses plain text into a text block', () => {
    expect(parseBlocks('hello world')).toEqual([
      { type: 'text', text: 'hello world' },
    ]);
  });

  it('parses fenced code with language', () => {
    expect(parseBlocks('```python\nx = 1\n```')).toEqual([
      { type: 'code', language: 'python', code: 'x = 1', spans: undefined },
    ]);
  });

  it('parses fenced code without language', () => {
    expect(parseBlocks('```\nx = 1\n```')).toEqual([
      { type: 'code', code: 'x = 1', spans: undefined },
    ]);
  });

  it('parses unordered lists', () => {
    expect(parseBlocks('- a\n- b\n- c')).toEqual([
      { type: 'list', marker: 'unordered', items: ['a', 'b', 'c'] },
    ]);
  });

  it('parses ordered lists', () => {
    expect(parseBlocks('1. a\n2. b\n3. c')).toEqual([
      { type: 'list', marker: 'ordered', items: ['a', 'b', 'c'] },
    ]);
  });

  it('parses H1 headings', () => {
    expect(parseBlocks('# Title')).toEqual([
      { type: 'heading', level: 1, text: 'Title', spans: undefined },
    ]);
  });

  it('parses H2/H3 headings', () => {
    expect(parseBlocks('## Sub')).toEqual([
      { type: 'heading', level: 2, text: 'Sub', spans: undefined },
    ]);
    expect(parseBlocks('### Subsub')).toEqual([
      { type: 'heading', level: 3, text: 'Subsub', spans: undefined },
    ]);
  });

  it('rejects H4+ as plain text', () => {
    expect(parseBlocks('#### Four')).toEqual([
      { type: 'text', text: '#### Four' },
    ]);
  });

  it('parses blockquotes — single line', () => {
    expect(parseBlocks('> hello world')).toEqual([
      { type: 'quote', text: 'hello world', spans: undefined },
    ]);
  });

  it('parses blockquotes — multiple lines', () => {
    expect(parseBlocks('> first\n> second\n> third')).toEqual([
      { type: 'quote', text: 'first\nsecond\nthird', spans: undefined },
    ]);
  });

  it('parses blockquotes — terminated by blank line', () => {
    expect(parseBlocks('> quoted\n\nnot quoted')).toEqual([
      { type: 'quote', text: 'quoted', spans: undefined },
      { type: 'text', text: 'not quoted' },
    ]);
  });

  it('parses horizontal rules (---)', () => {
    expect(parseBlocks('---')).toEqual([{ type: 'rule' }]);
  });

  it('parses horizontal rules (***) and (___)', () => {
    expect(parseBlocks('***')).toEqual([{ type: 'rule' }]);
    expect(parseBlocks('___')).toEqual([{ type: 'rule' }]);
  });

  it('mixes blocks in document order', () => {
    const md = '# Title\n\nA paragraph.\n\n```python\nx = 1\n```\n\n- item 1\n- item 2';
    expect(parseBlocks(md)).toEqual([
      { type: 'heading', level: 1, text: 'Title', spans: undefined },
      { type: 'text', text: 'A paragraph.' },
      { type: 'code', language: 'python', code: 'x = 1', spans: undefined },
      { type: 'list', marker: 'unordered', items: ['item 1', 'item 2'] },
    ]);
  });

  it('treats unclosed fences as plain text', () => {
    expect(parseBlocks('```python\nx = 1')).toEqual([
      { type: 'text', text: '```python\nx = 1' },
    ]);
  });
});

describe('tables', () => {
  it('parses pipe table headers rows', () => {
    const md = '| Name | Lang |\n|------|------|\n| Alice | TS |\n| Bob | Rust |';
    const result = parseBlocks(md);
    expect(result).toHaveLength(1);
    const table = result[0]!;
    expect(table).toHaveProperty('type', 'table');
    if (table.type === 'table') {
      expect(table.headers).toEqual(['Name', 'Lang']);
      expect(table.rows).toEqual([['Alice', 'TS'], ['Bob', 'Rust']]);
    }
  });

  it('parses alignment specifiers from delimiter row', () => {
    const md = '| L | C | R |\n|:---|:--:|---:|\n| a | b | c |';
    const result = parseBlocks(md);
    if (result[0]!.type === 'table') {
      expect(result[0]!.align).toEqual(['left', 'center', 'right']);
    }
  });

  it('handles empty cells with leading/trailing pipes', () => {
    const md = '| a || c |\n|---|---|---|\n| 1 | 2 | 3 |';
    const result = parseBlocks(md);
    if (result[0]!.type === 'table') {
      expect(result[0]!.headers).toEqual(['a', '', 'c']);
    }
  });

  it('handles varying column counts between header rows', () => {
    const md = '| a | b | c |\n|---|---|---|\n| 1 | 2 |\n| 3 | 4 | 5 | 6 |';
    const result = parseBlocks(md);
    if (result[0]!.type === 'table') {
      expect(result[0]!.headers).toHaveLength(3);
      expect(result[0]!.rows[0]).toHaveLength(3);
      expect(result[0]!.rows[1]).toHaveLength(3);
    }
  });

  it('handles escaped pipes \\| inside cells', () => {
    const md = '| a \\| b | c |\n|---|---|---|\n| d | e |';
    const result = parseBlocks(md);
    if (result[0]!.type === 'table') {
      expect(result[0]!.headers[0]).toBe('a | b');
    }
  });

  it('handles leading/trailing pipe optional', () => {
    const md = 'a | b\n---|---\n1 | 2';
    const result = parseBlocks(md);
    expect(result[0]!.type).toBe('table');
  });

  it('returns text block when only delimiter row exists (no data)', () => {
    const md = '| h1 | h2 |\n|---|---|';
    const result = parseBlocks(md);
    expect(result[0]!.type).toBe('text');
  });
});