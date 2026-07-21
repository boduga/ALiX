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
 */

function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [''];
  if (!text) return [''];
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (!cur) {
      cur = word;
    } else if (visibleLength(cur) + 1 + visibleLength(word) <= width) {
      cur += ' ' + word;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  // Hard-truncate any line whose visible width exceeds `width`, without
  // breaking ANSI escape sequences.
  return lines.map((l) => {
    let visible = 0;
    let result = '';
    let i = 0;
    while (i < l.length && visible < width) {
      if (l[i] === '\x1b') {
        const seqMatch = l.slice(i).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
        if (seqMatch) {
          result += seqMatch[0];
          i += seqMatch[0].length;
          continue;
        }
      }
      result += l[i]!;
      visible++;
      i++;
    }
    return result;
  });
}
