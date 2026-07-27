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

describe('autolinks', () => {
  it('parses <https://example.com> as a link', () => {
    expect(parseInline('visit <https://example.com> today')).toEqual([
      { kind: 'text', text: 'visit ' },
      { kind: 'link', text: 'https://example.com', href: 'https://example.com' },
      { kind: 'text', text: ' today' },
    ]);
  });

  it('parses bare https:// URL as autolink', () => {
    const result = parseInline('see https://x.com/page for info');
    expect(result).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'https://x.com/page', href: 'https://x.com/page' },
      { kind: 'text', text: ' for info' },
    ]);
  });

  it('strips trailing punctuation from bare URLs', () => {
    expect(parseInline('check https://ex.com.')).toEqual([
      { kind: 'text', text: 'check ' },
      { kind: 'link', text: 'https://ex.com', href: 'https://ex.com' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('does not parse <notalink> as a link', () => {
    expect(parseInline('see <notalink> here')).toEqual([
      { kind: 'text', text: 'see <notalink> here' },
    ]);
  });

  it('parses <mailto:user@host.com> as a link', () => {
    expect(parseInline('email <mailto:user@host.com>')).toEqual([
      { kind: 'text', text: 'email ' },
      { kind: 'link', text: 'mailto:user@host.com', href: 'mailto:user@host.com' },
    ]);
  });
});

describe('strikethrough', () => {
  it('parses ~~strikethrough~~', () => {
    expect(parseInline('hello ~~world~~')).toEqual([
      { kind: 'text', text: 'hello ' },
      { kind: 'strikethrough', text: 'world' },
    ]);
  });

  it('handles unclosed ~~ as literal text', () => {
    expect(parseInline('hello ~~world')).toEqual([
      { kind: 'text', text: 'hello ~~world' },
    ]);
  });

  it('works with adjacent formatting ~~strike~~ **and** *italic*', () => {
    expect(parseInline('~~strike~~ **bold** *italic*')).toEqual([
      { kind: 'strikethrough', text: 'strike' },
      { kind: 'text', text: ' ' },
      { kind: 'bold', text: 'bold' },
      { kind: 'text', text: ' ' },
      { kind: 'italic', text: 'italic' },
    ]);
  });
});