// src/tui/blocks/langs/go.ts
// Tokenizer for Go. Recognizes:
//   - keywords: break, case, chan, const, continue, default, defer, else,
//     fallthrough, for, func, go, goto, if, import, interface, map, package,
//     range, return, select, struct, switch, type, var
//   - strings: double-quoted (with escapes), backtick raw strings, rune literals
//   - comments: //, /* */
//   - numbers: int, float, hex
//   - function names: identifier after `func`
//
// Not full grammar. Tokenization is for coloring only.

import type { Token, Tokenizer } from '../types.js';
import {
  consumeWhitespace,
  consumeString,
  consumeNumber,
  consumeIdentifier,
} from './shared.js';

const KEYWORDS = new Set([
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer',
  'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import',
  'interface', 'map', 'package', 'range', 'return', 'select', 'struct',
  'switch', 'type', 'var',
]);

const functionKeywords = new Set(['func']);
const NUMBER_PATTERN = /[0-9._a-fA-FxX]/;

export const goTokenizer: Tokenizer = {
  language: 'go',

  tokenize(code: string): Token[] {
    if (code === '') return [];
    const tokens: Token[] = [];
    let i = 0;
    const pendingIsFunction = { value: false };

    while (i < code.length) {
      const c = code[i]!;

      // Whitespace.
      const wsI = consumeWhitespace(code, i, tokens);
      if (wsI !== i) {
        i = wsI;
        continue;
      }

      // Line comments.
      if (c === '/' && code[i + 1] === '/') {
        let j = i + 2;
        while (j < code.length && code[j] !== '\n') j++;
        tokens.push({ kind: 'comment', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Block comments.
      if (c === '/' && code[i + 1] === '*') {
        let j = i + 2;
        while (j < code.length - 1 && !(code[j] === '*' && code[j + 1] === '/')) j++;
        if (j < code.length) j = Math.min(code.length, j + 2);
        tokens.push({ kind: 'comment', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Strings (double-quoted).
      if (c === '"') {
        i = consumeString(code, i, tokens);
        continue;
      }

      // Backtick raw strings.
      if (c === '`') {
        let j = i + 1;
        while (j < code.length && code[j] !== '`') j++;
        if (j < code.length) j++;
        tokens.push({ kind: 'string', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Rune literals: 'a'
      if (c === '\'') {
        let j = i + 1;
        if (j < code.length && code[j] === '\\') j++;
        j++;
        if (j < code.length && code[j] === '\'') j++;
        tokens.push({ kind: 'string', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Numbers.
      if (/[0-9]/.test(c)) {
        i = consumeNumber(code, i, tokens, NUMBER_PATTERN);
        continue;
      }

      // Identifiers / keywords.
      if (/[A-Za-z_]/.test(c)) {
        i = consumeIdentifier(code, i, KEYWORDS, tokens, {
          functionKeywords,
          pendingIsFunction,
        });
        continue;
      }

      // Operators.
      if (/[+\-*/%=<>!&|^~:]/.test(c)) {
        let j = i + 1;
        while (j < code.length && /[+\-*/%=<>!&|^~:]/.test(code[j]!)) j++;
        tokens.push({ kind: 'operator', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Punctuation.
      if (/[()[\]{},.;]/.test(c)) {
        tokens.push({ kind: 'punctuation', text: c });
        i++;
        continue;
      }

      tokens.push({ kind: 'plain', text: c });
      i++;
    }

    return tokens;
  },
};
