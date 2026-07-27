import { describe, it, expect } from 'vitest';
import { rustTokenizer } from '../../../../src/tui/blocks/langs/rust.js';

describe('rustTokenizer', () => {
  it('tokenizes keywords', () => {
    const toks = rustTokenizer.tokenize('fn let mut return if else');
    const kinds = toks.filter((t) => t.kind !== 'plain').map((t) => t.kind);
    expect(kinds).toEqual(['keyword', 'keyword', 'keyword', 'keyword', 'keyword', 'keyword']);
  });

  it('tokenizes double-quoted strings with escapes', () => {
    const toks = rustTokenizer.tokenize(`let s = "hello\\nworld";`);
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['"hello\\nworld"']);
  });

  it('tokenizes raw strings', () => {
    const toks = rustTokenizer.tokenize('let s = r"raw string";');
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['r"raw string"']);
  });

  it('tokenizes raw strings with hash delimiters', () => {
    const toks = rustTokenizer.tokenize('let s = r#"hello "world" "#;');
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['r#"hello "world" "#']);
  });

  it('tokenizes char literals', () => {
    const toks = rustTokenizer.tokenize("let ch = 'a';");
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(["'a'"]);
  });

  it('tokenizes line and block comments', () => {
    const toks = rustTokenizer.tokenize('// line\n/* block */');
    const comments = toks.filter((t) => t.kind === 'comment').map((t) => t.text);
    expect(comments).toEqual(['// line', '/* block */']);
  });

  it('tokenizes numbers (int, float, hex)', () => {
    const toks = rustTokenizer.tokenize('let a = 42; let b = 3.14; let c = 0xFF;');
    const numbers = toks.filter((t) => t.kind === 'number').map((t) => t.text);
    expect(numbers).toEqual(['42', '3.14', '0xFF']);
  });

  it('detects function names after `fn`', () => {
    const toks = rustTokenizer.tokenize('fn fibonacci(n: u32) -> u32 {}');
    const funcs = toks.filter((t) => t.kind === 'function').map((t) => t.text);
    expect(funcs).toEqual(['fibonacci']);
  });

  it('returns empty array for empty input', () => {
    expect(rustTokenizer.tokenize('')).toEqual([]);
  });
});
