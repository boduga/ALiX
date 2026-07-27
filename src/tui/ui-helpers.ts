// src/tui/ui-helpers.ts
// Convenience helpers for rendering ALiX's own UI messages through the
// rich response pipeline so they get the same formatting as markdown
// content (callouts, lists, inline styles, etc.).

import type { StyledRow } from './blocks/types.js';
import { renderResponse } from './blocks/render.js';

/** Recognised callout keywords. */
export type CalloutKeyword = 'NOTE' | 'TIP' | 'WARNING' | 'CAUTION' | 'IMPORTANT';

/**
 * Render a single-line callout/admonition as a quote block with a colored
 * label header. The `body` text is placed after the `[!KEYWORD]` marker on
 * the same line so it renders as a compact heading + body combo.
 *
 * Returns `StyledRow[]` ready to append to a scrollback or dashboard.
 */
export function callout(keyword: CalloutKeyword, body: string, width: number): StyledRow[] {
  return renderResponse(`> [!${keyword}] ${body}`, width);
}
