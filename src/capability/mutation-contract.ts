// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-5 — Capability Mutation Contract.
 *
 * The single authoritative definition of what mutations are legal and what
 * state transitions they produce. Pure contract: types + constants + pure
 * validators. No registry/persistence/executor/runtime/governance imports and
 * no side effects. CAP-6 implements the executor that applies these mutations
 * through A4; CAP-9 targets A7 proposals at these intents; CAP-7 reads the
 * transition table for eligibility.
 *
 * Locked decisions: #475 (semantic kind), #477 (consolidation), #479
 * (versioning), #480 (executable update), #481 (lifecycle graph, no dormant).
 * This file grows cumulatively across plan Tasks 1-5.
 */

import type { LifecycleState } from "../adaptation/capability-evolution-types.js";

// ---------------------------------------------------------------------------
// Lifecycle transition policy (#481 — locked six-state graph)
// ---------------------------------------------------------------------------

/**
 * The fixed, acyclic six-state lifecycle graph (#481). Data-driven so the
 * locked graph is visibly auditable and tests have a single source of truth.
 * `deprecated` is terminal (empty legal target list). There is NO `dormant`
 * state — unbound capabilities are expressed on the availability axis, never
 * here. Lifecycle legality is part of the mutation contract: a transition is
 * a legal mutation ONLY if this table permits it.
 */
export const LEGAL_LIFECYCLE_TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  emerging: ["active", "deprecated"],
  active: ["mature", "declining"],
  mature: ["declining"],
  stagnant: ["active", "deprecated"],
  declining: ["deprecated"],
  deprecated: [],
};

/** Is `from → to` a legal lifecycle transition under the locked #481 graph? */
export function isLegalTransition(from: LifecycleState, to: LifecycleState): boolean {
  return LEGAL_LIFECYCLE_TRANSITIONS[from].includes(to);
}
