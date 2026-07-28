// src/tui/blocks/theme.ts
// Default dark Theme. Uses raw ANSI codes (NOT node:util styleText)
// so TerminalCanvas's per-cell ansiPrefix accumulation works correctly.
//
// Palette philosophy: cool backgrounds, warm keywords, neutral identifiers.
// Distinct enough that a glance separates prose, code, and emphasis.
import type { HeadingLevel } from './types.js';
import type { Theme } from './types.js';
import { RESET, BOLD_OPEN, BOLD_CLOSE, DIM_OPEN, DIM_CLOSE, ITALIC_OPEN, ITALIC_CLOSE, INVERSE_OPEN, INVERSE_CLOSE, UNDERLINE_OPEN, UNDERLINE_CLOSE, STRIKE_OPEN, STRIKE_CLOSE, CYAN, GREEN, YELLOW, MAGENTA, BLUE, GRAY, RED } from '../ansi-constants.js';

/** Wrap `text` in `prefix` (open) and `suffix` (close). */
function wrap(prefix: string, suffix: string, text: string): string {
  return `${prefix}${text}${suffix}`;
}

// --- Heading rule characters ---

const HEADING_RULES: Record<HeadingLevel, string> = {
  1: '═'.repeat(40),
  2: '─'.repeat(40),
  3: '┄'.repeat(40),
};

const CALLOT_COLORS: Record<string, string> = {
  NOTE: BLUE,
  TIP: GREEN,
  WARNING: YELLOW,
  CAUTION: RED,
  IMPORTANT: RED,
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
    const open = level === 1 ? `${CYAN}${DIM_OPEN}`
      : level === 2 ? `${GREEN}${DIM_OPEN}`
      : `${YELLOW}${DIM_OPEN}`;
    return wrap(open, DIM_CLOSE, HEADING_RULES[level]);
  },

  bold: (text) => wrap(BOLD_OPEN, BOLD_CLOSE, text),
  italic: (text) => wrap(ITALIC_OPEN, ITALIC_CLOSE, text),
  strikethrough: (text) => wrap(STRIKE_OPEN, STRIKE_CLOSE, text),
  inlineCode: (text) => wrap(INVERSE_OPEN, INVERSE_CLOSE, text),

  // Raw prefixes — these get stamped onto cells, not wrapped around text.
  codeBorder: GRAY,
  codeLangLabel(text) {
    return wrap(`${BOLD_OPEN}${CYAN}`, RESET, text);
  },

  // Code token colors.
  codeKeyword: (text) => wrap(`${BOLD_OPEN}${MAGENTA}`, RESET, text),
  codeString: (text) => wrap(`${GREEN}`, RESET, text),
  codeComment: (text) => wrap(`${DIM_OPEN}`, DIM_CLOSE, text),
  codeNumber: (text) => wrap(`${YELLOW}`, RESET, text),
  codeFunction: (text) => wrap(`${BLUE}`, RESET, text),
  codeOperator: (text) => text, // no styling — operators blend with code
  codePunctuation: (text) => text,
  codePlain: (text) => text,

  calloutLabel(keyword) {
    const color = CALLOT_COLORS[keyword] ?? DIM_OPEN;
    return `${BOLD_OPEN}${color}${keyword}${RESET}`;
  },

  tableBorder: GRAY,
  quoteBar: GRAY,
  quote: (text) => wrap(`${DIM_OPEN}`, DIM_CLOSE, text),
  rule: GRAY,
  taskChecked: `${GREEN}✓${RESET}`,
  taskUnchecked: `${GRAY}[ ]${RESET}`,

  // Phase 1 stub: render as bold + underline. OSC-8 / actual click
  // happens in PR 6.
  link(text, href) {
    const B = '\x1b'; // shorthand for two-byte sequences
    return `${B}]8;;${href}${B}\\${UNDERLINE_OPEN}${BLUE}${text}${UNDERLINE_CLOSE}${B}]8;;${B}\\`;
  },
};

/** Light-background theme — uses black borders, softer keyword colors. */
export const lightTheme: Theme = {
  heading(level, text) {
    const open = level === 1 ? `${BOLD_OPEN}${CYAN}`
      : level === 2 ? `${BOLD_OPEN}${GREEN}`
      : `${BOLD_OPEN}${YELLOW}`;
    return wrap(open, RESET, text);
  },

  headingRule(level) {
    const open = level === 1 ? `${CYAN}${DIM_OPEN}`
      : level === 2 ? `${GREEN}${DIM_OPEN}`
      : `${YELLOW}${DIM_OPEN}`;
    return wrap(open, DIM_CLOSE, HEADING_RULES[level]);
  },

  bold: (text) => wrap(BOLD_OPEN, BOLD_CLOSE, text),
  italic: (text) => wrap(ITALIC_OPEN, ITALIC_CLOSE, text),
  strikethrough: (text) => wrap(STRIKE_OPEN, STRIKE_CLOSE, text),
  inlineCode: (text) => wrap(INVERSE_OPEN, INVERSE_CLOSE, text),

  // Raw prefixes — black on light backgrounds for legibility.
  codeBorder: `\x1b[30m`,
  codeLangLabel(text) {
    return wrap(`${BOLD_OPEN}${CYAN}`, RESET, text);
  },

  codeKeyword: (text) => wrap(`${BOLD_OPEN}`, RESET, text),
  codeString: (text) => wrap(`${GREEN}`, RESET, text),
  codeComment: (text) => wrap(`${DIM_OPEN}${GRAY}`, RESET, text),
  codeNumber: (text) => wrap(`${YELLOW}`, RESET, text),
  codeFunction: (text) => wrap(`${BLUE}`, RESET, text),
  codeOperator: (text) => text,
  codePunctuation: (text) => text,
  codePlain: (text) => text,

  calloutLabel(keyword) {
    const color = CALLOT_COLORS[keyword] ?? DIM_OPEN;
    return `${BOLD_OPEN}${color}${keyword}${RESET}`;
  },

  tableBorder: `\x1b[30m`,
  quoteBar: `\x1b[30m`,
  quote: (text) => wrap(`${DIM_OPEN}`, DIM_CLOSE, text),
  rule: `\x1b[30m`,
  taskChecked: `${GREEN}✓${RESET}`,
  taskUnchecked: `\x1b[30m[ ]${RESET}`,

  link(text, href) {
    const B = '\x1b';
    return `${B}]8;;${href}${B}\\${UNDERLINE_OPEN}${BLUE}${text}${UNDERLINE_CLOSE}${B}]8;;${B}\\`;
  },
};

/** Theme registry keyed by name. */
export const themes: Record<string, Theme> = { dark: defaultTheme };

themes.light = lightTheme;

/**
 * Resolve a theme by name or auto-detect from environment.
 * 1. If a known name is given, return that theme.
 * 2. If COLORFGBG is set and its last segment >= 8 (light bg), prefer light.
 * 3. Fallback to defaultTheme (dark).
 */
export function getTheme(name?: string): Theme {
  if (name && themes[name]) return themes[name];
  const bg = process.env.COLORFGBG;
  if (bg) {
    const last = bg.split(';').pop();
    if (last && parseInt(last, 10) >= 8 && themes.light) return themes.light;
  }
  return defaultTheme;
}
