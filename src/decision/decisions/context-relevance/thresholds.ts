/**
 * thresholds.ts — Context-relevance thresholds (J2, on the J4 profile registry).
 *
 * Defaults are seeded into the generic, versioned profile registry
 * (`calibration/profiles.ts`) as **shadow** profiles: uncalibrated, therefore
 * not applied. The plan is explicit — "No calibrated threshold: run in
 * shadow/observe mode rather than silently granting automation" — so an
 * uncalibrated seed cannot resolve to an active threshold. A caller enables
 * filtering by injecting a registry holding a promoted, calibrated profile.
 *
 * JEV-9: a profile belongs to one decision + engine. A profile is never
 * transferred across engines because the probability semantics differ.
 */

import {
  activeProfile,
  createProfileRegistry,
  profileById,
  type ProfileRegistry,
  type ThresholdProfile,
} from "../../calibration/profiles.js";

/** A context-relevance profile is a threshold profile (same shape). */
export type RelevanceThresholdProfile = ThresholdProfile;

const DECISION = "context-relevance" as const;

/** Seeded defaults: shadow-only, so they observe but never gate. */
export const CONTEXT_RELEVANCE_PROFILES: ProfileRegistry = createProfileRegistry([
  {
    id: "context-relevance/local/v1",
    decision: DECISION,
    engineId: "local",
    threshold: 0.34,
    status: "shadow",
  },
  {
    id: "context-relevance/jev/v1",
    decision: DECISION,
    engineId: "jev",
    threshold: 0.5,
    status: "shadow",
  },
]);

export function thresholdProfileById(
  id: string,
  registry: ProfileRegistry = CONTEXT_RELEVANCE_PROFILES,
): RelevanceThresholdProfile | undefined {
  return profileById(registry, id);
}

/**
 * Active profile for the engine that actually answered. A fallback engine uses
 * its OWN profile — another engine's calibration is never applied (JEV-9). An
 * engine with no active (calibrated, promoted) profile fails closed.
 */
export function thresholdProfileForEngine(
  engineId: string,
  registry: ProfileRegistry = CONTEXT_RELEVANCE_PROFILES,
): RelevanceThresholdProfile {
  const profile = activeProfile(registry, { decision: DECISION, engineId });
  if (!profile) {
    throw new Error(
      `No active relevance threshold profile for engine: ${engineId} ` +
        "(promote a calibrated profile before enabling filtering)",
    );
  }
  return profile;
}

/** Non-throwing variant for journaling an attempt from an unknown engine. */
export function tryThresholdProfileForEngine(
  engineId: string,
  registry: ProfileRegistry = CONTEXT_RELEVANCE_PROFILES,
): RelevanceThresholdProfile | undefined {
  return activeProfile(registry, { decision: DECISION, engineId });
}

/**
 * The profile the consumer should apply for `engineId`. The route's configured
 * profile wins when it belongs to that engine; otherwise the engine's own
 * active profile is used, so a fallback never inherits another engine's
 * calibration.
 */
export function resolveProfileForEngine(
  engineId: string,
  configuredProfileId: string,
  registry: ProfileRegistry = CONTEXT_RELEVANCE_PROFILES,
): RelevanceThresholdProfile {
  const configured = thresholdProfileById(configuredProfileId, registry);
  if (configured !== undefined && configured.engineId === engineId && configured.status === "active") {
    return configured;
  }
  return thresholdProfileForEngine(engineId, registry);
}
