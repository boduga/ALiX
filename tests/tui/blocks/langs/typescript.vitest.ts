import { describe, it, expect } from 'vitest';
import { typescriptTokenizer } from '../../../../src/tui/blocks/langs/typescript.js';

describe('typescriptTokenizer', () => {
  it('tokenizes keywords', () => {
    const toks = typescriptTokenizer.tokenize('function const let var');
    const kinds = toks.filter((t) => t.kind !== 'plain').map((t) => t.kind);
    expect(kinds).toEqual(['keyword', 'keyword', 'keyword', 'keyword']);
  });

  it('tokenizes TypeScript-specific keywords', () => {
    const toks = typescriptTokenizer.tokenize('interface type enum');
    const kinds = toks.filter((t) => t.kind !== 'plain').map((t) => t.kind);
    expect(kinds).toEqual(['keyword', 'keyword', 'keyword']);
  });

  it('tokenizes single and double quoted strings', () => {
    const toks = typescriptTokenizer.tokenize(`a = "hello"; b = 'world';`);
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['"hello"', "'world'"]);
  });

  it('tokenizes template literals (single-pass — ${} body treated as plain inside)', () => {
    const toks = typescriptTokenizer.tokenize('const x = `hello ${name}!`;');
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['`hello ${name}!`']);
  });

  it('tokenizes line and block comments', () => {
    const toks = typescriptTokenizer.tokenize('// line\n/* block */');
    const comments = toks.filter((t) => t.kind === 'comment').map((t) => t.text);
    expect(comments).toEqual(['// line', '/* block */']);
  });

  it('tokenizes numbers (integer, float, hex)', () => {
    const toks = typescriptTokenizer.tokenize('a = 42; b = 3.14; c = 0xff;');
    const numbers = toks.filter((t) => t.kind === 'number').map((t) => t.text);
    expect(numbers).toEqual(['42', '3.14', '0xff']);
  });

  it('detects function names after `function`', () => {
    const toks = typescriptTokenizer.tokenize('function fibonacci(n) {}');
    const funcs = toks.filter((t) => t.kind === 'function').map((t) => t.text);
    expect(funcs).toEqual(['fibonacci']);
  });

  it('detects function names in arrow assignments', () => {
    // `const fib = (n) => n;` — `fib` after `const =` still
    // function (the right-hand side is a function value).
    const toks = typescriptTokenizer.tokenize('const fib = (n) => n;');
    const funcs = toks.filter((t) => t.kind === 'function').map((t) => t.text);
    expect(funcs).toEqual(['fib']);
  });

  it('handles regex literals', () => {
    const toks = typescriptTokenizer.tokenize('const r = /foo/g;');
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['/foo/g']);
  });

  it('returns empty array for empty input', () => {
    expect(typescriptTokenizer.tokenize('')).toEqual([]);
  });
});
