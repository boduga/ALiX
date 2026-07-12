// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2 — Evolution Verification Framework barrel exports.
 *
 * Exports are added incrementally as each milestone is implemented.
 * This file currently exports A2.0 sources only.
 *
 * @module verification
 */

export * from "./contracts/verification-contract.js";
export * from "./contracts/confidence-contract.js";
export * from "./contracts/environment-contract.js";
export * from "./contracts/replay-contract.js";
export * from "./confidence/confidence-calculator.js";
export * from "./evaluation/historical-similarity.js";
export * from "./replay/logical-clock.js";
export * from "./replay/seeded-prng.js";
export * from "./replay/deterministic-scheduler.js";
export * from "./replay/deterministic-event-merge.js";
export * from "./replay/replay-engine.js";
export * from "./contracts/counterfactual-contract.js";
export * from "./evaluation/counterfactual-evaluator.js";
export * from "./evidence/verification-report.js";
export * from "./evidence/verification-evidence.js";
export * from "./evidence/evidence-ledger.js";
export * from "./evidence/lineage-tracker.js";
export * from "./contracts/recommendation-contract.js";
export * from "./recommendation/recommendation-engine.js";
