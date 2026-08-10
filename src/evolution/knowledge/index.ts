// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Knowledge Evolution public surface.
 *
 * Barrel re-exporting the curation contracts (Task 2), the read-only store
 * adapters (Task 3), the pure detectors (Task 4), and the orchestration
 * engine (Task 5).
 *
 * @module knowledge-evolution
 */

export * from "./contracts/curation-contract.js";
export * from "./adapters/index.js";
export * from "./detectors/index.js";
export * from "./curation-engine.js";
