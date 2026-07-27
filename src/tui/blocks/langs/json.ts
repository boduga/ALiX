// src/tui/blocks/langs/json.ts
// Tokenizer for JSON. Recognizes:
//   - strings (double-quoted only — JSON doesn't support single quotes)
//   - numbers
//   - true / false / null (keywords)
//   - everything else: plain (structural punctuation, whitespace)

import type { Token, Tokenizer } from '../types.js';

export const jsonTokenizer: Tokenizer = {
  language: 'json',

  tokenize(code: string): Token[] {
    if (code === '') return [];
    const tokens: Token[] = [];
    let i = 0;

    while (i < code.length) {
      const c = code[i]!;

      if (/[ \t\r\n]/.test(c)) {
        let j = i;
        while (j < code.length && /[ \t\r\n]/.test(code[j]!)) j++;
        tokens.push({ kind: 'plain', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Strings (double-quoted only).
      if (c === '"') {
        let j = i + 1;
        while (j < code.length && code[j] !== '"') {
          if (code[j] === '\\') j++;
          j++;
        }
        if (j < code.length) j++;
        tokens.push({ kind: 'string', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Numbers.
      if (c === '-' || /[0-9]/.test(c)) {
        let j = i + (c === '-' ? 1 : 0);
        while (j < code.length && /[0-9.eE+\-]/.test(code[j]!)) j++;
        tokens.push({ kind: 'number', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // true / false / null (alphabetic only — JSON has no other keywords).
      if (/[a-z]/.test(c)) {
        let j = i + 1;
        while (j < code.length && /[a-z]/.test(code[j]!)) j++;
        const word = code.slice(i, j);
        if (word === 'true' || word === 'false' || word === 'null') {
          tokens.push({ kind: 'keyword', text: word });
          i = j;
          continue;
        }
      }

      // Fallthrough — structural punctuation.
      tokens.push({ kind: 'plain', text: c });
      i++;
    }

    return tokens;
  },
};