// src/tui/blocks/render.ts
// Walks a sequence of ResponseBlock and produces ANSI-styled rows ready
// to write to a TerminalCanvas. Pure: same input + theme + width → same
// output. Side-effect free. No knowledge of ANSI codes other than
// what's already in the Theme.
//
// Code blocks are handled minimally here (placeholder). Task 6 wires
// up the full bordered-chrome rendering with tokenization.

import type { ResponseBlock, InlineSpan, StyledRow, Theme } from './types.js';
import { parseInline } from './inline.js';
import { wrapText } from '../views/wrap-text.js';

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
        // Code rendering with chrome lands in Task 6. Placeholder for
        // now: a single line "[code]" so callers don't crash.
        out.push({ text: theme.codePlain('[code]'), isFirst });
        break;
    }
  }

  return out;
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
  // Wrap, then prefix each line with the quote bar.
  const lines = wrapText(styledSpans, Math.max(1, width - 2));
  const bar = theme.quoteBar + '│ ' + '\x1b[0m'; // bar + reset so styled text doesn't bleed
  return lines.map((text, i) => ({
    text: bar + text,
    isFirst: isFirst && i === 0,
  }));
}

function renderRule(theme: Theme, width: number, isFirst: boolean): StyledRow[] {
  const ch = '─';
  const raw = ch.repeat(Math.max(1, width));
  return [{ text: theme.rule + raw + '\x1b[0m', isFirst }];
}

function renderList(
  block: Extract<ResponseBlock, { type: 'list' }>,
  theme: Theme,
  width: number,
  isFirst: boolean,
): StyledRow[] {
  const rows: StyledRow[] = [];
  block.items.forEach((item, idx) => {
    const prefix = block.marker === 'ordered' ? `${idx + 1}. ` : '• ';
    const indent = ' '.repeat(prefix.length);
    const innerWidth = Math.max(1, width - prefix.length);
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
  }
}
