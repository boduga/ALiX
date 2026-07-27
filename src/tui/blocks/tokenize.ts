// src/tui/blocks/tokenize.ts
// Dispatcher: maps `language` to a language-specific tokenizer. Falls
// back to plain for unknown languages. Language-specific tokenizers
// are registered in Tasks 7-10 (Python, TypeScript, JSON, Bash).

import type { Token, Tokenizer } from './types.js';
import { plainTokenizer } from './langs/plain.js';
import { pythonTokenizer } from './langs/python.js';
import { jsonTokenizer } from './langs/json.js';
import { bashTokenizer } from './langs/bash.js';

/**
 * Registry of language tokenizers. Each entry maps a canonical
 * language id (and any aliases) to a Tokenizer.
 */
const TOKENIZERS: Record<string, Tokenizer> = {
  python: pythonTokenizer,
  py: pythonTokenizer,
  // Tasks 8-10 add: typescript, ts, tsx, javascript, js, jsx, json,
  // bash, sh, shell.
  json: jsonTokenizer,
  bash: bashTokenizer,
  sh: bashTokenizer,
  shell: bashTokenizer,
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
