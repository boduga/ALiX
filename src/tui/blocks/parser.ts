// src/tui/blocks/parser.ts
// Block-level markdown parser. Walks the input line-by-line and
// emits a sequence of `ResponseBlock`s. Inline formatting is NOT
// handled here — the renderer calls `parseInline` on each
// text/heading/quote block as needed.
//
// Order of dispatch per line matters:
//   - code fence (before list — so ```- ``` isn't mis-parsed)
//   - heading (before text — so `# Title` isn't absorbed)
//   - rule (before text — so `---` isn't absorbed)
//   - quote (before text — so `>` isn't absorbed)
//   - list (before text — so `- ` isn't absorbed)
//   - text fallback

import type { ResponseBlock } from './types.js';

/**
 * Parse `md` into a sequence of `ResponseBlock`. Block-level markdown
 * only — inline formatting is handled by the renderer (which calls
 * `parseInline` on each text/heading/quote block as needed).
 */
export function parseBlocks(md: string): readonly ResponseBlock[] {
  if (!md || !md.trim()) return [];

  const lines = md.split(/\r?\n/);
  const blocks: ResponseBlock[] = [];
  let textBuffer: string[] = [];

  const flushText = (): void => {
    if (textBuffer.length === 0) return;
    while (
      textBuffer.length > 0 &&
      textBuffer[textBuffer.length - 1]!.trim() === ''
    ) {
      textBuffer.pop();
    }
    if (textBuffer.length === 0) return;
    const joined = textBuffer.join('\n');
    textBuffer = [];
    blocks.push({ type: 'text', text: joined });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // --- HEADING ---
    const heading = matchHeading(line);
    if (heading !== null) {
      flushText();
      blocks.push({
        type: 'heading',
        level: heading.level,
        text: heading.text,
        spans: undefined,
      });
      i++;
      continue;
    }

    // --- CODE FENCE ---
    const fence = matchFenceOpen(line);
    if (fence !== null) {
      flushText();
      const codeLines: string[] = [];
      let closed = false;
      let j = i + 1;
      while (j < lines.length) {
        if (matchFenceClose(lines[j]!, fence.fenceLen)) {
          closed = true;
          break;
        }
        codeLines.push(lines[j]!);
        j++;
      }
      if (closed) {
        const codeBlock: ResponseBlock = {
          type: 'code',
          code: codeLines.join('\n'),
          spans: undefined,
        };
        if (fence.language !== undefined) {
          (codeBlock as { language?: string }).language = fence.language;
        }
        blocks.push(codeBlock);
        i = j + 1;
        continue;
      }
      // Unclosed fence: emit fence + collected content as a single
      // text block.
      blocks.pop();
      blocks.push({ type: 'text', text: [line, ...codeLines].join('\n') });
      i = lines.length;
      continue;
    }

    // --- RULE ---
    if (matchRule(line)) {
      flushText();
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }

    // --- QUOTE ---
    if (line.startsWith('>')) {
      flushText();
      const quoteLines: string[] = [];
      let j = i;
      while (j < lines.length) {
        const q = lines[j]!;
        if (q.startsWith('>')) {
          quoteLines.push(q.replace(/^>\s?/, ''));
          j++;
        } else if (q.trim() === '') {
          break; // blank line ends quote
        } else {
          break;
        }
      }
      blocks.push({
        type: 'quote',
        text: quoteLines.join('\n'),
        spans: undefined,
      });
      i = j;
      continue;
    }

    // --- LIST ---
    const item = matchListItem(line);
    if (item !== null) {
      flushText();
      const marker = item.marker;
      const items: string[] = [];
      const checkedItems: (boolean | undefined)[] = [];
      let hasTaskItem = false;

      // Process first item
      let itemText = item.text;
      let firstChecked: boolean | undefined;
      const firstTaskMatch = itemText.match(/^\[( |x|X)\]\s*/);
      if (firstTaskMatch) {
        firstChecked = firstTaskMatch[1] === 'x' || firstTaskMatch[1] === 'X';
        hasTaskItem = true;
        itemText = itemText.slice(firstTaskMatch[0].length);
      }
      if (itemText !== '') {
        checkedItems.push(firstChecked);
        items.push(itemText);
      }

      let j = i + 1;
      while (j < lines.length) {
        const candidate = matchListItem(lines[j]!);
        if (candidate === null || candidate.marker !== marker) break;
        let candidateText = candidate.text;
        let candidateChecked: boolean | undefined;
        const candidateTaskMatch = candidateText.match(/^\[( |x|X)\]\s*/);
        if (candidateTaskMatch) {
          candidateChecked = candidateTaskMatch[1] === 'x' || candidateTaskMatch[1] === 'X';
          hasTaskItem = true;
          candidateText = candidateText.slice(candidateTaskMatch[0].length);
        }
        if (candidateText === '') break; // empty item — stop
        checkedItems.push(candidateChecked);
        items.push(candidateText);
        j++;
      }

      if (items.length > 0) {
        const listBlock: ResponseBlock & { checked?: readonly (boolean | undefined)[] } = { type: 'list', marker, items };
        if (hasTaskItem) {
          listBlock.checked = checkedItems;
        }
        blocks.push(listBlock);
      }
      i = j;
      continue;
    }

    // --- TABLE ---
    const tableBlock = tryParseTable(lines, i);
    if (tableBlock !== null) {
      flushText();
      blocks.push(tableBlock);
      i = tableBlock._lineCount;
      continue;
    }

    // --- TEXT FALLBACK ---
    if (line.trim() === '') {
      if (textBuffer.length === 0) {
        // Boundary blank — consume silently.
      } else {
        textBuffer.push('');
      }
    } else {
      textBuffer.push(line);
    }
    i++;
  }

  flushText();
  return blocks;
}

function matchHeading(line: string): { level: 1 | 2 | 3; text: string } | null {
  const m = /^(#{1,3})\s+(.*)$/.exec(line);
  if (!m) return null;
  const level = m[1]!.length as 1 | 2 | 3;
  return { level, text: m[2]! };
}

function matchFenceOpen(line: string): { fenceLen: number; language?: string } | null {
  const match = /^(`{3,})([^\s`]*)\s*$/.exec(line);
  if (!match) return null;
  const fenceLen = match[1]!.length;
  const lang = match[2] || undefined;
  return lang ? { fenceLen, language: lang } : { fenceLen };
}

function matchFenceClose(line: string, fenceLen: number): boolean {
  const stripped = line.trimEnd();
  if (stripped.length !== fenceLen) return false;
  for (let i = 0; i < fenceLen; i++) if (stripped[i] !== '`') return false;
  return true;
}

function matchListItem(
  line: string
): { marker: 'unordered' | 'ordered'; text: string } | null {
  const dash = /^-(?:\s+(.*))?$/.exec(line);
  if (dash) return { marker: 'unordered', text: dash[1] ?? '' };
  const star = /^\*(?:\s+(.*))?$/.exec(line);
  if (star) return { marker: 'unordered', text: star[1] ?? '' };
  const plus = /^\+(?:\s+(.*))?$/.exec(line);
  if (plus) return { marker: 'unordered', text: plus[1] ?? '' };
  const ordered = /^\d+\.(?:\s+(.*))?$/.exec(line);
  if (ordered) return { marker: 'ordered', text: ordered[1] ?? '' };
  return null;
}

function matchRule(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3) return false;
  if (!/^([-*_])\1{2,}$/.test(trimmed)) return false;
  return true;
}

// ── Table parsing ──

type TableParseResult = ResponseBlock & {
  type: 'table';
  headers: string[];
  rows: string[][];
  align?: ('left' | 'center' | 'right')[];
  _lineCount: number;
};

/**
 * Attempt to parse a pipe table starting at line index `start`.
 * Returns null if no table detected.
 *
 * GFM pipe table syntax:
 *   | Header 1 | Header 2 |
 *   |----------|----------|   ← delimiter row
 *   | Cell 1   | Cell 2   |
 *   | Cell 3   | Cell 4   |
 */
function tryParseTable(
  lines: readonly string[],
  start: number,
): TableParseResult | null {
  const headerLine = lines[start]!;
  if (!headerLine.includes('|')) return null;
  if (start + 1 >= lines.length) return null;
  const delimLine = lines[start + 1]!;
  const align = parseDelimiterRow(delimLine);
  if (align === null) return null;

  // Parse header cells
  const headers = splitPipeCells(headerLine);

  // Collect rows
  const rows: string[][] = [];
  const maxCols = headers.length;
  let j = start + 2;
  while (j < lines.length) {
    const rowLine = lines[j]!;
    if (!rowLine.includes('|') || rowLine.trim() === '') break;
    if (rowLine.trimStart().startsWith('#')) break;
    if (matchRule(rowLine)) break;

    const cells = splitPipeCells(rowLine);
    while (cells.length < maxCols) cells.push('');
    rows.push(cells.slice(0, maxCols));
    j++;
  }

  // Table must have at least one data row
  if (rows.length === 0) return null;

  const result: TableParseResult = {
    type: 'table',
    headers,
    rows,
    _lineCount: j,
  };
  if (align.some((a) => a !== null)) {
    result.align = align.map((a) => a ?? 'left') as ('left' | 'center' | 'right')[];
  }
  return result;
}

/**
 * Parse GFM delimiter row like `|---|---|` or `|:---|:--:|---:|`.
 * Returns null if line is not a valid delimiter row.
 * Returns array of alignments (null = default/left).
 */
function parseDelimiterRow(line: string): ('left' | 'center' | 'right' | null)[] | null {
  const cells = splitPipeCells(line.trim());
  if (cells.length === 0) return null;

  const alignments: ('left' | 'center' | 'right' | null)[] = [];
  for (const cell of cells) {
    const trimmed = cell.trim();
    if (!/^:?-{3,}:?$/.test(trimmed)) return null;

    if (trimmed.startsWith(':') && trimmed.endsWith(':')) {
      alignments.push('center');
    } else if (trimmed.endsWith(':')) {
      alignments.push('right');
    } else {
      alignments.push(null); // default: left
    }
  }
  return alignments;
}

/**
 * Split a pipe-delimited line into cells.
 * Handles escaped pipes (\|) and optional leading/trailing pipes.
 */
function splitPipeCells(line: string): string[] {
  let s = line.trim();
  // Strip leading/trailing pipes
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '\\' && s[i + 1] === '|') {
      current += '|';
      i += 2;
      continue;
    }
    if (c === '|') {
      cells.push(current.trim());
      current = '';
      i++;
      continue;
    }
    current += c;
    i++;
  }
  cells.push(current.trim());
  return cells;
}