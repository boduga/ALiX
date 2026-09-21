/**
 * index.ts — Context relevance decision (J2).
 *
 * Per-item Noul scoring behind a feature flag; ranking/filtering stays in
 * deterministic code. No execution authority.
 */

export * from "./projection.js";
export * from "./local-baseline.js";
export * from "./jev-mapping.js";
export * from "./thresholds.js";
export * from "./selection.js";
export * from "./corpus.js";
export * from "./shadow.js";
