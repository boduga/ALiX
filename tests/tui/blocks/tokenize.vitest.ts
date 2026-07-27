import { describe, it, expect } from 'vitest';
import { tokenize } from '../../../src/tui/blocks/tokenize.js';

describe('tokenize', () => {
  it('returns plain tokens for unknown languages', () => {
    const tokens = tokenize('hello world', 'klingon');
    expect(tokens).toEqual([{ kind: 'plain', text: 'hello world' }]);
  });

  it('returns plain tokens when language is omitted', () => {
    const tokens = tokenize('hello world');
    expect(tokens).toEqual([{ kind: 'plain', text: 'hello world' }]);
  });

  it('returns plain tokens for empty input', () => {
    expect(tokenize('', 'python')).toEqual([]);
    expect(tokenize('')).toEqual([]);
  });

  it('plain fallback produces one token per contiguous non-empty run', () => {
    const tokens = tokenize('abc\n\ndef', 'unknown');
    // Empty lines are emitted as plain tokens too so the renderer can
    // preserve them as blank lines inside code blocks.
    expect(tokens).toEqual([
      { kind: 'plain', text: 'abc' },
      { kind: 'plain', text: '\n\n' },
      { kind: 'plain', text: 'def' },
    ]);
  });
});
