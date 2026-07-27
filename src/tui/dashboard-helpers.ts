/**
 * dashboard-helpers.ts — Shared formatting helpers for dashboard renderers.
 *
 * Consolidates duplicated pad/truncate/bar/pct/icon helpers from multiple
 * dashboard renderers into a single importable module.
 *
 * @module
 */

/**
 * Truncate a string to at most `n` characters, appending "…" when cut.
 */
export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
