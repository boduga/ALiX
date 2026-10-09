/**
 * A9 — Pre-Execution Risk Forecast module (barrel).
 *
 * Slice 1: deterministic forecast pipeline. Exports contracts, identity,
 * risk-band, adapters, detectors, builder, and engine.
 *
 * @module evolution/forecast
 */

export * from "./contracts/contract.js";
export * from "./identity.js";
export * from "./risk-band.js";
export * from "./scale.js";
export * from "./adapters/proposal-events-adapter.js";
export * from "./adapters/measurement-events-adapter.js";
export * from "./adapters/enriched-proposals-adapter.js";
export * from "./detectors/trust-velocity-detector.js";
export * from "./detectors/evidence-completeness-detector.js";
export * from "./detectors/fingerprint-coincidence-detector.js";
export * from "./forecast-builder.js";
export * from "./forecast-engine.js";
export * from "./forecasts-store.js";
export * from "./forecasts-adapter.js";
export * from "./correlation-builder.js";
export * from "./correlation-engine.js";
export * from "./correlations-store.js";
export * from "./correlations-adapter.js";
export * from "./bridge.js";
export * from "./forecast-cli.js";
