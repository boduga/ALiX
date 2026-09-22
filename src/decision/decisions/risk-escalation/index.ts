/**
 * index.ts — Risk escalation decision (J6).
 *
 * Bounded Choice over three risk tiers; the composed approval recommendation
 * is advisory only. No execution authority.
 */

export * from "./schema.js";
export * from "./projection.js";
export * from "./local-baseline.js";
export * from "./corpus.js";
export * from "./jev-mapping.js";
export * from "./shadow.js";
export * from "./selection-service.js";
