/**
 * A9 — correlation builder (Slice 4, Phase 12).
 *
 * Pure function that constructs ONE `Correlation` for a qualifying
 * (forecastId, measurementId) pair. Positive evidence only: the engine has
 * already authorized the pair through the canonical two-hop bridge and the
 * horizon boundary before the builder is invoked.
 *
 * Interpretation metadata (locked A9 v1):
 *   - `resolution.band` is the OBSERVED band derived deterministically from the
 *     measurement outcome:
 *         effective    → low
 *         inconclusive → medium
 *         ineffective  → critical
 *     This is interpretation metadata defined by the locked A9 v1 contract —
 *     it does NOT designate a primary realization and does NOT resolve
 *     conflicting measurements (outcome interpretation / calibration semantics
 *     are explicitly outside the correlation layer).
 *   - `resolution.delta` compares the observed band ordinal against the
 *     forecast band ordinal (low < medium < high < critical):
 *         observed == forecast → "match"
 *         observed  > forecast → "under-forecast" (forecast UNDERestimated risk)
 *         observed  < forecast → "over-forecast"  (forecast OVERestimated risk)
 *
 * Identity: `correlationId` is content-addressed (SHA-256 of the canonical
 * content via `correlationIdFor`) over the FULL correlation content —
 * `forecastId`, `measurementId`, `foreignProvenance`, and `resolution` — NOT
 * forecastId alone. Storage position / JSONL sequence never participate
 * (they do not exist on the content type).
 *
 * The `timestamp` argument is the engine's deterministic event-context time.
 * The Correlation contract carries no timestamp field, so it is NOT
 * identity-bearing content (spec: incidental timestamps are excluded from
 * identity when they are not semantic content). It is accepted to keep the
 * locked plan signature stable for future calibration semantics.
 *
 * The builder must NOT add `primary` / `terminal` / `resolved` / `attempted` /
 * `correlationStatus` — the contract forbids them.
 *
 * @module evolution/forecast/correlation-builder
 */

import type {
  Correlation,
  CorrelationContent,
  Forecast,
  CapabilityMeasurementRecord,
  RiskBand,
} from "./contracts/contract.js";
import { CORRELATION_VERSION } from "./contracts/contract.js";
import { correlationIdFor } from "./identity.js";

/** Ordinal risk-band ordering used to compute the resolution delta. */
const BAND_ORDER: Record<RiskBand, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/**
 * Project a measurement outcome onto the observed `RiskBand` (locked A9 v1
 * interpretation metadata).
 *
 *   effective    → low
 *   inconclusive → medium
 *   ineffective  → critical
 *
 * Exhaustive over the outcome union; deterministic.
 */
export function measurementOutcomeToBand(
  outcome: CapabilityMeasurementRecord["outcome"],
): RiskBand {
  switch (outcome) {
    case "effective":
      return "low";
    case "inconclusive":
      return "medium";
    case "ineffective":
      return "critical";
  }
}

/**
 * Compare the observed band against the forecast band (ordinal) into the
 * locked `delta` vocabulary.
 *
 *   observed == forecast → "match"
 *   observed  > forecast → "under-forecast"
 *   observed  < forecast → "over-forecast"
 */
function computeDelta(observed: RiskBand, forecastBand: RiskBand): Correlation["resolution"]["delta"] {
  if (observed === forecastBand) return "match";
  return BAND_ORDER[observed] > BAND_ORDER[forecastBand]
    ? "under-forecast"
    : "over-forecast";
}

/**
 * Build ONE positive-evidence correlation for an authorized
 * (forecast, measurement) pair.
 *
 * @param forecast the authorized forecast (bridge + horizon already validated
 *        by the engine; `subjectCapability` == the submitted target, executed
 *        present, not rejected)
 * @param measurement the qualifying measurement (capability == subjectCapability,
 *        recordedAt within [horizon.from, horizon.to])
 * @param proposalId the bridge-authorized proposal id — carried as foreign
 *        provenance (the engine passes `forecast.subject`)
 * @param timestamp deterministic event-context time (NOT identity-bearing)
 */
export function buildCorrelation(
  forecast: Forecast,
  measurement: CapabilityMeasurementRecord,
  proposalId: string,
  timestamp: string,
): Correlation {
  // `timestamp` is intentionally not written into the artifact: the
  // Correlation contract has no timestamp field, and identity must not
  // depend on it. It is accepted for the locked plan signature.
  void timestamp;

  const observedBand = measurementOutcomeToBand(measurement.outcome);
  const forecastBand = forecast.prediction.band;

  const content: CorrelationContent = {
    correlationVersion: CORRELATION_VERSION,
    forecastId: forecast.forecastId,
    measurementId: measurement.measurementId,
    foreignProvenance: { proposalId },
    resolution: {
      band: observedBand,
      forecastBand,
      delta: computeDelta(observedBand, forecastBand),
    },
  };

  return { correlationId: correlationIdFor(content), ...content };
}
