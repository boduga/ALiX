// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — Execution Evidence Store re-export.
 *
 * Re-exports ExecutionEvidenceStore from the runtime layer so that
 * observation providers can import from the evolution/verification
 * module boundary.
 *
 * @module evidence-store
 */

export { ExecutionEvidenceStore } from "../../../runtime/execution-evidence-store.js";
