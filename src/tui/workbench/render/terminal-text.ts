const combining = /[\p{Mark}\u200d\ufe0e\ufe0f]/u;

export function graphemes(text: string): readonly string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (...args: any[]) => { segment(value: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) return [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((part) => part.segment);
  return Array.from(text);
}

function isWide(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f || codePoint === 0x2329 || codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

export function graphemeWidth(value: string): number {
  let width = 0;
  for (const character of Array.from(value)) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === 0 || codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0) || combining.test(character)) continue;
    width = Math.max(width, isWide(codePoint) ? 2 : 1);
  }
  return width;
}

export function displayWidth(text: string): number {
  return graphemes(text).reduce((total, grapheme) => total + graphemeWidth(grapheme), 0);
}

export function wrapDisplayText(text: string, columns: number): readonly string[] {
  const width = Math.max(1, columns);
  const rows: string[] = [];
  let row = '';
  let used = 0;
  for (const grapheme of graphemes(text)) {
    const next = Math.max(0, graphemeWidth(grapheme));
    if (used > 0 && used + next > width) {
      rows.push(row);
      row = '';
      used = 0;
    }
    row += grapheme;
    used += next;
  }
  rows.push(row);
  return rows;
}
