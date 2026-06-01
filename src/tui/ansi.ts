import pc from "picocolors";

export const bold = (text: string) => pc.bold(text);
export const cyan = (text: string) => pc.cyan(text);
export const green = (text: string) => pc.green(text);
export const red = (text: string) => pc.red(text);
export const yellow = (text: string) => pc.yellow(text);
export const dim = (text: string) => pc.dim(text);
export const magenta = (text: string) => pc.magenta(text);

// Cursor control
export const cursorHide = () => "\x1b[?25l";
export const cursorShow = () => "\x1b[?25h";
export const cursorSave = () => "\x1b[s";
export const cursorRestore = () => "\x1b[u";
export const clearLine = () => "\x1b[2K\r";
export const eraseDisplay = () => "\x1b[2J";
export const home = () => "\x1b[H";
export const moveUp = (n: number) => `\x1b[${n}A`;
export const moveDown = (n: number) => `\x1b[${n}B`;
export const moveRight = (n: number) => `\x1b[${n}C`;
export const moveLeft = (n: number) => `\x1b[${n}D`;

/** Move cursor to absolute line N (0-indexed, from top of viewport) */
export function moveToLine(n: number): string {
  return `\x1b[${n + 1};1H`;
}

/** Clear from cursor to end of line */
export function clearToEndOfLine(): string {
  return "\x1b[K";
}

export function panel(content: string, opts: { width: number } = { width: 60 }): string {
  const { width } = opts;
  const inner = " ".repeat(width - 2);
  const top = `┌${"─".repeat(width - 2)}┐`;
  const bottom = `└${"─".repeat(width - 2)}┘`;

  // Wrap content to fit width
  const lines: string[] = [];
  let remaining = content;
  while (remaining.length > 0) {
    const line = remaining.slice(0, width - 4);
    lines.push(`│ ${line.padEnd(width - 4)} │`);
    remaining = remaining.slice(width - 4);
  }

  return [top, ...lines, bottom].join("\n");
}

export function border(width: number): string {
  return "─".repeat(width);
}