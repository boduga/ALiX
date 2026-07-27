// src/tui/blocks/langs/json.ts
// Tokenizer for JSON. Recognizes:
//   - strings (double-quoted only — JSON doesn't support single quotes)
//   - numbers
//   - true / false / null (keywords)
//   - everything else: plain (structural punctuation, whitespace)

import type { Token, Tokenizer } from '../types.js';
import {
  consumeWhitespace,
  consumeString,
  consumeNumber,
  consumeIdentifier,
} from './shared.js';

const JSON_KEYWORDS = new Set(['true', 'false', 'null']);
const NUMBER_PATTERN = /[0-9.eE+\-]/;

export const jsonTokenizer: Tokenizer = {
  language: 'json',

  tokenize(code: string): Token[] {
    if (code === '') return [];
    const tokens: Token[] = [];
    let i = 0;

    while (i < code.length) {
      const c = code[i]!;

      if (/[ \t\r\n]/.test(c)) {
        i = consumeWhitespace(code, i, tokens);
        continue;
      }

      // Strings (double-quoted only).
      if (c === '"') {
        i = consumeString(code, i, tokens);
        continue;
      }

      // Numbers.
      if (c === '-' || /[0-9]/.test(c)) {
        i = consumeNumber(code, i, tokens, NUMBER_PATTERN);
        continue;
      }

      // true / false / null (alphabetic only — JSON has no other keywords).
      if (/[a-z]/.test(c)) {
        i = consumeIdentifier(code, i, JSON_KEYWORDS, tokens);
        continue;
      }

      // Fallthrough — structural punctuation.
      tokens.push({ kind: 'plain', text: c });
      i++;
    }

    return tokens;
  },
};
