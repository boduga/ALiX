import { stripAnsi } from '../box.js';

/**
 * Word-wrap `text` to fit within `width` columns. Splits on whitespace
 * so words stay intact; lines that exceed `width` (e.g. a single
 * unusually long token) are hard-truncated to fit. Returns at least
 * one element. Empty input returns a single empty string so callers can
 * always render at least one row.
 *
 * ANSI-aware: escape sequences are NOT counted toward column width,
 * and truncation never breaks mid-sequence.
 *
 * Newline preservation: explicit `\n` characters in `text` produce
 * literal line breaks in the output. This matters for multi-line code
 * blocks (```` ``` ````) where collapsing newlines into spaces would
 * shove the entire block onto one line. Each `\n` flushes the current
 * line and starts a fresh one, which is then word-wrapped independently.
 */

function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

function wrapOneLine(line: string, width: number): string[] {
  if (!line) return [''];
  const out: string[] = [];
  let cur = '';
  for (const word of line.split(/\s+/)) {
    if (!word) continue;
    if (!cur) {
      cur = word;
    } else if (visibleLength(cur) + 1 + visibleLength(word) <= width) {
      cur += ' ' + word;
    } else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  return out.map((l) => hardTruncate(l, width));
}

function hardTruncate(line: string, width: number): string {
  let visible = 0;
  let result = '';
  let i = 0;
  // Track whether the line had active ANSI formatting (color, bold, etc.)
  // at the truncation point. Only append a reset if so — unconditionally
  // appending \x1b[0m on every truncation cancels caller styling that's
  // still active outside this line.
  let hasActiveAnsi = false;
  while (i < line.length && visible < width) {
    if (line[i] === '\x1b') {
      const seqMatch = line.slice(i).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
      if (seqMatch) {
        const seq = seqMatch[0];
        result += seq;
        i += seq.length;
        // \x1b[0m and \x1b[39m close all attributes; we don't need a
        // closing reset after that.
        if (seq === '\x1b[0m' || seq === '\x1b[39m') {
          hasActiveAnsi = false;
        } else {
          hasActiveAnsi = true;
        }
        continue;
      }
    }
    result += line[i]!;
    visible++;
    i++;
  }
  // Only emit a reset if we truncated past visible content AND the
  // line had active formatting. Plain text and already-reset lines
  // get no reset.
  if (i < line.length && hasActiveAnsi) {
    result += '\x1b[0m';
  }
  return result;
}

export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [''];
  if (!text) return [''];
  // Normalize CRLF and bare CR to LF. Without this, a CRLF line ending
  // leaves a trailing "\r" inside the segment, which the whitespace
  // splitter then drops — and CRLF blank lines (just "\r\n") become a
  // truthy "\r" that wraps to [], silently dropping the row.
  const normalized = text.replace(/\r\n?/g, '\n');
  const out: string[] = [];
  for (const para of normalized.split('\n')) {
    out.push(...wrapOneLine(para, width));
  }
  return out;
}
