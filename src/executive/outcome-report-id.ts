/**
 * P10.5c — Shared outcome report ID helper.
 *
 * Used by both `OutcomeReportStore` (for filename generation) and the
 * automatic evaluation hook (for idempotency checks). Keeping ID generation
 * in a single module guarantees the idempotency key and the saved filename
 * never drift.
 *
 * @module
 */

/**
 * Sanitize an ISO-8601 timestamp into a filesystem-safe form:
 *   "2026-06-25T12:00:00.000Z" → "20260625T120000000Z"
 */
function sanitizeTimestamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(".", "");
}

/**
 * Build a deterministic report ID from planId and timestamp.
 *   buildOutcomeReportId("plan-abc", "2026-06-25T12:00:00.000Z")
 *     === "outcome-plan-abc-20260625T120000000Z"
 */
export function buildOutcomeReportId(planId: string, generatedAt: string): string {
  return `outcome-${planId}-${sanitizeTimestamp(generatedAt)}`;
}
