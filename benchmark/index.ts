// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT
/**
 * Benchmark harness barrel — tracer bullet for issue #628.
 *
 * Deterministic maintenance/reconciliation task harness. Same harness for A/B/C/D.
 * Horizons 10/50/100/500, 4-group metrics + retrieval_precision, state_sufficiency.
 *
 * Usage:
 *   import { runHorizons, runSingle } from "./benchmark/harness.js";
 *   const report = runHorizons({ seed: 42 });
 *   console.log(JSON.stringify(report.rows, null, 2));
 *
 * @module benchmark/index
 */

export * from "./types.js";
export * from "./scenario.js";
export * from "./fake-environment.js";
export * from "./fake-model.js";
export * from "./tokens.js";
export * from "./substrates.js";
export * from "./metrics.js";
export * from "./harness.js";
export * from "./mutation-conflict.js";
export * from "./mutation-conflict-stress.js";
