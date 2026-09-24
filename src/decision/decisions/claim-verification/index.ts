/**
 * index.ts — Claim verification decision (J1).
 *
 * Narrow typed surface: enumerated schema, minimal projector, deterministic
 * local baseline, Jev wire mapping, and a shadow runner that grants no
 * execution authority.
 */

export * from "./schema.js";
export * from "./projection.js";
export * from "./local-baseline.js";
export * from "./thresholds.js";
export * from "./corpus.js";
export * from "./jev-mapping.js";
export * from "./shadow.js";
export * from "./selection-service.js";
export * from "./experiment-store.js";
