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

const KEYWORDS = new Set([
  'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'class',
  'import', 'from', 'in', 'is', 'not', 'and', 'or',
  'try', 'except', 'finally', 'with', 'as', 'yield',
  'lambda', 'pass', 'break', 'continue', 'raise',
  'global', 'nonlocal', 'async', 'await',
  'None', 'True', 'False', 'self',
]);

export const pythonTokenizer: Tokenizer = {
  language: 'python',

  tokenize(code: string): Token[] {
    if (code === '') return [];
    const tokens: Token[] = [];
    let i = 0;
    let pendingIsFunction = false; // true when next identifier should be `function`

    while (i < code.length) {
      const c = code[i]!;

      // Whitespace and newlines — preserve verbatim as plain.
      // pendingIsFunction is NOT reset here: `def foo` (a single space) must
      // still recognize `foo` as the function name; we only consume the flag
      // when an identifier is actually emitted.
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        let j = i;
        while (j < code.length && /[ \t\r\n]/.test(code[j]!)) j++;
        tokens.push({ kind: 'plain', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Comments — `#` to end of line.
      if (c === '#') {
        let j = i + 1;
        while (j < code.length && code[j] !== '\n') j++;
        tokens.push({ kind: 'comment', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Strings (single, double, triple, f-prefix).
      if (c === '"' || c === "'") {
        let j = i;
        // f-prefix?
        if (j > 0 && code[j - 1] === 'f' && tokens[tokens.length - 1]?.text.endsWith('f')) {
          // Include the leading 'f' in the string token for visual fidelity.
          // Roll back: pop the previous 'f' plain token and prepend it.
          const prev = tokens.pop();
          if (prev) i--;
        }
        const triple = code.slice(j, j + 3) === c.repeat(3);
        if (triple) {
          j += 3;
          while (j < code.length && code.slice(j, j + 3) !== c.repeat(3)) j++;
          if (j < code.length) j += 3;
          tokens.push({ kind: 'string', text: code.slice(i, j) });
          i = j;
          continue;
        }
        j++;
        while (j < code.length && code[j] !== c && code[j] !== '\n') {
          if (code[j] === '\\') j++;
          j++;
        }
        if (j < code.length && code[j] === c) j++;
        tokens.push({ kind: 'string', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Numbers.
      if (/[0-9]/.test(c)) {
        let j = i + 1;
        while (j < code.length && /[0-9._a-fA-Fx]/.test(code[j]!)) j++;
        tokens.push({ kind: 'number', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Identifiers / keywords.
      if (/[A-Za-z_]/.test(c)) {
        let j = i + 1;
        while (j < code.length && /[A-Za-z0-9_]/.test(code[j]!)) j++;
        const word = code.slice(i, j);
        if (KEYWORDS.has(word)) {
          tokens.push({ kind: 'keyword', text: word });
          if (word === 'def' || word === 'class') pendingIsFunction = true;
        } else if (pendingIsFunction) {
          tokens.push({ kind: 'function', text: word });
          pendingIsFunction = false;
        } else {
          tokens.push({ kind: 'identifier', text: word });
        }
        i = j;
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
