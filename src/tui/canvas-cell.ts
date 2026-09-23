/**
 * CanvasCell — one terminal cell in the virtual frame buffer.
 *
 * Each cell carries one complete grapheme (or a zero-width continuation for
 * a wide grapheme) plus any ANSI style prefix that applies to it. The render
 * pass collapses adjacent cells with the same style into compact sequences.
 */

export interface CanvasCell {
  /** A complete visual grapheme (e.g. 'A', '調', '👩‍💻') or ''. */
  readonly char: string;
  /** ANSI escape sequence(s) to apply before this character. */
  readonly ansiPrefix: string;
  /** Terminal columns occupied by the grapheme; continuation cells use zero. */
  readonly span: number;
  readonly continuation: boolean;
}

import { ANSI_REGEX } from './ansi-constants.js';
export { ANSI_REGEX };

export function createCell(char = ' ', ansiPrefix = '', span = 1, continuation = false): CanvasCell {
  return { char, ansiPrefix, span, continuation };
}
