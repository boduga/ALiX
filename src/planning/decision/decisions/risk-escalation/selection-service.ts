/**
 * selection-service.ts — Risk-tier selection behind a feature flag (J6).
 *
 * Modes:
 *  - "off"    — do not judge; return no tier. Existing behavior unchanged.
 *  - "shadow" — observe + journal, return no tier.
 *  - "active" — return the observed tier AND the composed recommendation for
 *               the caller to enforce through PolicyGate (never here).
 *
 * "off" is the default, so wiring this call site changes nothing until
 * `riskEscalation.enabled` is flipped. No execution authority in any mode.
 */

import type { RiskTier } from "./schema.js";
import type { RiskEscalationActionInput } from "./projection.js";
import type {
  RiskEscalationShadowDeps,
  RiskEscalationShadowResult,
} from "./shadow.js";
import { runRiskEscalationShadow } from "./shadow.js";

export type RiskSelectionMode = "off" | "shadow" | "active";

export type RiskSelection = {
  mode: RiskSelectionMode;
  /** Present only in "active" mode and only when a tier was produced. */
  tier?: RiskTier;
  /** Advisory only. Enforce through PolicyGate, never here. */
  recommendApproval?: boolean;
  shadow?: RiskEscalationShadowResult;
};

export async function selectRiskTier(
  action: RiskEscalationActionInput,
  deps: RiskEscalationShadowDeps & {
    mode?: RiskSelectionMode;
    policyRequires?: boolean;
  },
): Promise<RiskSelection> {
  const mode = deps.mode ?? "off";
  if (mode === "off") {
    return { mode };
  }

  const shadow = await runRiskEscalationShadow(
    { action, ...(deps.policyRequires !== undefined ? { policyRequires: deps.policyRequires } : {}) },
    deps,
  );
  if (mode === "shadow") {
    return { mode, shadow };
  }

  return {
    mode,
    ...(shadow.observed?.tier !== undefined ? { tier: shadow.observed.tier } : {}),
    recommendApproval: shadow.recommendApproval,
    shadow,
  };
}
