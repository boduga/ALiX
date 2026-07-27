import { describe, it, expect } from 'vitest';
import { bashTokenizer } from '../../../../src/tui/blocks/langs/bash.js';

describe('bashTokenizer', () => {
  it('tokenizes comments', () => {
    const toks = bashTokenizer.tokenize('echo hello # comment');
    const comments = toks.filter((t) => t.kind === 'comment').map((t) => t.text);
    expect(comments).toEqual(['# comment']);
  });

  it('tokenizes single and double quoted strings', () => {
    const toks = bashTokenizer.tokenize(`a="hello" b='world'`);
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['"hello"', "'world'"]);
  });

  it('tokenizes variables ($VAR and ${VAR})', () => {
    const toks = bashTokenizer.tokenize('echo $HOME and ${USER}');
    // Variables are styled as identifiers in this minimal tokenizer.
    const identifiers = toks.filter((t) => t.kind === 'identifier').map((t) => t.text);
    expect(identifiers).toContain('$HOME');
    expect(identifiers).toContain('${USER}');
  });

  it('tokenizes keywords', () => {
    const toks = bashTokenizer.tokenize('if [ -f x ]; then echo yes; fi');
    const keywords = toks.filter((t) => t.kind === 'keyword').map((t) => t.text);
    expect(keywords).toEqual(['if', 'then', 'fi']);
  });

  it('handles for/while/do/done', () => {
    const toks = bashTokenizer.tokenize('for i in 1 2 3; do echo $i; done');
    const keywords = toks.filter((t) => t.kind === 'keyword').map((t) => t.text);
    expect(keywords).toEqual(['for', 'in', 'do', 'done']);
  });

  it('returns empty array for empty input', () => {
    expect(bashTokenizer.tokenize('')).toEqual([]);
  });
});