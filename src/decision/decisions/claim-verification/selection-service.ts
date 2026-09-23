/**
 * selection-service.ts — Claim-verification selection behind a feature flag.
 *
 * Modes:
 *  - "baseline" — deterministic local verdict; no engine plan, no journal,
 *    no network. Default, so the tool is useful before any experiment starts.
 *  - "shadow"   — run configured engine + local baseline over one sealed
 *    projection, journal both, return the BASELINE verdict. Guard: when the
 *    runner skipped the baseline (compareBaseline: false), the local verdict
 *    is computed directly — the observed verdict is never returned.
 *  - "active"   — same observation, return the CONFIGURED engine's verdict.
 *
 * DIVERGENCE (deliberate, spec §10): selectModelTier/selectRiskTier return no
 * verdict in "shadow" because routing and PolicyGate already supply the
 * answer. Here the tool's entire response IS the verdict, so "shadow" must
 * return one — the baseline's, which is exactly "behaviour unchanged".
 * Observation begins; influence does not.
 */
import type { ClaimVerdict } from "./schema.js";
import { createClaimVerificationProjector, type ClaimVerificationInput } from "./projection.js";
import { classifyClaimLocally } from "./local-baseline.js";
import type { ClaimVerificationShadowDeps, ClaimVerificationShadowResult } from "./shadow.js";
import { runClaimVerificationShadow } from "./shadow.js";
import { LOCAL_ENGINE_ID } from "../../engines/local.js";

export type ClaimSelectionMode = "baseline" | "shadow" | "active";

export type ClaimSelection = {
  mode: ClaimSelectionMode;
  /** The verdict the consumer should use; absent only if no engine produced one. */
  verdict?: ClaimVerdict;
  /** Engine that produced `verdict`. */
  engineId?: string;
  /** Present in shadow/active; carries both records, `agree`, and `projection`. */
  shadow?: ClaimVerificationShadowResult;
};

export async function selectClaimVerification(
  input: ClaimVerificationInput,
  deps: ClaimVerificationShadowDeps & { mode?: ClaimSelectionMode },
): Promise<ClaimSelection> {
  const mode = deps.mode ?? "baseline";
  if (mode === "baseline") {
    const projection = createClaimVerificationProjector().project(input);
    const { verdict } = classifyClaimLocally(projection);
    return { mode, verdict, engineId: LOCAL_ENGINE_ID };
  }

  const shadow = await runClaimVerificationShadow(input, deps);

  if (mode === "shadow") {
    if (shadow.baseline?.verdict !== undefined) {
      return { mode, verdict: shadow.baseline.verdict, engineId: shadow.baseline.engineId, shadow };
    }
    const projection = createClaimVerificationProjector().project(input);
    const { verdict } = classifyClaimLocally(projection);
    return { mode, verdict, engineId: LOCAL_ENGINE_ID, shadow };
  }

  return {
    mode,
    ...(shadow.observed.verdict !== undefined
      ? { verdict: shadow.observed.verdict, engineId: shadow.observed.engineId }
      : {}),
    shadow,
  };
}
