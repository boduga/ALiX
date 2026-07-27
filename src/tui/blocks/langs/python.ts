// src/tui/blocks/langs/python.ts
// Single-pass tokenizer for Python. Recognizes:
//   - keywords: def, return, if, elif, else, for, while, class, import,
//     from, in, is, not, and, or, try, except, finally, with, as, yield,
//     lambda, pass, break, continue, raise, global, nonlocal, async,
//     await, None, True, False, self
//   - strings: single/double/triple-quoted, f-strings
//   - comments: # to end of line
//   - numbers: integers and floats
//   - function names: identifier immediately after `def`/`class`
//
// Not a full grammar — tokenization is for coloring only. The renderer
// never knows Python; it just gets a stream of (kind, text) pairs.

import type { Token, Tokenizer } from '../types.js';
import {
  consumeWhitespace,
  consumeHashComment,
  consumeString,
  consumeNumber,
  consumeIdentifier,
} from './shared.js';

const KEYWORDS = new Set([
  'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'class',
  'import', 'from', 'in', 'is', 'not', 'and', 'or',
  'try', 'except', 'finally', 'with', 'as', 'yield',
  'lambda', 'pass', 'break', 'continue', 'raise',
  'global', 'nonlocal', 'async', 'await',
  'None', 'True', 'False', 'self',
]);

const functionKeywords = new Set(['def', 'class']);

const NUMBER_PATTERN = /[0-9._a-fA-Fx]/;

export const pythonTokenizer: Tokenizer = {
  language: 'python',

  tokenize(code: string): Token[] {
    if (code === '') return [];
    const tokens: Token[] = [];
    let i = 0;
    const pendingIsFunction = { value: false };

    while (i < code.length) {
      // Whitespace — preserve verbatim as plain.
      // pendingIsFunction is NOT reset here: `def foo` (a single space) must
      // still recognize `foo` as the function name; we only consume the flag
      // when an identifier is actually emitted.
      const wsI = consumeWhitespace(code, i, tokens);
      if (wsI !== i) { i = wsI; continue; }

      const c = code[i]!;

      // Comments — `#` to end of line.
      if (c === '#') {
        i = consumeHashComment(code, i, tokens);
        continue;
      }

      // Strings (single, double, triple, f-prefix).
      if (c === '"' || c === "'") {
        // f-prefix?
        if (i > 0 && code[i - 1] === 'f' && tokens[tokens.length - 1]?.text.endsWith('f')) {
          // Include the leading 'f' in the string token for visual fidelity.
          // Roll back: pop the previous 'f' plain token and prepend it.
          tokens.pop();
          const end = consumeString(code, i, tokens, { triple: true });
          const last = tokens[tokens.length - 1];
          if (last?.kind === 'string') {
            tokens[tokens.length - 1] = { kind: 'string', text: 'f' + last.text };
          }
          i = end;
          continue;
        }
        i = consumeString(code, i, tokens, { triple: true });
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
      if (/[+\-*/%=<>!&|^~]/.test(c)) {
        let j = i + 1;
        while (j < code.length && /[+\-*/%=<>!&|^~]/.test(code[j]!)) j++;
        tokens.push({ kind: 'operator', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Punctuation.
      if (/[()[\]{},.:;@]/.test(c)) {
        tokens.push({ kind: 'punctuation', text: c });
        i++;
        continue;
      }

      // Fallthrough — emit as plain.
      tokens.push({ kind: 'plain', text: c });
      i++;
    }

    return tokens;
  },
};
