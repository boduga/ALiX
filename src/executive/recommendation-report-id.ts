/**
 * P10.7b — Recommendation Report ID.
 *
 * Deterministic, filename-safe id derived from generatedAt. Mirrors the
 * pattern of buildOutcomeReportId.
 */

/**
 * Replace characters unsafe in filenames (Windows-forbidden `:`, the
 * Unix-special `.`) with safe substitutes. The result is not reversible for
 * our purposes (we never round-trip the id back to an ISO string; the
 * id is just a stable filename key).
 */
function isoToSafe(iso: string): string {
  return iso.replace(/:/g, "-").replace(/\./g, "");
}

export function buildRecommendationReportId(generatedAt: string): string {
  return `recommendation-${isoToSafe(generatedAt)}`;
}