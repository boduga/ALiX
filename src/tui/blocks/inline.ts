// src/tui/blocks/inline.ts
// Inline-formatting parser. Walks the input string once, emitting a
// sequence of InlineSpan. Recognizes **bold**, *italic*, `inline code`,
// [text](href) links, and backslash-escaped punctuation.
//
// Strategy: a single state machine with mode switches at delimiter
// boundaries. Unclosed delimiters are treated as literal text —
// markdown-flavored, not CommonMark-strict.

import type { InlineSpan } from './types.js';

/**
 * Parse `text` into a sequence of styled InlineSpans. Always returns
 * at least one span for non-empty input; returns `[]` for empty input.
 */
export function parseInline(text: string): InlineSpan[] {
  if (text === '') return [];

  const out: InlineSpan[] = [];
  let buf = '';
  let i = 0;

  const flushText = (): void => {
    if (buf.length > 0) {
      out.push({ kind: 'text', text: buf });
      buf = '';
    }
  };

  // Peek helpers — avoid allocating substrings for hot loops.
  const peek = (off: number): string | undefined =>
    i + off < text.length ? text[i + off] : undefined;

  while (i < text.length) {
    const c = text[i]!;

    // Backslash escape: \*, \\, \`
    if (c === '\\' && peek(1) !== undefined) {
      const next = text[i + 1]!;
      if (next === '*' || next === '`' || next === '\\' || next === '[' || next === ']' || next === '(' || next === ')' || next === '~' || next === '<' || next === '>') {
        buf += next;
        i += 2;
        continue;
      }
    }

    // **bold**: needs a matching ** later in the string.
    if (c === '*' && peek(1) === '*') {
      const closeAt = text.indexOf('**', i + 2);
      if (closeAt > i + 2) {
        flushText();
        out.push({ kind: 'bold', text: text.slice(i + 2, closeAt) });
        i = closeAt + 2;
        continue;
      }
    }

    // ~~strikethrough~~
    if (c === '~' && peek(1) === '~') {
      const closeAt = text.indexOf('~~', i + 2);
      if (closeAt > i + 2) {
        flushText();
        out.push({ kind: 'strikethrough', text: text.slice(i + 2, closeAt) });
        i = closeAt + 2;
        continue;
      }
    }

    // *italic*: single asterisks, NOT adjacent to another * (so **bold**
    // above wins).
    if (c === '*' && peek(1) !== '*' && (i === 0 || text[i - 1] !== '*')) {
      const closeAt = findItalicClose(text, i + 1);
      if (closeAt > i + 1) {
        flushText();
        out.push({ kind: 'italic', text: text.slice(i + 1, closeAt) });
        i = closeAt + 1;
        continue;
      }
    }

    // `inline code`: matching backtick later.
    if (c === '`') {
      const closeAt = text.indexOf('`', i + 1);
      if (closeAt > i + 1) {
        flushText();
        out.push({ kind: 'code', text: text.slice(i + 1, closeAt) });
        i = closeAt + 1;
        continue;
      }
    }

    // [text](href): matching ] then (href) immediately.
    if (c === '[') {
      const linkEnd = tryParseLink(text, i);
      if (linkEnd.end > i) {
        flushText();
        // When end > i, linkEnd is the LinkMatch branch (sentinel uses end: 0).
        const match = linkEnd as LinkMatch;
        out.push({ kind: 'link', text: match.text, href: match.href });
        i = match.end;
        continue;
      }
    }

    // <url> autolink
    if (c === '<') {
      const urlEnd = tryParseAngleAutolink(text, i);
      if (urlEnd > i) {
        flushText();
        const url = text.slice(i + 1, urlEnd - 1); // strip < >
        out.push({ kind: 'link', text: url, href: url });
        i = urlEnd;
        continue;
      }
    }

    // Bare URL autolink: http:// or https://
    if ((c === 'h' || c === 'H') && (text.slice(i, i + 8).toLowerCase() === 'https://' || text.slice(i, i + 7).toLowerCase() === 'http://')) {
      const urlEnd = tryParseBareUrl(text, i);
      if (urlEnd > i) {
        flushText();
        let url = text.slice(i, urlEnd);
        // Strip trailing punctuation
        const stripped = url.replace(/[.!?,:;'")\]]+$/, '');
        if (stripped.length > 0) {
          const trailing = url.slice(stripped.length);
          out.push({ kind: 'link', text: stripped, href: stripped });
          if (trailing) buf += trailing;
          i = urlEnd;
          continue;
        }
      }
    }

    buf += c;
    i++;
  }

  flushText();
  return out;
}

/**
 * Find the index of the `*` that closes a single-asterisk italic span
 * opened at position `start`. The closing `*` must NOT be adjacent to
 * another `*` (so `*foo*bar*` matches `foo`, not `foo*bar`).
 *
 * Returns -1 if no close is found.
 */
function findItalicClose(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    if (text[i] === '*' && text[i + 1] !== '*' && text[i - 1] !== '*') {
      return i;
    }
    i++;
  }
  return -1;
}

interface LinkMatch {
  text: string;
  href: string;
  end: number;
}

/**
 * If `text` at position `start` begins a `[text](href)` link, return
 * the parsed text, href, and the index AFTER the closing `)`.
 * Otherwise return a sentinel where `end <= start` so the caller can
 * detect no-match.
 */
function tryParseLink(text: string, start: number): LinkMatch | { end: number } {
  const closeBracket = text.indexOf(']', start + 1);
  if (closeBracket <= start + 1) return { end: 0 };
  // Need `(` immediately after `]`.
  if (text[closeBracket + 1] !== '(') return { end: 0 };
  const closeParen = text.indexOf(')', closeBracket + 2);
  if (closeParen <= closeBracket + 2) return { end: 0 };
  // href must not contain whitespace (very rough check).
  const href = text.slice(closeBracket + 2, closeParen);
  if (/\s/.test(href)) return { end: 0 };
  return { text: text.slice(start + 1, closeBracket), href, end: closeParen + 1 };
}

const URL_PROTOCOLS = ['http://', 'https://', 'ftp://', 'mailto:'];

/**
 * Try to parse an angle-bracket autolink starting at `start`.
 * Returns the index AFTER the closing `>`, or 0 if no match.
 */
function tryParseAngleAutolink(text: string, start: number): number {
  // Find closing >
  const close = text.indexOf('>', start + 1);
  if (close <= start + 1) return 0;
  const inner = text.slice(start + 1, close);
  // Must be a known protocol
  if (URL_PROTOCOLS.some((p) => inner.startsWith(p))) {
    return close + 1;
  }
  return 0;
}

const BARE_URL_RE = /^https?:\/\/[^\s<>{}|\\^`[\]]+/;

/**
 * Try to parse a bare URL starting at `start`.
 * Returns the index after the last URL character, or 0 if no match.
 */
function tryParseBareUrl(text: string, start: number): number {
  const m = BARE_URL_RE.exec(text.slice(start));
  if (!m) return 0;
  return start + m[0].length;
}