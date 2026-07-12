// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A1.1 — Pattern Discovery Pipeline barrel exports.
 *
 * @module pattern-discovery
 */

export * from "./detection-strategy.js";
export * from "./pattern-discovery-engine.js";
export * from "./evolution-proposal-generator.js";
export * from "./strategies/execution-failure-strategy.js";
export * from "./strategies/approval-friction-strategy.js";
export * from "./strategies/performance-degradation-strategy.js";
export * from "./strategies/governance-gap-strategy.js";
export * from "./governance-intake-adapter.js";
