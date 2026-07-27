// src/tui/blocks/langs/typescript.ts
// Tokenizer for TypeScript and JavaScript (shared syntax). Recognizes:
// - keywords: function, return, const, let, var, if, else, while,
//   class, import, export, from, default, switch, case, break, continue,
//   new, this, super, extends, implements, async, await, yield, typeof,
//   instanceof, in, of, void, delete, throw, try, catch, finally, do
// - TS-only: type, interface, enum, public, private, protected, static,
//   readonly, abstract, as, is, keyof, infer, never, unknown, any
// - strings, template literals, regex literals
// - comments: //, /* */
// - numbers: int, float, hex
// - function names: identifier after `function`/`const =`/`let =`/`var =`
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
  'function', 'return', 'const', 'let', 'var',
  'if', 'else', 'for', 'while', 'do',
  'class', 'import', 'export', 'from', 'default',
  'switch', 'case', 'break', 'continue',
  'new', 'this', 'super', 'extends', 'implements',
  'async', 'await', 'yield',
  'typeof', 'instanceof', 'in', 'of',
  'void', 'delete', 'throw', 'try', 'catch', 'finally',
  'return', 'true', 'false', 'null', 'undefined',
]);

const TS_KEYWORDS = new Set([
  'type', 'interface', 'enum',
  'public', 'private', 'protected', 'static', 'readonly', 'abstract',
  'as', 'is', 'keyof', 'infer',
  'never', 'unknown', 'any',
]);

const ALL_KEYWORDS = new Set([...KEYWORDS, ...TS_KEYWORDS]);
const functionKeywords = new Set(['function', 'class']);
const NUMBER_PATTERN = /[0-9._a-fA-FxXoObB]/;

export const typescriptTokenizer: Tokenizer = {
  language: 'typescript',

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
        // Note: pendingIsFunction is NOT reset here — `function foo`
        // with a single space must still recognize `foo` as a function name.
        continue;
      }

      // Comments.
      if (c === '/' && code[i + 1] === '/') {
        let j = i + 2;
        while (j < code.length && code[j] !== '\n') j++;
        tokens.push({ kind: 'comment', text: code.slice(i, j) });
        i = j;
        continue;
      }
      if (c === '/' && code[i + 1] === '*') {
        let j = i + 2;
        while (j < code.length - 1 && !(code[j] === '*' && code[j + 1] === '/')) j++;
        if (j < code.length) j = Math.min(code.length, j + 2);
        tokens.push({ kind: 'comment', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Strings (double/single quoted).
      if (c === '"' || c === "'") {
        i = consumeString(code, i, tokens);
        continue;
      }

      // Template literals.
      if (c === '`') {
        let j = i + 1;
        let depth = 0;
        while (j < code.length) {
          if (code[j] === '\\') { j += 2; continue; }
          if (code[j] === '`' && depth === 0) { j++; break; }
          if (code[j] === '{') depth++;
          if (code[j] === '}') depth--;
          j++;
        }
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
      if (/[A-Za-z_$]/.test(c)) {
        i = consumeIdentifier(code, i, ALL_KEYWORDS, tokens, {
          functionKeywords,
          pendingIsFunction,
        });

        // Detect `const x = ...`, `let x = ...`, `var x = ...` —
        // the identifier following the keyword (with optional whitespace)
        // is treated as a function name.
        const emitted = tokens[tokens.length - 1];
        if (emitted?.kind === 'identifier') {
          const prev = lastNonPlainToken(tokens.slice(0, -1));
          const isAfterDecl = prev !== undefined
            && (prev.text === 'const' || prev.text === 'let' || prev.text === 'var');
          if (isAfterDecl) {
            tokens[tokens.length - 1] = { kind: 'function', text: emitted.text };
          }
        }
        continue;
      }

      // Regex literal: `/foo/` — only when previous non-whitespace token
      // is not an identifier, keyword, or `)`.
      if (c === '/') {
        const prev = lastNonPlainToken(tokens);
        if (prev && !isRegexForbiddenPrev(prev)) {
          let j = i + 1;
          while (j < code.length && code[j] !== '/' && code[j] !== '\n') {
            if (code[j] === '\\') j++;
            j++;
          }
          if (j < code.length && code[j] === '/') {
            j++;
            while (j < code.length && /[gimsuy]/.test(code[j]!)) j++;
          }
          tokens.push({ kind: 'string', text: code.slice(i, j) });
          i = j;
          continue;
        }
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

/**
 * `/` is division when preceded by a value-position token
 * (identifier, number, closing paren, or `]`); otherwise it's the start
 * of a regex literal.
 */
function isRegexForbiddenPrev(prev: Token): boolean {
  return ['identifier', 'number', 'function'].includes(prev.kind);
}
