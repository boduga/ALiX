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

/** Non-throwing variant for journaling an attempt from an unknown engine. */
export function tryThresholdProfileForEngine(
  engineId: string,
): RelevanceThresholdProfile | undefined {
  return CONTEXT_RELEVANCE_THRESHOLDS.find((entry) => entry.engineId === engineId);
}

/**
 * The profile the consumer should apply for `engineId`. The route's configured
 * profile wins when it belongs to that engine; otherwise the engine's own
 * profile is used, so a fallback never inherits another engine's calibration.
 */
export function resolveProfileForEngine(
  engineId: string,
  configuredProfileId: string,
): RelevanceThresholdProfile {
  const configured = thresholdProfileById(configuredProfileId);
  if (configured !== undefined && configured.engineId === engineId) return configured;
  return thresholdProfileForEngine(engineId);
}
