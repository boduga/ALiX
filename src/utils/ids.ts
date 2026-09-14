/**
 * ids.ts — Shared identifier-building helpers (#715).
 *
 * Canonical home of `sanitizeTimestamp`, previously copied into four
 * modules (forecasting, planning, learning, executive) with one divergent
 * variant. All generated IDs use a single timestamp format.
 */

/**
 * Strip every non-alphanumeric character from an ISO-8601 timestamp so the
 * result is safe for IDs, filenames, and store keys:
 *   "2026-06-25T12:00:00.000Z" → "20260625T120000000Z"
 *
 * Strict by design: unlike the retired executive variant (which only
 * removed `-`, `:`, and the first `.`), this also strips `+` timezone
 * offsets and whitespace, so non-UTC inputs cannot leak separators
 * into identifiers.
 */
export function sanitizeTimestamp(iso: string): string {
  return iso.replace(/[^a-zA-Z0-9]/g, "");
}
