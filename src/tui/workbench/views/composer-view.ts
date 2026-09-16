import { displayWidth, wrapDisplayText } from '../render/terminal-text.js';

export interface ComposerLayout {
  readonly rows: readonly string[];
  readonly cursorRow: number;
  readonly cursorColumn: number;
  readonly hiddenRows: number;
}

/**
 * Wrap a multiline composer into a bounded bottom-anchored viewport.
 * Cursor editing is currently end-only, but the returned coordinates keep
 * rendering independent from that input-policy choice.
 */
export function layoutComposer(text: string, columns: number, maxRows = 5): ComposerLayout {
  const contentWidth = Math.max(1, columns - 4);
  const logicalLines = text.split('\n');
  const wrapped: string[] = [];
  for (const line of logicalLines) {
    wrapped.push(...wrapDisplayText(line, contentWidth));
  }

  const rowLimit = Math.max(1, maxRows);
  const hiddenRows = Math.max(0, wrapped.length - rowLimit);
  const rows = wrapped.slice(hiddenRows);
  const last = rows[rows.length - 1] ?? '';
  return {
    rows,
    cursorRow: Math.max(0, rows.length - 1),
    cursorColumn: displayWidth(last),
    hiddenRows,
  };
}
