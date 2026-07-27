// src/tui/blocks/langs/cpp.ts
// Tokenizer for C++. Recognizes:
//   - keywords: alignas, asm, auto, bool, break, case, catch, char, class,
//     const, constexpr, continue, decltype, default, delete, do, double,
//     else, enum, explicit, export, extern, false, float, for, friend,
//     goto, if, inline, int, long, mutable, namespace, new, noexcept,
//     nullptr, operator, override, private, protected, public, register,
//     return, short, signed, sizeof, static, struct, switch, template,
//     this, throw, true, try, typedef, typeid, typename, union, unsigned,
//     using, virtual, void, volatile, while
//   - strings: double-quoted (with escapes), raw R"(...)"
//   - chars: 'a'
//   - comments: //, /* */
//   - numbers: int, float, hex, binary
//   - function names: no separate detection (C++ doesn't use fn/func/def)
//
// Not full grammar. Tokenization is for coloring only.

import type { Token, Tokenizer } from '../types.js';
import {
  consumeWhitespace,
  consumeString,
  consumeNumber,
  consumeIdentifier,
  lastNonPlainToken,
} from './shared.js';

const KEYWORDS = new Set([
  'alignas', 'asm', 'auto', 'bool', 'break', 'case', 'catch', 'char',
  'class', 'const', 'constexpr', 'continue', 'decltype', 'default',
  'delete', 'do', 'double', 'else', 'enum', 'explicit', 'export',
  'extern', 'false', 'float', 'for', 'friend', 'goto', 'if', 'inline',
  'int', 'long', 'mutable', 'namespace', 'new', 'noexcept', 'nullptr',
  'operator', 'override', 'private', 'protected', 'public', 'register',
  'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch',
  'template', 'this', 'throw', 'true', 'try', 'typedef', 'typeid',
  'typename', 'union', 'unsigned', 'using', 'virtual', 'void',
  'volatile', 'while',
]);

const NUMBER_PATTERN = /[0-9._a-fA-FxXoObBeE+\-]/;

export const cppTokenizer: Tokenizer = {
  language: 'cpp',

  tokenize(code: string): Token[] {
    if (code === '') return [];
    const tokens: Token[] = [];
    let i = 0;

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

      // Numbers.
      if (/[0-9]/.test(c)) {
        i = consumeNumber(code, i, tokens, NUMBER_PATTERN);
        continue;
      }

      // Identifiers / keywords.
      if (/[A-Za-z_]/.test(c)) {
        i = consumeIdentifier(code, i, KEYWORDS, tokens);
        continue;
      }

      // Preprocessor directives (#include, #define, etc.)
      if (c === '#' && i === 0) {
        // Check if previous content was a newline
        // Look backwards for a newline to see if we're at line start
        let lineStart = i;
        for (let k = i - 1; k >= 0; k--) {
          if (code[k] === '\n') { lineStart = k + 1; break; }
          if (!/[ \t]/.test(code[k]!)) break;
        }
        let j = i + 1;
        // Only treat as preprocessor directive if preceded by whitespace/newline
        const isPreprocessor = (() => {
          for (let k = i - 1; k >= 0; k--) {
            if (code[k] === '\n') return true;
            if (!/[ \t]/.test(code[k]!)) return false;
          }
          return true; // start of file
        })();
        if (isPreprocessor) {
          while (j < code.length && code[j] !== '\n') j++;
          tokens.push({ kind: 'keyword', text: code.slice(i, j) });
          i = j;
          continue;
        }
      }

      // Operators.
      if (/[+\-*/%=<>!&|^~?:]/.test(c)) {
        let j = i + 1;
        while (j < code.length && /[+\-*/%=<>!&|^~?:]/.test(code[j]!)) j++;
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
