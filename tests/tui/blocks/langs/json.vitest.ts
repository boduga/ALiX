import { describe, it, expect } from 'vitest';
import { jsonTokenizer } from '../../../../src/tui/blocks/langs/json.js';

describe('jsonTokenizer', () => {
  it('tokenizes keys and values as strings', () => {
    const toks = jsonTokenizer.tokenize('{"name": "alice"}');
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(strings).toEqual(['"name"', '"alice"']);
  });

  it('tokenizes numbers', () => {
    const toks = jsonTokenizer.tokenize('{"age": 42, "ratio": 3.14}');
    const numbers = toks.filter((t) => t.kind === 'number').map((t) => t.text);
    expect(numbers).toEqual(['42', '3.14']);
  });

  it('tokenizes true/false/null as keywords', () => {
    const toks = jsonTokenizer.tokenize('{"a": true, "b": false, "c": null}');
    const keywords = toks.filter((t) => t.kind === 'keyword').map((t) => t.text);
    expect(keywords).toEqual(['true', 'false', 'null']);
  });

  it('handles nested objects', () => {
    const toks = jsonTokenizer.tokenize('{"a": {"b": 1}}');
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.text);
    const numbers = toks.filter((t) => t.kind === 'number').map((t) => t.text);
    expect(strings).toEqual(['"a"', '"b"']);
    expect(numbers).toEqual(['1']);
  });

  it('handles arrays', () => {
    const toks = jsonTokenizer.tokenize('[1, 2, 3]');
    const numbers = toks.filter((t) => t.kind === 'number').map((t) => t.text);
    expect(numbers).toEqual(['1', '2', '3']);
  });

  it('returns empty array for empty input', () => {
    expect(jsonTokenizer.tokenize('')).toEqual([]);
  });
});