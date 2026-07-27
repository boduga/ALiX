// src/tui/blocks/langs/plain.ts
// Fallback tokenizer. Every non-empty run of characters becomes a plain
// token. Preserves newlines verbatim so the renderer can emit blank
// lines inside code blocks.

import type { Token, Tokenizer } from '../types.js';

/**
 * The plain tokenizer's `tokenize` is a special case: it splits the
 * input on runs of newlines (keeping them as their own tokens) so the
 * renderer can preserve blank lines.
 */
export const plainTokenizer: Tokenizer = {
  language: 'plain',
  tokenize(code: string): Token[] {
    if (code === '') return [];
    const tokens: Token[] = [];
    const lines = code.split(/(\n+)/); // keep delimiters via capture
    for (const part of lines) {
      if (part === '') continue;
      tokens.push({ kind: 'plain', text: part });
    }
    return tokens;
  },
};
