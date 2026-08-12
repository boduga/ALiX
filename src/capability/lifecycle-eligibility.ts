// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-7 — Runtime Lifecycle Eligibility.
 *
 * Pure contract: the lifecycle-eligibility table and a single lookup function.
 * The resolver (Task 2) imports this module to filter `ProviderPlanStep`s
 * before the existing CAP-4 provider/availability filter. No registry,
 * resolver, catalog, or I/O dependency — the table is the table, the
 * function is the function, the annotation shape is the annotation shape.
 *
 * Locked rulings (CAP-7 brief):
 *   #5  lifecycle states are the CAP-5 six states — no new states, no renames.
 *   #6  LifecycleEligibility is deliberately narrow — no caller/role/governance
 *       fields, no timestamps, no audit IDs. overrideUsed is set at the
 *       resolver call site; this module does not produce or interpret it.
 *   #7  the table is a strict boolean Record<LifecycleState, boolean>;
 *       availability-axis values are NOT included (that would conflate axes).
 *
 * @module capability/lifecycle-eligibility
 */

import type { LifecycleState } from "../adaptation/capability-evolution-types.js";

/**
 * The locked lifecycle-eligibility table. `deprecated` is the only state
 * excluded from normal selection (AC#1, AC#2). Every other state passes
 * the lifecycle gate; the resolver then applies the CAP-4 provider/availability
 * filter. AC#1's "policy-dependent" cells in the ticket table are NOT a third
 * state — they mean `eligible: true` at the lifecycle axis; availability is
 * determined by the provider filter, not by this table.
 *
 * NOTE: do NOT add `unavailable` / `missing_binding` / `provider_unavailable`
 * keys to this table — that would conflate the lifecycle axis with the
 * availability axis (locked ruling #7, north-star invariant).
 */
export const LIFECYCLE_ELIGIBILITY: Readonly<Record<LifecycleState, boolean>> = Object.freeze({
  emerging: true,
  active: true,
  mature: true,
  stagnant: true,
  declining: true,
  deprecated: false,
});

/** Is a capability in `state` eligible for runtime selection at the lifecycle axis? */
export function isLifecycleEligible(state: LifecycleState): boolean {
  return LIFECYCLE_ELIGIBILITY[state];
}

/** Per-step lifecycle eligibility annotation (locked ruling #6: deliberately narrow). */
export interface LifecycleEligibility {
  /** The capability's current lifecycle state, captured at resolution time. */
  state: LifecycleState;
  /** True when the lifecycle gate passes for this step (i.e. `isLifecycleEligible(state)` is true,
   *  or the state is `deprecated` and the resolver was called with `allowDeprecated: true`). */
  eligible: boolean;
  /** True when the resolver was called with `allowDeprecated: true` AND the step's lifecycle
   *  state is `deprecated`. `overrideUsed: true` does NOT mean provider-available, execution-
   *  authorized, or governance-approved — it means the lifecycle-axis override was exercised. */
  overrideUsed: boolean;
}