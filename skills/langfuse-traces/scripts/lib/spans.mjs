/**
 * spans.mjs — shared run-root naming over Langfuse v2 observation SPAN rows.
 *
 * v2 rows carry no traceName, so the run ROOT span lends its name. The
 * enclosing span (earliest start + latest end) outranks longest duration:
 * a parallel child can outlast the root on duration alone but never
 * enclose it. Still a heuristic — callers label it, never trust it blind.
 * Single home for the heuristic: query.mjs, corpus.mjs, and mine.mjs all
 * use this (one "root" meaning everywhere).
 */

/**
 * @param {Array<{name?: unknown, startTime?: unknown, endTime?: unknown}>} spans
 * @returns {string|undefined} the enclosing root span name, if any.
 */
export function pickRootName(spans) {
  const timed = (spans ?? [])
    .map((s) => ({
      name: s.name,
      start: Date.parse(s.startTime),
      end: Date.parse(s.endTime),
    }))
    .filter((s) => typeof s.name === "string" && Number.isFinite(s.start) && Number.isFinite(s.end));
  if (timed.length === 0) return undefined;
  const minStart = Math.min(...timed.map((s) => s.start));
  const maxEnd = Math.max(...timed.map((s) => s.end));
  const enclosing = timed.filter((s) => s.start === minStart && s.end === maxEnd);
  const pool = enclosing.length > 0 ? enclosing : timed;
  let best;
  let bestDur = -1;
  for (const s of pool) {
    if (s.end - s.start > bestDur) { bestDur = s.end - s.start; best = s.name; }
  }
  return best;
}
