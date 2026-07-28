// src/tui/blocks/render.ts
// Walks a sequence of ResponseBlock and produces ANSI-styled rows ready
// to write to a TerminalCanvas. Pure: same input + theme + width → same
// output. Side-effect free. No knowledge of ANSI codes other than
// what's already in the Theme.
//
// Code blocks are handled minimally here (placeholder). Task 6 wires
// up the full bordered-chrome rendering with tokenization.

import type { ResponseBlock, InlineSpan, StyledRow, Theme, Token } from './types.js';
import { parseBlocks } from './parser.js';
import { defaultTheme } from './theme.js';
import { parseInline } from './inline.js';
import { tokenize } from './tokenize.js';
import { wrapText } from '../views/wrap-text.js';
import { RESET } from '../ansi-constants.js';

/**
 * Render all blocks into ANSI-styled rows. Width is the visible
 * column count (excluding any borders the caller may add — code
 * blocks reserve 4 columns internally for chrome).
 */
export function renderBlocks(
  blocks: readonly ResponseBlock[],
  theme: Theme,
  width: number,
): StyledRow[] {
  const out: StyledRow[] = [];
  let isFirstEver = true;

  for (const block of blocks) {
    const isFirst = isFirstEver;
    isFirstEver = false;

    switch (block.type) {
      case 'text':
        out.push(...renderTextOrInline(block.spans ?? parseInline(block.text), theme, width, isFirst));
        break;
      case 'heading':
        out.push(...renderHeading(block, theme, width, isFirst));
        break;
      case 'quote':
        out.push(...renderQuote(block, theme, width, isFirst));
        break;
      case 'rule':
        out.push(...renderRule(theme, width, isFirst));
        break;
      case 'list':
        out.push(...renderList(block, theme, width, isFirst));
        break;
      case 'code':
        out.push(...renderCode(block, theme, width, isFirst));
        break;
      case 'table':
        out.push(...renderTable(block, theme, width, isFirst));
        break;
    }
  }

  return out;
}

/**
 * Convenience: parse + render a string in one call. Equivalent to
 * `renderBlocks(parseBlocks(text), defaultTheme, width)`.
 */
export function renderResponse(text: string, width: number, theme: Theme = defaultTheme): StyledRow[] {
  return renderBlocks(parseBlocks(text), theme, width);
}

// --- Block renderers ---

function renderTextOrInline(
  spans: readonly InlineSpan[],
  theme: Theme,
  width: number,
  isFirst: boolean,
): StyledRow[] {
  if (spans.length === 0) return [];
  const styled = spans.map((s) => styleInlineSpan(s, theme)).join('');
  const lines =
    width > 0 && !styled.includes('\x1b') && !/\s/.test(styled) && styled.length > width
      ? Array.from({ length: Math.ceil(styled.length / width) }, (_, i) =>
          styled.slice(i * width, (i + 1) * width),
        )
      : wrapText(styled, width);
  return lines.map((text, i) => ({ text, isFirst: isFirst && i === 0 }));
}

function renderHeading(
  block: Extract<ResponseBlock, { type: 'heading' }>,
  theme: Theme,
  width: number,
  isFirst: boolean,
): StyledRow[] {
  const spans = block.spans ?? parseInline(block.text);
  const styledSpans = spans.map((s) => styleInlineSpan(s, theme)).join('');
  const headingText = theme.heading(block.level, styledSpans);
  const ruleText = theme.headingRule(block.level);
  // Heading is rendered as: <heading text>\n<rule line>
  // Both fit on one row each (no wrapping needed unless heading is huge).
  const lines = wrapText(headingText, width);
  const rows: StyledRow[] = lines.map((text, i) => ({ text, isFirst: isFirst && i === 0 }));
  // Rule line is full-width — don't wrap.
  rows.push({ text: ruleText, isFirst: false });
  return rows;
}

function renderQuote(
  block: Extract<ResponseBlock, { type: 'quote' }>,
  theme: Theme,
  width: number,
  isFirst: boolean,
): StyledRow[] {
  const spans = block.spans ?? parseInline(block.text);
  const styledSpans = spans.map((s) => styleInlineSpan(s, theme)).join('');

  // Check for callout marker at the start of raw text
  const calloutMatch = block.text.match(/^\[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT)\](?:\s*\n)?(.*)$/s);
  if (calloutMatch && calloutMatch[2] && calloutMatch[2].trim()) {
    const keyword = calloutMatch[1]!;
    const body = calloutMatch[2]!.trimStart();
    const bodySpans = parseInline(body);
    const bodyStyled = bodySpans.map((s) => styleInlineSpan(s, theme)).join('');

    const labelRow = theme.calloutLabel(keyword);
    const bodyLines = wrapText(bodyStyled, Math.max(1, width - 2));
    const bar = theme.quoteBar + '│ ' + RESET;

    const rows: StyledRow[] = [
      { text: theme.quoteBar + '┃ ' + RESET + labelRow, isFirst },
    ];
    bodyLines.forEach((line) => {
      rows.push({ text: bar + line, isFirst: false });
    });
    return rows;
  }

  // Standard quote (no callout marker) — unchanged
  const lines = wrapText(styledSpans, Math.max(1, width - 2));
  const bar = theme.quoteBar + '│ ' + RESET;
  return lines.map((text, i) => ({
    text: bar + text,
    isFirst: isFirst && i === 0,
  }));
}

function renderRule(theme: Theme, width: number, isFirst: boolean): StyledRow[] {
  const ch = '─';
  const raw = ch.repeat(Math.max(1, width));
  return [{ text: theme.rule + raw + RESET, isFirst }];
}

function renderList(
  block: Extract<ResponseBlock, { type: 'list' }>,
  theme: Theme,
  width: number,
  isFirst: boolean,
): StyledRow[] {
  const rows: StyledRow[] = [];
  block.items.forEach((item, idx) => {
    const checked = block.checked?.[idx];
    let prefix: string;
    let prefixVisibleLen: number;
    if (checked !== undefined) {
      prefix = checked ? theme.taskChecked + ' ' : theme.taskUnchecked + ' ';
      prefixVisibleLen = 3; // visible width of checkbox marker
    } else {
      prefix = block.marker === 'ordered' ? `${idx + 1}. ` : '• ';
      prefixVisibleLen = prefix.length;
    }
    const indent = ' '.repeat(prefixVisibleLen);
    const innerWidth = Math.max(1, width - prefixVisibleLen);
    const wrapped = wrapText(item, innerWidth);
    wrapped.forEach((line, i) => {
      rows.push({
        text: i === 0 ? prefix + line : indent + line,
        isFirst: isFirst && idx === 0 && i === 0,
      });
    });
  });
  return rows;
}

// --- Inline span styling ---

function styleInlineSpan(span: InlineSpan, theme: Theme): string {
  switch (span.kind) {
    case 'text':
      return span.text;
    case 'bold':
      return theme.bold(span.text);
    case 'italic':
      return theme.italic(span.text);
    case 'code':
      return theme.inlineCode(span.text);
    case 'link':
      return theme.link(span.text, span.href);
    case 'strikethrough':
      return theme.strikethrough(span.text);
  }
}

// --- Code block rendering ---

function renderCode(
  block: Extract<ResponseBlock, { type: 'code' }>,
  theme: Theme,
  width: number,
  isFirst: boolean,
): StyledRow[] {
  // Layout:
  // ┌─ <lang> ─<filler>─┐
  // │ <code line> │
  // └─<filler>─┘
  const innerWidth = Math.max(1, width - 4); // 2 borders + 2 padding
  const lang = block.language ?? '';

  // Tokenize (plain fallback for unknown languages; richer in Tasks 7-10).
  const tokens = tokenize(block.code, block.language);

  // Render code lines: each line's tokens are styled and concatenated.
  // Wrap each line to innerWidth (existing wrapText is ANSI-aware).
  // Tokenize emits `{kind:'plain', text:'\n\n'}` tokens to preserve
  // blank lines, so we need to split on those.
  const codeLines: string[] = [];
  let currentLine = '';
  for (const tok of tokens) {
    if (tok.kind === 'plain' && /^\n+$/.test(tok.text)) {
      // Blank-line marker — push current line, push empty lines.
      codeLines.push(currentLine);
      currentLine = '';
      for (let i = 1; i < tok.text.length; i++) codeLines.push('');
    } else {
      currentLine += styleToken(tok, theme);
    }
  }
  codeLines.push(currentLine);

  // Wrap each line and add side borders.
  const borderedLines = codeLines.map((line) => {
    const wrapped = wrapText(line || ' ', innerWidth);
    // Re-emit each wrapped line with borders.
    return wrapped.map((l) => `${theme.codeBorder}│${RESET} ${l} ${theme.codeBorder}│${RESET}`);
  });

  const rows: StyledRow[] = [];
  // Top border with optional language label.
  const topLabel = lang ? ` ${lang} ` : '';
  const topFill = Math.max(0, width - 2 - topLabel.length - 2);
  rows.push({
    text: `${theme.codeBorder}┌─${RESET}${theme.codeLangLabel(topLabel)}${theme.codeBorder}${'─'.repeat(topFill)}─┐${RESET}`,
    isFirst,
  });

  for (const wrappedLines of borderedLines) {
    for (const line of wrappedLines) {
      rows.push({ text: line, isFirst: false });
    }
  }

  // Bottom border.
  rows.push({
    text: `${theme.codeBorder}${'─'.repeat(width - 2)}┘${RESET}`,
    isFirst: false,
  });
  return rows;
}

function styleToken(token: Token, theme: Theme): string {
  switch (token.kind) {
    case 'keyword': return theme.codeKeyword(token.text);
    case 'string': return theme.codeString(token.text);
    case 'comment': return theme.codeComment(token.text);
    case 'number': return theme.codeNumber(token.text);
    case 'function': return theme.codeFunction(token.text);
    case 'identifier': return theme.codePlain(token.text);
    case 'operator': return theme.codeOperator(token.text);
    case 'punctuation': return theme.codePunctuation(token.text);
    case 'plain': return theme.codePlain(token.text);
  }
}

// ── Table rendering ──

function renderTable(
  block: Extract<ResponseBlock, { type: 'table' }>,
  theme: Theme,
  width: number,
  isFirst: boolean,
): StyledRow[] {
  const { headers, rows, align } = block;
  const colCount = headers.length;
  if (colCount === 0) return [];

  // Compute column widths (max of header/row content + 2 padding)
  const colWidths = headers.map((h, i) => {
    let maxW = h.length;
    for (const row of rows) {
      if (row[i] !== undefined) {
        maxW = Math.max(maxW, row[i]!.length);
      }
    }
    return Math.max(3, maxW + 2);
  });

  const B = theme.tableBorder;
  const R = RESET;

  // Border line helper: builds ┌───┬───┐ / ├───┼───┤ / └───┴───┘
  const borderLine = (left: string, mid: string, right: string): string => {
    const dashes = colWidths.map((w) => '─'.repeat(w));
    return B + left + dashes.join(B + mid + B) + B + right + R;
  };

  // Wrap and pad cell content per alignment — returns array of padded lines.
  const wrapCell = (content: string, col: number): string[] => {
    const w = colWidths[col]! - 2;
    const alignDir = align?.[col] ?? 'left';
    const lines = wrapText(content || ' ', w);
    return lines.map((line) => {
      const padTotal = w - line.length;
      const padded = alignDir === 'right' ? ' '.repeat(padTotal) + line
        : alignDir === 'center' ? (() => {
            const l = Math.floor(padTotal / 2);
            return ' '.repeat(l) + line + ' '.repeat(padTotal - l);
          })()
        : line + ' '.repeat(padTotal);
      return ' ' + padded + ' ';
    });
  };

  const out: StyledRow[] = [];

  // Top border
  out.push({ text: borderLine('┌', '┬', '┐'), isFirst });

  // Header row
  const headerRows = headers.map((h, i) => wrapCell(h, i));
  const headerHeight = Math.max(...headerRows.map((l) => l.length));
  for (let ri = 0; ri < headerHeight; ri++) {
    const cells = headers.map((_, i) => theme.bold(headerRows[i]![ri] ?? ' '.repeat(colWidths[i]!)));
    out.push({ text: B + '│' + cells.join(B + '│' + B) + B + '│' + R, isFirst: ri === 0 });
  }

  // Header/content separator
  out.push({ text: borderLine('├', '┼', '┤'), isFirst: false });

  // Data rows — each logical row expands to max line count across cells.
  for (const row of rows) {
    const cellLines = headers.map((_, i) => wrapCell(row[i] ?? '', i));
    const rowHeight = Math.max(...cellLines.map((l) => l.length));
    for (let ri = 0; ri < rowHeight; ri++) {
      const cells = headers.map((_, i) => cellLines[i]![ri] ?? ' '.repeat(colWidths[i]!));
      out.push({ text: B + '│' + cells.join(B + '│' + B) + B + '│' + R, isFirst: false });
    }
  }

  // Bottom border
  out.push({ text: borderLine('└', '┴', '┘'), isFirst: false });

  return out;
}
