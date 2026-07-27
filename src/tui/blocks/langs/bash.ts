// src/tui/blocks/langs/bash.ts
// Tokenizer for Bash / POSIX shell. Recognizes:
//   - comments: # to EOL
//   - strings: '...', "..."
//   - variables: $VAR, ${VAR}
//   - keywords: if, then, fi, else, elif, for, while, do, done, case,
//     esac, in, function, select, until, time

import type { Token, Tokenizer } from '../types.js';
import {
  consumeWhitespace,
  consumeHashComment,
  consumeString,
  consumeIdentifier,
} from './shared.js';

const KEYWORDS = new Set([
  'if', 'then', 'fi', 'else', 'elif',
  'for', 'while', 'do', 'done',
  'case', 'esac', 'in',
  'function', 'select', 'until', 'time',
]);

export const bashTokenizer: Tokenizer = {
  language: 'bash',

  tokenize(code: string): Token[] {
    if (code === '') return [];
    const tokens: Token[] = [];
    let i = 0;

    while (i < code.length) {
      const c = code[i]!;

      // Whitespace.
      const wsI = consumeWhitespace(code, i, tokens);
      if (wsI !== i) { i = wsI; continue; }

      // Comments.
      if (c === '#') {
        i = consumeHashComment(code, i, tokens);
        continue;
      }

      // Strings.
      if (c === '"' || c === "'") {
        i = consumeString(code, i, tokens);
        continue;
      }

      // Variables ($VAR or ${VAR}).
      if (c === '$') {
        let j = i + 1;
        if (j < code.length && code[j] === '{') {
          while (j < code.length && code[j] !== '}') j++;
          if (j < code.length) j++;
        } else {
          while (j < code.length && /[A-Za-z0-9_]/.test(code[j]!)) j++;
        }
        tokens.push({ kind: 'identifier', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Identifiers / keywords.
      if (/[A-Za-z_]/.test(c)) {
        i = consumeIdentifier(code, i, KEYWORDS, tokens);
        continue;
      }

      // Operators.
      if (/[|<>=&;]/.test(c)) {
        let j = i + 1;
        while (j < code.length && /[|<>=&;]/.test(code[j]!)) j++;
        tokens.push({ kind: 'operator', text: code.slice(i, j) });
        i = j;
        continue;
      }

      tokens.push({ kind: 'plain', text: c });
      i++;
    }

    return tokens;
  },
};
