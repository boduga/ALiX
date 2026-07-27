import type { Token, TokenKind, Tokenizer } from '../types.js';

/**
 * Skip whitespace run starting at `i`. Push a `plain` token for it.
 * Returns the new index (at the first non-whitespace character).
 */
export function consumeWhitespace(code: string, i: number, tokens: Token[]): number {
  if (!/[ \t\r\n]/.test(code[i]!)) return i;
  let j = i;
  while (j < code.length && /[ \t\r\n]/.test(code[j]!)) j++;
  tokens.push({ kind: 'plain', text: code.slice(i, j) });
  return j;
}

/**
 * Parse a `#`-to-EOL comment starting at `i` (where `code[i] === '#'`).
 * Push a `comment` token. Returns the new index.
 */
export function consumeHashComment(code: string, i: number, tokens: Token[]): number {
  let j = i + 1;
  while (j < code.length && code[j] !== '\n') j++;
  tokens.push({ kind: 'comment', text: code.slice(i, j) });
  return j;
}

/**
 * Parse a string literal starting at `i` where `code[i]` is the opening
 * delimiter (`"`, `'`, or backtick). Respects backslash escapes and
 * newlines (most languages don't allow multi-line strings). Pushes a
 * `string` token. Returns the new index.
 *
 * For triple-quoted strings (Python), pass `opts.triple: true`.
 * For template literals (TS/JS backtick), the body up to the matching
 * backtick is included verbatim (no ${} interpolation parsing).
 */
export function consumeString(
  code: string,
  i: number,
  tokens: Token[],
  opts?: { triple?: boolean },
): number {
  const delimiter = code[i]!;
  let j = i + 1;

  if (opts?.triple && code[i + 1] === delimiter && code[i + 2] === delimiter) {
    // Triple-quoted string
    j = i + 3;
    while (j < code.length && !(code[j] === delimiter && code[j + 1] === delimiter && code[j + 2] === delimiter)) {
      if (code[j] === '\\') j++;
      j++;
    }
    if (j < code.length) j += 3;
  } else {
    // Single/double/template string
    while (j < code.length && code[j] !== delimiter && code[j] !== '\n') {
      if (code[j] === '\\') j++;
      j++;
    }
    if (j < code.length && code[j] === delimiter) j++;
  }

  // For f-strings (Python f"..." or f'...'), pop the leading 'f' if it
  // was emitted as a separate plain token already.
  const text = code.slice(i, j);
  tokens.push({ kind: 'string', text });
  return j;
}

/**
 * Parse a number literal starting at `i`. Pushes a `number` token.
 * Returns the new index.
 */
export function consumeNumber(
  code: string,
  i: number,
  tokens: Token[],
  pattern: RegExp = /[0-9._a-fA-FxXoObBeE+\-]/,
): number {
  let j = i + 1;
  while (j < code.length && pattern.test(code[j]!)) j++;
  tokens.push({ kind: 'number', text: code.slice(i, j) });
  return j;
}

/**
 * Parse an identifier or keyword starting at `i`. Checks against
 * `keywords` Set. Pushes `keyword` or `identifier` token.
 * When `opts.functionKeywords` contains a keyword (e.g. "def" in
 * Python), the NEXT identifier is marked as `function` kind instead.
 * Returns the new index.
 */
export function consumeIdentifier(
  code: string,
  i: number,
  keywords: Set<string>,
  tokens: Token[],
  opts?: {
    functionKeywords?: Set<string>;
    pendingIsFunction?: { value: boolean };
  },
): number {
  let j = i + 1;
  while (j < code.length && /[A-Za-z0-9_$]/.test(code[j]!)) j++;
  const word = code.slice(i, j);

  if (keywords.has(word)) {
    tokens.push({ kind: 'keyword', text: word });
    if (opts?.functionKeywords?.has(word)) {
      if (opts.pendingIsFunction) opts.pendingIsFunction.value = true;
    }
  } else if (opts?.pendingIsFunction?.value) {
    tokens.push({ kind: 'function', text: word });
    opts.pendingIsFunction.value = false;
  } else {
    tokens.push({ kind: 'identifier', text: word });
  }
  return j;
}

/**
 * Get the last non-`plain` token. Returns `undefined` if all tokens
 * are plain. Useful for regex-literal detection in TypeScript.
 */
export function lastNonPlainToken(tokens: Token[]): Token | undefined {
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i]!.kind !== 'plain') return tokens[i];
  }
  return undefined;
}
