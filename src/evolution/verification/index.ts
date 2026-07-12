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
