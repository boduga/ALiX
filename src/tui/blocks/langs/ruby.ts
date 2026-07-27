// src/tui/blocks/langs/ruby.ts
// Tokenizer for Ruby. Recognizes:
//   - keywords: begin, break, case, class, def, do, else, elsif, end,
//     ensure, for, if, in, module, next, nil, rescue, return, self,
//     super, then, unless, until, when, while, yield, __END__, true, false
//   - strings: double-quoted with #{interpolation}, single-quoted,
//     %q(...) %Q(...), heredocs
//   - comments: # to EOL
//   - numbers: int, float, hex
//   - function names: identifier after `def`
//
// Not full grammar. Tokenization is for coloring only.

import type { Token, Tokenizer } from '../types.js';
import {
  consumeWhitespace,
  consumeHashComment,
  consumeString,
  consumeNumber,
  consumeIdentifier,
} from './shared.js';

const KEYWORDS = new Set([
  'begin', 'break', 'case', 'class', 'def', 'do', 'else', 'elsif',
  'end', 'ensure', 'for', 'if', 'in', 'module', 'next', 'nil',
  'rescue', 'return', 'self', 'super', 'then', 'unless', 'until',
  'when', 'while', 'yield', '__END__', 'true', 'false',
]);

const functionKeywords = new Set(['def']);
const NUMBER_PATTERN = /[0-9._a-fA-FxX]/;

export const rubyTokenizer: Tokenizer = {
  language: 'ruby',

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

      // Comments — # to end of line.
      if (c === '#') {
        i = consumeHashComment(code, i, tokens);
        continue;
      }

      // Strings (double-quoted with interpolation, single-quoted).
      if (c === '"' || c === '\'') {
        i = consumeString(code, i, tokens);
        continue;
      }

      // %q(...), %Q(...), %(...) style strings.
      if (c === '%' && i + 1 < code.length && /[qQrIwWsx]/.test(code[i + 1]!)) {
        const typeChar = code[i + 1]!;
        let j = i + 2;
        if (j < code.length) {
          const delimiter = code[j]!;
          const matchingDelim = /[({[]/.test(delimiter)
            ? (delimiter === '(' ? ')' : delimiter === '{' ? '}' : ']')
            : delimiter;
          j++;
          while (j < code.length && code[j] !== matchingDelim) {
            if (code[j] === '\\') j++;
            j++;
          }
          if (j < code.length) j++;
          tokens.push({ kind: 'string', text: code.slice(i, j) });
          i = j;
          continue;
        }
      }

      // Heredoc start: `<<~`, `<<-`, or `<<` followed by identifier/quoted.
      if (c === '<' && code[i + 1] === '<') {
        let j = i + 2;
        // Skip optional ~ or -
        if (code[j] === '~' || code[j] === '-') j++;
        // Skip whitespace
        while (j < code.length && code[j] === ' ') j++;
        // Read heredoc delimiter (quoted or bare identifier)
        if (j < code.length && (code[j] === '"' || code[j] === '\'' || code[j] === '`')) {
          const delim = code[j]!;
          j++;
          while (j < code.length && code[j] !== delim) j++;
          if (j < code.length) j++;
        } else {
          while (j < code.length && /[A-Za-z0-9_]/.test(code[j]!)) j++;
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
      if (/[A-Za-z_]/.test(c)) {
        i = consumeIdentifier(code, i, KEYWORDS, tokens, {
          functionKeywords,
          pendingIsFunction,
        });

        // Handle method names ending with ? or ! (Ruby convention).
        // After `def`, the identifier might be followed by ? or !.
        const emitted = tokens[tokens.length - 1];
        if (emitted?.kind === 'function') {
          if (code[i] === '?' || code[i] === '!') {
            tokens[tokens.length - 1] = {
              kind: 'function',
              text: emitted.text + code[i],
            };
            i++;
          }
        }
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
      if (/[()[\]{},.;:@]/.test(c)) {
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
