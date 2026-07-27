import { describe, it, expect } from 'vitest';
import { htmlTokenizer } from '../../../../src/tui/blocks/langs/html.js';

describe('htmlTokenizer', () => {
  it('tokenizes HTML comments', () => {
    const toks = htmlTokenizer.tokenize('<!-- a comment -->');
    const comments = toks.filter((t) => t.kind === 'comment').map((t) => t.text);
    expect(comments).toEqual(['<!-- a comment -->']);
  });

  it('tokenizes doctype declarations', () => {
    const toks = htmlTokenizer.tokenize('<!DOCTYPE html>');
    const keywords = toks.filter((t) => t.kind === 'keyword').map((t) => t.text);
    expect(keywords).toContain('<!DOCTYPE html>');
  });

  it('tokenizes tag names as keywords', () => {
    const toks = htmlTokenizer.tokenize('<html><body></body></html>');
    const keywords = toks.filter((t) => t.kind === 'keyword').map((t) => t.text);
    expect(keywords).toEqual(['html', 'body', 'body', 'html']);
  });

  it('tokenizes self-closing tags', () => {
    const toks = htmlTokenizer.tokenize('<br/><hr/>');
    const keywords = toks.filter((t) => t.kind === 'keyword').map((t) => t.text);
    expect(keywords).toEqual(['br', 'hr']);
  });

  it('tokenizes attributes and values', () => {
    const toks = htmlTokenizer.tokenize('<a href="https://example.com" class="link">text</a>');
    const attrs = toks.filter((t) => t.kind === 'function').map((t) => t.text);
    const values = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(attrs).toEqual(['href', 'class']);
    expect(values).toEqual(['"https://example.com"', '"link"']);
  });

  it('tokenizes attribute operators and punctuation', () => {
    const toks = htmlTokenizer.tokenize('<a href="x">');
    expect(toks.some((t) => t.kind === 'operator' && t.text === '=')).toBe(true);
    expect(toks.filter((t) => t.kind === 'punctuation').map((t) => t.text)).toEqual(['<', '>']);
  });

  it('tokenizes text content as plain', () => {
    const toks = htmlTokenizer.tokenize('<p>hello world</p>');
    const plains = toks.filter((t) => t.kind === 'plain').map((t) => t.text);
    expect(plains).toContain('hello');
    expect(plains).toContain('world');
  });

  it('handles unquoted attribute values', () => {
    const toks = htmlTokenizer.tokenize('<input disabled>');
    const values = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(values).toContain('disabled');
  });

  it('handles nested tags', () => {
    const toks = htmlTokenizer.tokenize('<div><span>text</span></div>');
    const keywords = toks.filter((t) => t.kind === 'keyword').map((t) => t.text);
    expect(keywords).toEqual(['div', 'span', 'span', 'div']);
  });

  it('returns empty array for empty input', () => {
    expect(htmlTokenizer.tokenize('')).toEqual([]);
  });
});