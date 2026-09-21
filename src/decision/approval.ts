/**
 * approval.ts — Deterministic approval floor composition (JEV-8).
 *
 * Probabilistic decisions compose monotonically with deterministic
 * governance: they may escalate approval, never waive it. The policy layer
 * (PolicyGate) stays authoritative; this module is the single shape for
 * combining its verdict with a calibrated risk signal.
 */

/** True when a probabilistic risk meets/exceeds its calibrated threshold. */
export function exceedsRiskThreshold(
  risk: number | undefined,
  threshold: number,
): boolean {
  if (risk === undefined || !Number.isFinite(risk)) return false;
  return risk >= threshold;
}

/**
 * needsApproval = policy.requiresApproval(action) OR riskExceedsThreshold.
 * A low risk score never cancels a policy-required approval (fail-closed).
 */
export function composeApproval(
  requiredByPolicy: boolean,
  riskExceedsThreshold: boolean,
): boolean {
  return requiredByPolicy || riskExceedsThreshold;
}
