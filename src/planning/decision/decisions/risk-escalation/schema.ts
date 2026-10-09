/**
 * schema.ts — Risk-escalation enumerated result schema (J6).
 *
 * The legal output space is code-defined (hand-off §14): three risk tiers,
 * ordered. Anything else is rejected, never coerced.
 */

export const RISK_TIERS = ["low", "medium", "high"] as const;

export type RiskTier = (typeof RISK_TIERS)[number];

export function isRiskTier(value: unknown): value is RiskTier {
  return (RISK_TIERS as readonly unknown[]).includes(value);
}

/** Frozen candidate list so call sites share one order. */
export const RISK_TIER_CANDIDATES: readonly RiskTier[] = RISK_TIERS;
