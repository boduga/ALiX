// src/tui/blocks/theme.ts
// Default dark Theme. Uses raw ANSI codes (NOT node:util styleText)
// so TerminalCanvas's per-cell ansiPrefix accumulation works correctly.
//
// Palette philosophy: cool backgrounds, warm keywords, neutral identifiers.
// Distinct enough that a glance separates prose, code, and emphasis.
import type { HeadingLevel } from './types.js';
import type { Theme } from './types.js';

const ESC = '\x1b[';
const RESET = `${ESC}0m`;

/** Wrap `text` in `prefix` (open) and `suffix` (close). */
function wrap(prefix: string, suffix: string, text: string): string {
  return `${prefix}${text}${suffix}`;
}

// --- Inline styles ---

const BOLD_OPEN = `${ESC}1m`;
const BOLD_CLOSE = `${ESC}22m`;
const ITALIC_OPEN = `${ESC}3m`;
const ITALIC_CLOSE = `${ESC}23m`;
const INVERSE_OPEN = `${ESC}7m`;
const INVERSE_CLOSE = `${ESC}27m`;
const UNDERLINE_OPEN = `${ESC}4m`;
const UNDERLINE_CLOSE = `${ESC}24m`;

// --- Semantic colors ---

const CYAN = `${ESC}36m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const MAGENTA = `${ESC}35m`;
const BLUE = `${ESC}34m`;
const RED = `${ESC}31m`;
const DIM = `${ESC}2m`;
const DIM_CLOSE = `${ESC}22m`;

// --- Heading rule characters ---

const HEADING_RULES: Record<HeadingLevel, string> = {
  1: '═'.repeat(40),
  2: '─'.repeat(40),
  3: '┄'.repeat(40),
};

/** Default dark theme. Single instance — the interface exists for future variants. */
export const defaultTheme: Theme = {
  heading(level, text) {
    const open = level === 1 ? `${BOLD_OPEN}${CYAN}`
      : level === 2 ? `${BOLD_OPEN}${GREEN}`
      : `${BOLD_OPEN}${YELLOW}`;
    return wrap(open, RESET, text);
  },

  headingRule(level) {
    const open = level === 1 ? `${CYAN}${DIM}`
      : level === 2 ? `${GREEN}${DIM}`
      : `${YELLOW}${DIM}`;
    return wrap(open, DIM_CLOSE, HEADING_RULES[level]);
  },

  bold: (text) => wrap(BOLD_OPEN, BOLD_CLOSE, text),
  italic: (text) => wrap(ITALIC_OPEN, ITALIC_CLOSE, text),
  inlineCode: (text) => wrap(INVERSE_OPEN, INVERSE_CLOSE, text),

  // Raw prefixes — these get stamped onto cells, not wrapped around text.
  codeBorder: `${DIM}90`,
  codeLangLabel(text) {
    return wrap(`${BOLD_OPEN}${CYAN}`, RESET, text);
  },

  // Code token colors.
  codeKeyword: (text) => wrap(`${BOLD_OPEN}${MAGENTA}`, RESET, text),
  codeString: (text) => wrap(`${GREEN}`, RESET, text),
  codeComment: (text) => wrap(`${DIM}`, DIM_CLOSE, text),
  codeNumber: (text) => wrap(`${YELLOW}`, RESET, text),
  codeFunction: (text) => wrap(`${BLUE}`, RESET, text),
  codeOperator: (text) => text, // no styling — operators blend with code
  codePunctuation: (text) => text,
  codePlain: (text) => text,

  quoteBar: `${DIM}90`,
  quote: (text) => wrap(`${DIM}`, DIM_CLOSE, text),
  rule: `${DIM}90`,

  // Phase 1 stub: render as bold + underline. OSC-8 / actual click
  // happens in PR 6.
  link(text, _href) {
    return wrap(`${UNDERLINE_OPEN}${BLUE}`, UNDERLINE_CLOSE, text);
  },
};
