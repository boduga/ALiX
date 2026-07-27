// src/tui/blocks/langs/rust.ts
// Tokenizer for Rust. Recognizes:
//   - keywords: as, break, const, continue, crate, else, enum, extern,
//     false, fn, for, if, impl, in, let, loop, match, mod, move, mut,
//     pub, ref, return, self, Self, static, struct, super, trait, true,
//     type, unsafe, use, where, while
//   - strings: double-quoted (with escapes), raw strings r"..." r#"..."#
//   - chars: 'a'
//   - comments: //, /* */
//   - numbers: int, float, hex, binary, underscore separators
//   - function names: identifier after `fn`
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
  'as', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'extern',
  'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match',
  'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self',
  'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe',
  'use', 'where', 'while',
]);

const functionKeywords = new Set(['fn']);
const NUMBER_PATTERN = /[0-9._a-fA-FxXoObB]/;

export const rustTokenizer: Tokenizer = {
  language: 'rust',

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

      // Block comments (including doc comments /** ... */).
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

      // Char literals: 'a'
      if (c === '\'') {
        let j = i + 1;
        if (j < code.length && code[j] === '\\') j++;
        j++;
        if (j < code.length && code[j] === '\'') j++;
        tokens.push({ kind: 'string', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Raw strings: r"..." or r#"..."# (detect before identifiers).
      if (c === 'r' && i + 1 < code.length && code[i + 1] === '"') {
        let j = i + 2;
        while (j < code.length && code[j] !== '"' && code[j] !== '\n') {
          if (code[j] === '\\') j++;
          j++;
        }
        if (j < code.length && code[j] === '"') j++;
        tokens.push({ kind: 'string', text: code.slice(i, j) });
        i = j;
        continue;
      }
      if (c === 'r' && i + 1 < code.length && code[i + 1] === '#') {
        // r#"..."#, r##"..."##, etc.
        let hashCount = 0;
        let j = i + 1;
        while (j < code.length && code[j] === '#') { hashCount++; j++; }
        if (j < code.length && code[j] === '"') {
          const closing = '"' + '#'.repeat(hashCount);
          j++; // skip opening "
          while (j < code.length - closing.length + 1) {
            if (code.slice(j, j + closing.length) === closing) {
              j += closing.length;
              break;
            }
            j++;
          }
          tokens.push({ kind: 'string', text: code.slice(i, j) });
          i = j;
          continue;
        }
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
      if (/[+\-*/%=<>!&|^~?]/.test(c)) {
        let j = i + 1;
        while (j < code.length && /[+\-*/%=<>!&|^~?]/.test(code[j]!)) j++;
        tokens.push({ kind: 'operator', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Punctuation.
      if (/[()[\]{},.;:]/.test(c)) {
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
