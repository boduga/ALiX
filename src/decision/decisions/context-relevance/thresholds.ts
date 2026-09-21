/**
 * thresholds.ts — Versioned, engine-specific relevance thresholds (J2).
 *
 * JEV-9: a threshold profile belongs to one decision + engine. A profile is
 * never transferred across engines because the probability semantics differ.
 * Values are uncalibrated defaults until J4 produces reliability evidence.
 */

export type RelevanceThresholdProfile = {
  id: string;
  decision: "context-relevance";
  engineId: string;
  threshold: number;
  /** Uncalibrated until J4 tunes it from observed outcomes. */
  calibrated: boolean;
};

export const CONTEXT_RELEVANCE_THRESHOLDS: readonly RelevanceThresholdProfile[] = [
  {
    id: "context-relevance/local/v1",
    decision: "context-relevance",
    engineId: "local",
    threshold: 0.34,
    calibrated: false,
  },
  {
    id: "context-relevance/jev/v1",
    decision: "context-relevance",
    engineId: "jev",
    threshold: 0.5,
    calibrated: false,
  },
];

export function thresholdProfileById(id: string): RelevanceThresholdProfile | undefined {
  return CONTEXT_RELEVANCE_THRESHOLDS.find((profile) => profile.id === id);
}

/**
 * Profile for the engine that actually answered. A fallback engine uses its
 * OWN profile — another engine's calibration is never applied (JEV-9). An
 * engine with no profile fails closed.
 */
export function thresholdProfileForEngine(engineId: string): RelevanceThresholdProfile {
  const profile = CONTEXT_RELEVANCE_THRESHOLDS.find((entry) => entry.engineId === engineId);
  if (!profile) throw new Error(`No relevance threshold profile for engine: ${engineId}`);
  return profile;
}

/**
 * Resolve the profile a route configured, asserting it belongs to the engine
 * that actually answered. Mismatch fails closed rather than applying another
 * engine's calibration (JEV-9).
 */
export function resolveRelevanceThreshold(
  profileId: string,
  engineId: string,
): RelevanceThresholdProfile {
  const profile = thresholdProfileById(profileId);
  if (!profile) throw new Error(`Unknown relevance threshold profile: ${profileId}`);
  if (profile.engineId !== engineId) {
    throw new Error(
      `Threshold profile ${profileId} belongs to engine ${profile.engineId}, not ${engineId}`,
    );
  }
  return profile;
}
