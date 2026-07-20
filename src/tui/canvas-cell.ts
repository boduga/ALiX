/**
 * CanvasCell — one terminal cell in the virtual frame buffer.
 *
 * Each cell carries exactly one visible character plus any ANSI style
 * prefix that should be applied before it. The render pass collapses
 * adjacent cells with the same style into compact escape sequences.
 */

export interface CanvasCell {
  /** The single visual character (e.g. 'A', '█', ' '). */
  readonly char: string;
  /** ANSI escape sequence(s) to apply before this character. */
  readonly ansiPrefix: string;
}

/**
 * Regex matching standard ANSI escape sequences.
 *
 * Character class matches both ESC (\x1b / ) and CSI (\x9b).
 * Written with explicit hex escapes for portability across editors / encodings.
 */
export const ANSI_REGEX = /[][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

export function createCell(char = ' ', ansiPrefix = ''): CanvasCell {
  return { char, ansiPrefix };
}
