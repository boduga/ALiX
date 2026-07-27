import { describe, it, expect } from 'vitest';
import { parseInline } from '../../../src/tui/blocks/inline.js';

describe('parseInline', () => {
  it('returns a single text span for plain text', () => {
    expect(parseInline('hello world')).toEqual([
      { kind: 'text', text: 'hello world' },
    ]);
  });

  it('parses **bold**', () => {
    expect(parseInline('hello **world**')).toEqual([
      { kind: 'text', text: 'hello ' },
      { kind: 'bold', text: 'world' },
    ]);
  });

  it('parses *italic*', () => {
    expect(parseInline('hello *world*')).toEqual([
      { kind: 'text', text: 'hello ' },
      { kind: 'italic', text: 'world' },
    ]);
  });

  it('parses `inline code`', () => {
    expect(parseInline('use `foo()` here')).toEqual([
      { kind: 'text', text: 'use ' },
      { kind: 'code', text: 'foo()' },
      { kind: 'text', text: ' here' },
    ]);
  });

  it('handles mixed bold/italic/code in one string', () => {
    expect(parseInline('a **b** c *d* e `f`')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' c ' },
      { kind: 'italic', text: 'd' },
      { kind: 'text', text: ' e ' },
      { kind: 'code', text: 'f' },
    ]);
  });

  it('treats unclosed delimiters as literal text', () => {
    expect(parseInline('hello **world')).toEqual([
      { kind: 'text', text: 'hello **world' },
    ]);
  });

  it('handles escaped \\* and \\\\ as literal characters', () => {
    expect(parseInline('a \\* b')).toEqual([{ kind: 'text', text: 'a * b' }]);
    expect(parseInline('a \\\\ b')).toEqual([{ kind: 'text', text: 'a \\ b' }]);
  });

  it('parses [text](href) links', () => {
    expect(parseInline('see [docs](https://example.com)')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'docs', href: 'https://example.com' },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseInline('')).toEqual([]);
  });

  it('does not match ** inside a single *italic*', () => {
    // Greedy `*foo*` should not consume a stray `**` next to it.
    expect(parseInline('*foo* and *bar*')).toEqual([
      { kind: 'italic', text: 'foo' },
      { kind: 'text', text: ' and ' },
      { kind: 'italic', text: 'bar' },
    ]);
  });
});