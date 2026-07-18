/**
 * TerminalCanvas — immediate-mode virtual frame buffer for terminal dashboards.
 *
 * Instead of building string[] rows that cascade into the scrollback buffer,
 * views write into a 2-D grid of CanvasCell at absolute (x, y) coordinates.
 * The entire frame is serialised to stdout in one sweep per tick, giving
 * deterministic layout and no waterfall drift.
 *
 * ANSI-awareness: the `write()` method parses escape sequences and stores
 * them as cell-level style prefixes without consuming column space.
 * `renderFrame()` collapses adjacent same-style cells to minimise output.
 */

import { createCell, type CanvasCell, ANSI_REGEX } from "./canvas-cell.js";

export function writeRowsToCanvas(
  c: TerminalCanvas,
  rows: string[],
  startX = 0,
  startY = 0,
): void {
  for (let i = 0; i < rows.length; i++) {
    c.write(startX, startY + i, rows[i] ?? '');
  }
}

export class TerminalCanvas {
  readonly width: number;
  readonly height: number;
  private buffer: CanvasCell[][] = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.clear();
  }

  /* ─── Buffer lifecycle ─────────────────────────────────────────── */

  /** Fill every cell with a space and empty style. */
  clear(): void {
    this.buffer = Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => createCell()),
    );
  }

  /* ─── Text output ──────────────────────────────────────────────── */

  /**
   * Write `text` into the buffer starting at (startX, y).
   * ANSI escape sequences inside `text` do NOT occupy grid columns;
   * they are accumulated as the "active style" and stamped on every
   * subsequent visible character until a reset code (`\x1b[0m` / `\x1b[39m`)
   * clears the accumulator.
   */
  write(startX: number, y: number, text: string): void {
    if (y < 0 || y >= this.height) return;

    let currentX = startX;
    let activeAnsi = "";
    let i = 0;

    while (i < text.length) {
      if (currentX >= this.width) break;

      // ANSI escape sequence hit — parse, store as style, no column advance.
      if (text[i] === "\x1b" || text[i] === "") {
        const remaining = text.slice(i);
        const match = remaining.match(ANSI_REGEX);
        if (match) {
          const seq = match[0];
          if (seq === "\x1b[0m" || seq === "\x1b[39m") {
            activeAnsi = "";
          } else {
            activeAnsi += seq;
          }
          i += seq.length;
          continue;
        }
      }

      // Regular visible character.
      this.buffer[y][currentX] = createCell(text[i]!, activeAnsi);
      currentX++;
      i++;
    }
  }

  /* ─── Box drawing ──────────────────────────────────────────────── */

  /**
   * Draw a rectangular border box with optional title at (x, y) spanning
   * (w × h) cells.  `colorCode` is applied to the border characters and
   * defaults to bright black (dim).  The title is written in green.
   */
  drawBox(
    x: number,
    y: number,
    w: number,
    h: number,
    title?: string,
    colorCode = "\x1b[90m",
  ): void {
    if (w < 2 || h < 2) return;
    const reset = "\x1b[0m";

    // Top / bottom edges.
    for (let i = 1; i < w - 1; i++) {
      this.write(x + i, y, `${colorCode}─${reset}`);
      this.write(x + i, y + h - 1, `${colorCode}─${reset}`);
    }

    // Left / right edges.
    for (let j = 1; j < h - 1; j++) {
      this.write(x, y + j, `${colorCode}│${reset}`);
      this.write(x + w - 1, y + j, `${colorCode}│${reset}`);
    }

    // Corners.
    this.write(x, y, `${colorCode}┌${reset}`);
    this.write(x + w - 1, y, `${colorCode}┐${reset}`);
    this.write(x, y + h - 1, `${colorCode}└${reset}`);
    this.write(x + w - 1, y + h - 1, `${colorCode}┘${reset}`);

    // Title — injected over the top border at x+2.
    if (title) {
      this.write(x + 2, y, `\x1b[32m ${title} \x1b[0m`);
    }
  }

  /* ─── Progress bar ─────────────────────────────────────────────── */

  /**
   * Render a horizontal progress bar at (x, y) of width `barWidth`.
   * `fraction` is clamped to [0, 1].
   */
  drawBar(x: number, y: number, barWidth: number, fraction: number, color = "\x1b[36m"): void {
    const pct = Math.max(0, Math.min(1, fraction));
    const filled = Math.round(pct * barWidth);
    const reset = "\x1b[0m";

    this.write(x, y, `[${color}`);
    for (let i = 0; i < barWidth; i++) {
      this.write(x + 1 + i, y, i < filled ? "█" : "░");
    }
    this.write(x + 1 + barWidth, y, `${reset}] ${String(Math.round(pct * 100))}%`);
  }

  /* ─── Frame serialisation ──────────────────────────────────────── */

  /**
   * Collapse the 2-D cell grid into a single printable string.
   * Adjacent cells sharing the same `ansiPrefix` write the prefix once.
   * A reset is emitted at the end of every row to prevent style bleed.
   */
  renderFrame(): string {
    let output = "";

    for (let y = 0; y < this.height; y++) {
      let row = "";
      let currentStyle = "";

      for (let x = 0; x < this.width; x++) {
        const cell = this.buffer[y][x]!;

        if (cell.ansiPrefix !== currentStyle) {
          if (cell.ansiPrefix === "") {
            row += "\x1b[0m";
          } else {
            row += cell.ansiPrefix;
          }
          currentStyle = cell.ansiPrefix;
        }

        row += cell.char;
      }

      if (currentStyle !== "") row += "\x1b[0m";
      output += row + "\n";
    }

    return output;
  }
}
