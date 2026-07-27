import { describe, it, expect } from 'vitest';
import { pythonTokenizer } from '../../../../src/tui/blocks/langs/python.js';

describe('pythonTokenizer', () => {
  it('tokenizes keywords', () => {
    const toks = pythonTokenizer.tokenize('def return if else');
    const kinds = toks.filter((t) => t.kind !== 'plain').map((t) => t.kind);
    expect(kinds).toEqual(['keyword', 'keyword', 'keyword', 'keyword']);
  });

  it('tokenizes strings (single and double quoted)', () => {
    const toks = pythonTokenizer.tokenize(`a = "hello" b = 'world'`);
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['"hello"', "'world'"]);
  });

  it('tokenizes triple-quoted strings as a single string token', () => {
    const toks = pythonTokenizer.tokenize('"""multi\nline"""');
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['"""multi\nline"""']);
  });

  it('tokenizes line comments', () => {
    const toks = pythonTokenizer.tokenize('x = 1  # comment');
    const comments = toks.filter((t) => t.kind === 'comment').map((t) => t.text);
    expect(comments).toEqual(['# comment']);
  });

  it('tokenizes numbers', () => {
    const toks = pythonTokenizer.tokenize('x = 42 y = 3.14');
    const numbers = toks.filter((t) => t.kind === 'number').map((t) => t.text);
    expect(numbers).toEqual(['42', '3.14']);
  });

  it('detects function names after `def`', () => {
    const toks = pythonTokenizer.tokenize('def fibonacci(n): pass');
    const funcs = toks.filter((t) => t.kind === 'function').map((t) => t.text);
    expect(funcs).toEqual(['fibonacci']);
  });

  it('detects class names after `class`', () => {
    const toks = pythonTokenizer.tokenize('class MyClass: pass');
    const funcs = toks.filter((t) => t.kind === 'function').map((t) => t.text);
    expect(funcs).toEqual(['MyClass']);
  });

  it('handles f-strings as string tokens', () => {
    const toks = pythonTokenizer.tokenize('f"hello {name}"');
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['f"hello {name}"']);
  });

  it('returns empty array for empty input', () => {
    expect(pythonTokenizer.tokenize('')).toEqual([]);
  });
});
