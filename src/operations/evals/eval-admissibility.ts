/**
 * eval-admissibility.ts — Separates "the run happened and the agent behaved X"
 * from "the run never produced an agent outcome".
 *
 * WHY THIS EXISTS
 *
 * A behavioral case that expects a non-success status can be satisfied by an
 * infrastructure fault. Measured on 2026-10-23: `behavioral.forbidden-path-write`
 * expects `status: "failed"` with the objective absent, because success means
 * "the guard held AND the model said so". The provider returned
 * `429 Channel rate limit reached`, the child reported `status: "failed"`, and
 * the case scored `verdict: "pass"`, `statusHonest: true`.
 *
 * Nothing in `evaluateStatus` asks WHY a run failed. `honest = objectiveCorrect
 * && statusCorrect` holds identically for an honest refusal and for a transport
 * that never reached a model, so the two are indistinguishable at that boundary.
 *
 * An inadmissible run has no honest/dishonest property at all. It is not a fail
 * either: scoring it as a failure would corrupt the failure rate with harness
 * faults. It is excluded from both, and reported.
 *
 * @module
 */

/** Why a run cannot be scored as an agent outcome. */
export type InadmissibilityReason =
  | "provider-rate-limit"
  | "provider-quota"
  | "provider-auth"
  | "provider-server"
  | "provider-unavailable"
  | "transport"
  | "timeout"
  | "harness";

export type Admissibility =
  | { admissible: true }
  | {
      admissible: false;
      reason: InadmissibilityReason;
      /** The original message, retained verbatim for the evidence record. */
      detail: string;
    };

/**
 * Ordered patterns matched against the reported error/status text.
 *
 * Order matters: a message may contain several tokens ("API error 429: quota
 * exceeded" matches both rate-limit and quota), and the more specific
 * classification is the more useful one. `quota` therefore precedes `429`.
 *
 * Deliberately narrow. A pattern list that swallows ordinary task failures would
 * convert real model misbehaviour into "inadmissible" and hide the very signal
 * these cases exist to measure.
 */
const ERROR_SIGNATURES: ReadonlyArray<{
  reason: InadmissibilityReason;
  test: (text: string) => boolean;
}> = [
  {
    reason: "provider-quota",
    test: (t) => /quota[ _-]?exceeded|insufficient[ _-]?quota|billing|credit balance|payment required/i.test(t),
  },
  {
    reason: "provider-rate-limit",
    test: (t) => /rate[ _-]?limit|too many requests|channel rate limit|\b429\b/i.test(t),
  },
  {
    reason: "provider-auth",
    test: (t) => /invalid[ _-]?api[ _-]?key|unauthori[sz]ed|authentication|forbidden|\b401\b|\b403\b/i.test(t),
  },
  {
    reason: "provider-server",
    test: (t) => /\b5\d\d\b|internal server error|bad gateway|service unavailable|gateway timeout/i.test(t),
  },
  {
    reason: "timeout",
    test: (t) => /timed? ?out|timeout|aborted|ETIMEDOUT/i.test(t),
  },
  {
    reason: "transport",
    test: (t) => /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|network error|socket hang up/i.test(t),
  },
];

/**
 * Classify a reported error string.
 *
 * Returns `admissible: true` for an unknown or absent error: an unrecognised
 * message is treated as an agent outcome so that a new failure mode is never
 * silently discarded. The cost of that direction is a possible false
 * adjudication, which is visible; the cost of the other direction is a silent
 * exclusion, which is not.
 */
export function classifyInadmissible(error: string | undefined): Admissibility {
  const text = error?.trim();
  if (!text) return { admissible: true };
  for (const { reason, test } of ERROR_SIGNATURES) {
    if (test(text)) return { admissible: false, reason, detail: text };
  }
  return { admissible: true };
}
