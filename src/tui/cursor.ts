import { clearLine } from "./ansi.js";

export interface Position {
  x: number;
  y: number;
}

export interface TerminalSize {
  columns: number;
  rows: number;
}

/**
 * Get current cursor position using ANSI DSR
 */
export async function getCursorPosition(): Promise<Position> {
  // Query cursor position: ESC[6n
  process.stdout.write("\x1b[6n");

  return new Promise((resolve) => {
    let result = "";
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      process.stdin.removeListener("data", handler);
    };
    const finish = (pos: Position) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(pos);
    };
    const handler = (chunk: Buffer | string) => {
      result += typeof chunk === "string" ? chunk : chunk.toString();
      // Look for CSI response: ESC[<r>;<c>R
      const match = result.match(/\x1b\[(\d+);(\d+)R/);
      if (match) {
        finish({ x: parseInt(match[2]), y: parseInt(match[1]) });
      }
    };

    // Ensure stdin is flowing so the CSI response actually arrives.
    try { process.stdin.resume(); } catch { /* already flowing */ }
    process.stdin.on("data", handler);

    // 250ms timeout — long enough for a local terminal, short enough not
    // to feel like a hang if the response is lost.
    timer = setTimeout(() => finish({ x: 0, y: 0 }), 250);
  });
}

/**
 * Get terminal size
 */
export async function getTerminalSize(): Promise<TerminalSize> {
  try {
    // process.stdout.columns/rows are available in Node.js with TTY
    const size = (process.stdout as import("tty").WriteStream & { columns?: number; rows?: number });
    return { columns: size.columns ?? 80, rows: size.rows ?? 24 };
  } catch {
    // Fallback
    return { columns: 80, rows: 24 };
  }
}

/**
 * Check if cursor is at the start of a line
 */
export async function isAtLineStart(): Promise<boolean> {
  const pos = await getCursorPosition();
  return pos.x === 1;
}

/**
 * Create a line that clears existing content
 */
export function createClearedLine(content: string, width: number): string {
  const padding = Math.max(0, width - content.length);
  return `${clearLine()}${content}${" ".repeat(padding)}`;
}

/**
 * Move cursor and overwrite line
 */
export function overwriteLine(line: string): void {
  process.stdout.write(`${clearLine()}${line}\r`);
}

/**
 * Save current cursor position
 */
export function save(): void {
  process.stdout.write("\x1b[s");
}

/**
 * Restore saved cursor position
 */
export function restore(): void {
  process.stdout.write("\x1b[u");
}

/**
 * Move cursor to specific position
 */
export function moveTo(x: number, y: number): void {
  process.stdout.write(`\x1b[${y};${x}H`);
}

/**
 * Scroll content into view (move cursor to bottom of visible area)
 */
export function scrollIntoView(): void {
  // Move cursor down to ensure content is visible
  process.stdout.write("\x1b[S");
}
