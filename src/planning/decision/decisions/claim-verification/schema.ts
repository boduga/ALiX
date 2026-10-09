/**
 * schema.ts — Claim verification enumerated result schema (J1).
 *
 * The legal output space is code-defined (hand-off §14): Jev may only pick
 * from these verdicts, and an unknown verdict is rejected, never coerced.
 */

export const CLAIM_VERDICTS = ["supported", "contradicted", "insufficient"] as const;

export type ClaimVerdict = (typeof CLAIM_VERDICTS)[number];

/**
 * Candidate list passed to engines/journal. Same values as `CLAIM_VERDICTS`,
 * typed as the readonly candidate shape so call sites need no re-spread.
 */
export const CLAIM_VERDICT_CANDIDATES: readonly ClaimVerdict[] = CLAIM_VERDICTS;

export function isClaimVerdict(value: unknown): value is ClaimVerdict {
  return (CLAIM_VERDICTS as readonly unknown[]).includes(value);
}
