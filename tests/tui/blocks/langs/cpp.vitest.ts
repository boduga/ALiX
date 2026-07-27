import { describe, it, expect } from 'vitest';
import { cppTokenizer } from '../../../../src/tui/blocks/langs/cpp.js';

describe('cppTokenizer', () => {
  it('tokenizes keywords', () => {
    const toks = cppTokenizer.tokenize('int return if else while class');
    const kinds = toks.filter((t) => t.kind !== 'plain').map((t) => t.kind);
    expect(kinds).toEqual(['keyword', 'keyword', 'keyword', 'keyword', 'keyword', 'keyword']);
  });

  it('tokenizes double-quoted strings with escapes', () => {
    const toks = cppTokenizer.tokenize(`auto s = "hello\\nworld";`);
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['"hello\\nworld"']);
  });

  it('tokenizes char literals', () => {
    const toks = cppTokenizer.tokenize("char ch = 'a';");
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(["'a'"]);
  });

  it('tokenizes line and block comments', () => {
    const toks = cppTokenizer.tokenize('// line\n/* block */');
    const comments = toks.filter((t) => t.kind === 'comment').map((t) => t.text);
    expect(comments).toEqual(['// line', '/* block */']);
  });

  it('tokenizes numbers (int, float, hex)', () => {
    const toks = cppTokenizer.tokenize('int a = 42; double b = 3.14; int c = 0xFF;');
    const numbers = toks.filter((t) => t.kind === 'number').map((t) => t.text);
    expect(numbers).toEqual(['42', '3.14', '0xFF']);
  });

  it('returns empty array for empty input', () => {
    expect(cppTokenizer.tokenize('')).toEqual([]);
  });
});
