/**
 * Word-wrap `text` to fit within `width` columns. Splits on whitespace
 * so words stay intact; lines that exceed `width` (e.g. a single
 * unusually long token) are hard-truncated to fit. Returns at least
 * one element. Empty input returns a single empty string so callers can
 * always render at least one row.
 */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [''];
  if (!text) return [''];
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (!cur) {
      cur = word;
    } else if (cur.length + 1 + word.length <= width) {
      cur += ' ' + word;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => (l.length > width ? l.slice(0, width) : l));
}
