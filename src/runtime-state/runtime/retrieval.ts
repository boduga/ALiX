// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT
/**
 * Production retrieval barrel — re-exports ContextRetrieval.
 *
 * Tracer #640: real EventLog indexes + StateProjector checkpoints.
 * Primary implementation lives in src/runtime-state/runtime/context/retrieval.ts;
 * this barrel satisfies the "src/runtime-state/runtime/retrieval" import path without
 * duplicating logic (no new abstraction, extends existing src/runtime-state/runtime/*).
 *
 * @module runtime/retrieval
 */

export * from "./context/retrieval.js";
