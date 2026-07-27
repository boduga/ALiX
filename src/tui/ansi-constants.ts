// src/tui/ansi-constants.ts
// Single source of truth for ANSI escape code constants used across
// the TUI subsystem. Three categories:
//   1. Style codes (open/close pairs for bold, italic, inverse, dim, underline)
//   2. Color codes (foreground colors as raw SGR strings)
//   3. Utilities (RESET, regex for matching ANSI sequences)

const ESC = '\x1b[';

// ── Reset ──
export const RESET = `${ESC}0m`;

// ── Style open/close ──
export const BOLD_OPEN = `${ESC}1m`;
export const BOLD_CLOSE = `${ESC}22m`;  // SGR 22 = normal intensity (cancels bold AND dim)
export const DIM_OPEN = `${ESC}2m`;
export const DIM_CLOSE = `${ESC}22m`;  // same code, different intent
export const ITALIC_OPEN = `${ESC}3m`;
export const ITALIC_CLOSE = `${ESC}23m`;
export const INVERSE_OPEN = `${ESC}7m`;
export const INVERSE_CLOSE = `${ESC}27m`;
export const UNDERLINE_OPEN = `${ESC}4m`;
export const UNDERLINE_CLOSE = `${ESC}24m`;

// ── Foreground colors ──
export const GRAY = `${ESC}90m`;
export const RED = `${ESC}31m`;
export const GREEN = `${ESC}32m`;
export const YELLOW = `${ESC}33m`;
export const BLUE = `${ESC}34m`;
export const MAGENTA = `${ESC}35m`;
export const CYAN = `${ESC}36m`;

// ── ANSI regex (shared source of truth) ──
export const ANSI_REGEX = /[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=&|<>]/g;
