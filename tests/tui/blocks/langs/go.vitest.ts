import { describe, it, expect } from 'vitest';
import { goTokenizer } from '../../../../src/tui/blocks/langs/go.js';

describe('goTokenizer', () => {
  it('tokenizes keywords', () => {
    const toks = goTokenizer.tokenize('func return if else for');
    const kinds = toks.filter((t) => t.kind !== 'plain').map((t) => t.kind);
    expect(kinds).toEqual(['keyword', 'keyword', 'keyword', 'keyword', 'keyword']);
  });

  it('tokenizes double-quoted strings with escapes', () => {
    const toks = goTokenizer.tokenize(`x := "hello\\nworld"`);
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['"hello\\nworld"']);
  });

  it('tokenizes backtick raw strings', () => {
    const toks = goTokenizer.tokenize('x := `raw string`');
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['`raw string`']);
  });

  it('tokenizes rune literals', () => {
    const toks = goTokenizer.tokenize("ch := 'a'");
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(["'a'"]);
  });

  it('tokenizes line and block comments', () => {
    const toks = goTokenizer.tokenize('// line\n/* block */');
    const comments = toks.filter((t) => t.kind === 'comment').map((t) => t.text);
    expect(comments).toEqual(['// line', '/* block */']);
  });

  it('tokenizes numbers (int, float, hex)', () => {
    const toks = goTokenizer.tokenize('x := 42 + 3.14 * 0xFF');
    const numbers = toks.filter((t) => t.kind === 'number').map((t) => t.text);
    expect(numbers).toEqual(['42', '3.14', '0xFF']);
  });

  it('detects function names after `func`', () => {
    const toks = goTokenizer.tokenize('func fibonacci(n int) int {}');
    const funcs = toks.filter((t) => t.kind === 'function').map((t) => t.text);
    expect(funcs).toEqual(['fibonacci']);
  });

  it('returns empty array for empty input', () => {
    expect(goTokenizer.tokenize('')).toEqual([]);
  });
});
