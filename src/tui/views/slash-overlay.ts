import { RESET } from '../ansi-constants.js';
import type { TerminalCanvas } from '../canvas.js';
import type { SlashStrip } from './types.js';

export interface RenderSlashOverlayOpts {
  canvas: TerminalCanvas;
  slash: SlashStrip;
  panelRow: number;
  columns: number;
  maxRows?: number;
}

export interface RenderSlashOverlayResult {
  rowsRendered: number;
  lastRow: number;
  selectionVisible: boolean;
}

/**
 * Render the slash-completion strip directly BELOW the input panel row.
 * The strip rows grow downward; if they would overlap the footer, they are
 * clamped to the available rows.
 *
 * Pure: no state, no I/O, no mutation of inputs.
 */
export function renderSlashOverlay(opts: RenderSlashOverlayOpts): RenderSlashOverlayResult {
  const { canvas, slash, panelRow, columns, maxRows = 6 } = opts;
  const canvasRows = (canvas as unknown as { rows: number }).rows;

  // Hint mode: 1 row, no selection.
  if (slash && slash.hint !== null && slash.entries.length === 0) {
    const row = panelRow + 1;
    if (row >= canvasRows) return { rowsRendered: 0, lastRow: panelRow, selectionVisible: false };
    canvas.write(0, row, ` \x1b[33m${slash.hint}${RESET}`);
    return { rowsRendered: 1, lastRow: row, selectionVisible: false };
  }

  if (!slash || slash.entries.length === 0) {
    return { rowsRendered: 0, lastRow: panelRow, selectionVisible: true };
  }

  // Entry mode: window entries around the selected index so selection stays visible.
  const entryCount = slash.entries.length;
  const requestedRows = Math.min(entryCount, maxRows);
  const availableRows = Math.max(0, canvasRows - (panelRow + 1));
  const rowsToRender = Math.min(requestedRows, availableRows);
  if (rowsToRender === 0) {
    return { rowsRendered: 0, lastRow: panelRow, selectionVisible: false };
  }

  const half = Math.floor(rowsToRender / 2);
  const start = Math.max(0, Math.min(slash.selected - half, entryCount - rowsToRender));
  const end = start + rowsToRender;
  const selectionVisible = slash.selected >= start && slash.selected < end;

  for (let i = 0; i < rowsToRender; i++) {
    const entry = slash.entries[start + i]!;
    const isSelected = start + i === slash.selected;
    const marker = isSelected ? '>' : ' ';
    const row = panelRow + 1 + i;
    canvas.write(0, row, ` ${marker} \x1b[36m${entry.label}${RESET} ${entry.description}`);
  }
  return { rowsRendered: rowsToRender, lastRow: panelRow + rowsToRender, selectionVisible };
}