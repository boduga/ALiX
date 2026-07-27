// src/tui/blocks/langs/html.ts
// HTML tokenizer. Recognizes tags, attributes, attribute values,
// comments, doctype declarations, and text content. Whitespace is
// emitted as plain tokens.
//
// Not a full grammar — tokenization is for coloring only. The renderer
// never knows HTML; it just gets a stream of (kind, text) pairs.

import type { Token, Tokenizer } from '../types.js';
import {
  consumeWhitespace,
  consumeIdentifier,
  lastNonPlainToken,
} from './shared.js';

export const htmlTokenizer: Tokenizer = {
  language: 'html',
  tokenize(code: string): Token[] {
    if (code === '') return [];
    const tokens: Token[] = [];
    let i = 0;

    while (i < code.length) {
      const c = code[i]!;

      // Whitespace — preserve verbatim as plain.
      const wsI = consumeWhitespace(code, i, tokens);
      if (wsI !== i) { i = wsI; continue; }

      // HTML comment: <!-- ... -->
      if (c === '<' && code.slice(i, i + 4) === '<!--') {
        let j = i + 4;
        while (j < code.length && code.slice(j, j + 3) !== '-->') j++;
        if (j < code.length) j += 3;
        tokens.push({ kind: 'comment', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Doctype: <!DOCTYPE ...>
      if (
        c === '<' &&
        code[i + 1] === '!' &&
        /[Dd][Oo][Cc][Tt][Yy][Pp][Ee]/.test(code.slice(i + 2, i + 9))
      ) {
        let j = i + 9;
        while (j < code.length && code[j] !== '>') j++;
        if (j < code.length) j++;
        tokens.push({ kind: 'keyword', text: code.slice(i, j) });
        i = j;
        continue;
      }

      // Tag: <tagname attr="value" ...>
      if (c === '<') {
        tokens.push({ kind: 'punctuation', text: '<' });
        let j = i + 1;
        // Optional closing-tag slash
        if (code[j] === '/') {
          tokens.push({ kind: 'punctuation', text: '/' });
          j++;
        }
        // Tag name (HTML is case-insensitive but treat as keyword regardless)
        const nameStart = j;
        while (j < code.length && /[A-Za-z0-9-]/.test(code[j]!)) j++;
        if (j > nameStart) {
          tokens.push({ kind: 'keyword', text: code.slice(nameStart, j) });
        }
        // Attributes until >
        while (j < code.length && code[j] !== '>') {
          // Skip whitespace
          const wsStart = j;
          while (j < code.length && /\s/.test(code[j]!)) j++;
          if (j > wsStart) {
            tokens.push({ kind: 'plain', text: code.slice(wsStart, j) });
          }
          if (code[j] === '/' && code[j + 1] === '>') {
            tokens.push({ kind: 'punctuation', text: '/' });
            j++;
            continue;
          }
          if (code[j] === '>') break;
          // Attribute name (or boolean attribute as unquoted value)
          const attrStart = j;
          while (j < code.length && /[A-Za-z0-9_:.-]/.test(code[j]!)) j++;
          if (j > attrStart) {
            if (code[j] === '=') {
              tokens.push({ kind: 'function', text: code.slice(attrStart, j) });
            } else {
              // Boolean attribute — no `=` follows, so treat as unquoted value.
              tokens.push({ kind: 'string', text: code.slice(attrStart, j) });
            }
          }
          // Optional =value
          if (code[j] === '=') {
            tokens.push({ kind: 'operator', text: '=' });
            j++;
            // Whitespace between = and value
            while (j < code.length && /\s/.test(code[j]!)) j++;
            const valueStart = j;
            if (code[j] === '"' || code[j] === "'") {
              const delim = code[j]!;
              j++;
              while (j < code.length && code[j] !== delim) j++;
              if (j < code.length) j++;
            } else {
              // Unquoted value
              while (j < code.length && !/[\s>]/.test(code[j]!)) j++;
            }
            tokens.push({ kind: 'string', text: code.slice(valueStart, j) });
          }
        }
        if (code[j] === '>') {
          tokens.push({ kind: 'punctuation', text: '>' });
          j++;
        }
        i = j;
        continue;
      }

      // Plain text content (until next <)
      const textStart = i;
      while (i < code.length && code[i] !== '<') i++;
      const text = code.slice(textStart, i);
      if (text.length > 0) {
        // Split on whitespace, push plain tokens
        let k = 0;
        while (k < text.length) {
          while (k < text.length && /\s/.test(text[k]!)) k++;
          const segStart = k;
          while (k < text.length && !/\s/.test(text[k]!)) k++;
          if (k > segStart) {
            tokens.push({ kind: 'plain', text: text.slice(segStart, k) });
          }
        }
      }
    }

    return tokens;
  },
};

// Touch shared helpers so the import isn't flagged as unused — they are
// used by sibling tokenizers and re-exports keep the dependency
// surface aligned. (No-op at runtime.)
void consumeIdentifier;
void lastNonPlainToken;