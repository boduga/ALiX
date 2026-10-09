/**
 * thresholds.ts — Claim-local support-overlap threshold resolution (JEV-9).
 *
 * Resolution order:
 *  1. the configured route profile (`config.claimVerification.thresholdProfile`)
 *     when it is an ACTIVE local claim profile;
 *  2. the scope's ACTIVE local claim profile (`activeProfile`);
 *  3. the uncalibrated default (`SUPPORT_OVERLAP_THRESHOLD`).
 *
 * A foreign engine's profile — Jev-calibrated or otherwise — is NEVER applied
 * to the local baseline: calibration is engine-specific (JEV-9, DOX). Pure:
 * the caller loads the registry (an unreadable/invalid registry degrades to an
 * empty one, i.e. the default threshold, never a foreign number).
 */
import type { DecisionConfig } from "../../config.js";
import { activeProfile, type ProfileRegistry } from "../../calibration/profiles.js";
import { SUPPORT_OVERLAP_THRESHOLD } from "./local-baseline.js";

const CLAIM_DECISION = "claim-verification" as const;

/** Threshold the local claim baseline should classify with. */
export function resolveLocalClaimThreshold(
  config: DecisionConfig,
  profiles?: ProfileRegistry,
): number {
  const registry = profiles ?? { profiles: [] };
  const configuredId = config.claimVerification?.thresholdProfile;
  if (configuredId !== undefined && configuredId.length > 0) {
    const configured = registry.profiles.find((profile) => profile.id === configuredId);
    if (
      configured !== undefined &&
      configured.status === "active" &&
      configured.decision === CLAIM_DECISION &&
      configured.engineId === "local"
    ) {
      return configured.threshold;
    }
  }
  const own = activeProfile(registry, { decision: CLAIM_DECISION, engineId: "local" });
  return own?.threshold ?? SUPPORT_OVERLAP_THRESHOLD;
}
