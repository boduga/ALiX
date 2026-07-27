// src/tui/blocks/tokenize.ts
// Dispatcher: maps `language` to a language-specific tokenizer. Falls
// back to plain for unknown languages. Language-specific tokenizers
// are registered in Tasks 7-10 (Python, TypeScript, JSON, Bash).

import type { Token, Tokenizer } from './types.js';
import { plainTokenizer } from './langs/plain.js';

/**
 * Registry of language tokenizers. Each entry maps a canonical
 * language id (and any aliases) to a Tokenizer.
 */
const TOKENIZERS: Record<string, Tokenizer> = {
  // Populated by Tasks 7-10:
  //   python / py        -> pythonTokenizer
  //   typescript / tsx   -> typescriptTokenizer
  //   javascript / jsx   -> typescriptTokenizer
  //   json               -> jsonTokenizer
  //   bash / sh / shell  -> bashTokenizer
};

/**
 * Tokenize `code` according to `language`. Returns plain tokens when
 * the language isn't registered (or for empty input).
 */
export function tokenize(code: string, language?: string): Token[] {
  if (code === '') return [];
  const lang = (language ?? '').toLowerCase();
  const tokenizer = TOKENIZERS[lang];
  return (tokenizer ?? plainTokenizer).tokenize(code);
}

/**
 * Internal — Tasks 7-10 register tokenizers without
 * exposing the registry.
 */
export function registerTokenizer(language: string, tokenizer: Tokenizer): void {
  TOKENIZERS[language.toLowerCase()] = tokenizer;
}
