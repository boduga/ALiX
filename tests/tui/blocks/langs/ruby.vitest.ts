import { describe, it, expect } from 'vitest';
import { rubyTokenizer } from '../../../../src/tui/blocks/langs/ruby.js';

describe('rubyTokenizer', () => {
  it('tokenizes keywords', () => {
    const toks = rubyTokenizer.tokenize('def return if else end class');
    const kinds = toks.filter((t) => t.kind !== 'plain').map((t) => t.kind);
    expect(kinds).toEqual(['keyword', 'keyword', 'keyword', 'keyword', 'keyword', 'keyword']);
  });

  it('tokenizes double-quoted strings', () => {
    const toks = rubyTokenizer.tokenize('x = "hello"');
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['"hello"']);
  });

  it('tokenizes single-quoted strings', () => {
    const toks = rubyTokenizer.tokenize("x = 'hello'");
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(["'hello'"]);
  });

  it('tokenizes line comments', () => {
    const toks = rubyTokenizer.tokenize('x = 1  # comment');
    const comments = toks.filter((t) => t.kind === 'comment').map((t) => t.text);
    expect(comments).toEqual(['# comment']);
  });

  it('tokenizes numbers (int, float, hex)', () => {
    const toks = rubyTokenizer.tokenize('x = 42; y = 3.14; z = 0xFF');
    const numbers = toks.filter((t) => t.kind === 'number').map((t) => t.text);
    expect(numbers).toEqual(['42', '3.14', '0xFF']);
  });

  it('detects function names after `def`', () => {
    const toks = rubyTokenizer.tokenize('def fibonacci(n) end');
    const funcs = toks.filter((t) => t.kind === 'function').map((t) => t.text);
    expect(funcs).toEqual(['fibonacci']);
  });

  it('handles method names ending with ? or !', () => {
    const toks = rubyTokenizer.tokenize('def valid?; end');
    const funcs = toks.filter((t) => t.kind === 'function').map((t) => t.text);
    expect(funcs).toEqual(['valid?']);
  });

  it('returns empty array for empty input', () => {
    expect(rubyTokenizer.tokenize('')).toEqual([]);
  });
});
