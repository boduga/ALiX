/**
 * MockCanvas — testing primitive view-layer helpers operate on
 * TerminalCanvas-like surface. Captures all `write()` calls so tests
 * assert on rendered cells without depending on TerminalCanvas's internal
 * cell grid. Intentionally minimal — only surface used by new
 * helpers (renderBottomAnchoredSlice, renderSlashOverlay, view renderers).
 */

export interface MockCanvasWrite {
  x: number;
  y: number;
  text: string;
}

export class MockCanvas {
  readonly rows: number;
  readonly columns: number;
  readonly writes: MockCanvasWrite[] = [];

  constructor(columns: number, rows: number) {
    this.columns = columns;
    this.rows = rows;
  }

  // Mirror the real TerminalCanvas surface (width/height). `rows`/`columns`
  // remain for the mock's own ergonomics and any older callers.
  get width(): number { return this.columns; }
  get height(): number { return this.rows; }

  write(x: number, y: number, text: string): void {
    this.writes.push({ x, y, text });
  }

  fill(_x: number, _y: number, _w: number, _h: number, _char: string): void {
    // Intentionally unused by renderBottomAnchoredSlice; left in place for
    // future helpers that may need bulk-fill semantics.
  }

  clear(): void {
    this.writes.length = 0;
  }
}
