import { resolveWorkbenchSurfaceGeometry } from '../layout/responsive-layout.js';
import type { WorkbenchDrawer } from '../model/ui-state.js';
import { displayWidth, wrapDisplayText } from '../render/terminal-text.js';

export interface ComposerLayout {
  readonly rows: readonly string[];
  readonly cursorRow: number;
  readonly cursorColumn: number;
  readonly hiddenRows: number;
}

/**
 * Wrap a multiline composer into a bounded bottom-anchored viewport.
 * The visible window follows the grapheme-boundary cursor while remaining
 * bottom-anchored when the cursor is at the end.
 */
export function layoutComposer(text: string, columns: number, maxRows = 5, cursor = text.length): ComposerLayout {
  const contentWidth = Math.max(1, columns - 4);
  const logicalLines = text.split('\n');
  const wrapped: string[] = [];
  for (const line of logicalLines) {
    wrapped.push(...wrapDisplayText(line, contentWidth));
  }

  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const cursorLines = text.slice(0, safeCursor).split('\n');
  const cursorWrapped = cursorLines.flatMap((line) => wrapDisplayText(line, contentWidth));
  const absoluteCursorRow = Math.max(0, cursorWrapped.length - 1);
  const cursorColumn = displayWidth(cursorWrapped[absoluteCursorRow] ?? '');
  const rowLimit = Math.max(1, maxRows);
  const maxHiddenRows = Math.max(0, wrapped.length - rowLimit);
  const hiddenRows = Math.min(maxHiddenRows, Math.max(0, absoluteCursorRow - rowLimit + 1));
  const rows = wrapped.slice(hiddenRows, hiddenRows + rowLimit);
  return {
    rows,
    cursorRow: absoluteCursorRow - hiddenRows,
    cursorColumn,
    hiddenRows,
  };
}

/** Shared full-width composer and pane geometry for painting, scrolling and caret placement. */
export function layoutWorkbenchSurface(
  text: string,
  dimensions: { readonly columns: number; readonly rows: number },
  drawer: WorkbenchDrawer,
  cursor = text.length,
) {
  const initial = resolveWorkbenchSurfaceGeometry(dimensions.columns, dimensions.rows, drawer);
  const composer = layoutComposer(text, initial.regions.composer.width, initial.maxComposerRows, cursor);
  const geometry = resolveWorkbenchSurfaceGeometry(dimensions.columns, dimensions.rows, drawer, composer.rows.length);
  return { composer, geometry };
}
