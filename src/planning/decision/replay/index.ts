/**
 * index.ts — Replay and regression (J5).
 *
 * Stored fixtures → dry-run replay → comparison → promotion gate. No tools,
 * no governance mutation, no journal writes: the harness admits only fixtures
 * and executors, so a dry run cannot do anything else by construction.
 */

export * from "./fixtures.js";
export * from "./harness.js";
export * from "./cost.js";
export * from "./compare.js";
export * from "./gates.js";
