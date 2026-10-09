/**
 * box.ts — Terminal card/box rendering helpers for the TUI dashboard.
 */

/** ANSI color helpers */
export const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
export const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
export const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
export const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
export const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

/** Strip ANSI escape codes for width calculation. */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Visible width of a string (excluding ANSI codes). */
export function visibleLen(s: string): number {
  return stripAnsi(s).length;
}

export function truncate(s: string, w: number): string {
  if (visibleLen(s) <= w) return s;
  let count = 0;
  let result = "";
  let i = 0;
  while (i < s.length && count < w - 1) {
    if (s[i] === "\x1b") {
      const match = s.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (match) { result += match[0]; i += match[0].length; continue; }
    }
    result += s[i];
    count++;
    i++;
  }
  if (i < s.length) result += "…";
  return result;
}

export function pad(s: string, w: number): string {
  const v = visibleLen(s);
  if (v >= w) return s.slice(0, w);
  return s + " ".repeat(w - v);
}

export function bar(pct: number, w: number): string {
  if (w < 4) return "";
  const filled = Math.round((pct / 100) * (w - 2));
  const empty = (w - 2) - filled;
  const color = pct > 80 ? red : pct > 50 ? yellow : green;
  return color("█".repeat(Math.max(0, filled))) + dim("░".repeat(Math.max(0, empty)));
}

export function formatAge(ts: string | undefined): string {
  if (!ts) return "-";
  const age = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (age < 60) return `${age}s`;
  if (age < 3600) return `${Math.floor(age / 60)}m`;
  return `${Math.floor(age / 3600)}h`;
}

export function statusDot(status: string): string {
  if (status === "running" || status === "ready" || status === "done" || status === "completed") return green("●");
  if (status === "queued" || status === "pending") return yellow("○");
  if (status === "failed" || status === "failed_orphaned") return red("●");
  return dim("○");
}

/**
 * Render a bordered card with a title and content lines.
 * Returns an array of lines ready for the renderer.
 */
export function box(title: string, lines: string[], width: number, _height?: number): string[] {
  const inner = Math.max(width - 4, 4);
  const result: string[] = [];
  const top = `┌ ${truncate(bold(title), inner - 2)} ${"─".repeat(Math.max(0, inner - title.length - 3))}┐`;
  result.push(top);
  for (const line of lines) {
    const innerLine = truncate(line, inner);
    result.push(`│ ${pad(innerLine, inner)} │`);
  }
  result.push(`└${"─".repeat(inner + 2)}┘`);
  return result;
}
