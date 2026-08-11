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

import type { CapabilityDefinition, CapabilityRisk, CapabilityPermission } from "./canonical/definition.js";
import type { CapabilityProviderBinding } from "./canonical/provider.js";

// ---------------------------------------------------------------------------
// Mutation payloads (design §20-25; #477/#479/#480/#481)
// ---------------------------------------------------------------------------

/** Mutable definition surface (#480 patch surface). `id`/`version`/`kind` are
 *  immutable and never patchable. Every field here is a governed mutation —
 *  none is a governance loophole. */
export interface CapabilityDefinitionPatch {
  title?: string;
  description?: string;
  aliases?: string[];
  tags?: string[];
  category?: string;
  risk?: CapabilityRisk;
  requiredPermissions?: CapabilityPermission[];
  argsSchema?: Record<string, unknown>;
  resultSchema?: Record<string, unknown>;
  examples?: string[];
  dependencies?: string[];
  bindings?: CapabilityProviderBinding[];
  allowFallbacks?: boolean;
  extensions?: Record<string, unknown>;
}

/** create (#478): an authored, approved definition — no placeholder. A new
 *  capability always enters the graph at `emerging` (#481); `initialLifecycle`
 *  may be omitted and defaults to "emerging". */
export interface CapabilityCreateMutation {
  operation: "capability.create";
  definition: CapabilityDefinition;
  initialLifecycle?: "emerging";
}

/** update (#480): governed source `id@version` → new immutable publication.
 *  `update(id)` meaning "modify current" is explicitly PROHIBITED — the caller
 *  must name the exact source version. Bump is executor-classified via
 *  `classifyUpdateBump` (Task 3). */
export interface CapabilityUpdateMutation {
  operation: "capability.update";
  capabilityId: string;
  sourceVersion: string;
  patch: CapabilityDefinitionPatch;
}

/** transition (#481): explicit `from` is the stale-decision precondition. A
 *  transition is legal ONLY if `from → to` is in `LEGAL_LIFECYCLE_TRANSITIONS`. */
export interface CapabilityTransitionMutation {
  operation: "capability.transition";
  capabilityId: string;
  from: LifecycleState;
  to: LifecycleState;
}

/** consolidate (#477): true governed merge. The proposal carries the explicit
 *  resulting target `definition`; the executor applies exactly the approved
 *  definition and NEVER invents a merge. `target` must not be one of
 *  `sources`; `remove` only when safe (refs/deps — executor concern). */
export interface CapabilityConsolidateMutation {
  operation: "capability.consolidate";
  sources: string[];
  target: string;
  definition: CapabilityDefinition;
  sourceDisposition: "deprecate" | "remove";
}

/** remove (#481, design §25): policy-controlled. A `deprecated` capability may
 *  remain in the catalog for historical/reference purposes. */
export interface CapabilityRemoveMutation {
  operation: "capability.remove";
  capabilityId: string;
  reason: string;
}

export type CapabilityMutation =
  | CapabilityCreateMutation
  | CapabilityUpdateMutation
  | CapabilityTransitionMutation
  | CapabilityConsolidateMutation
  | CapabilityRemoveMutation;

export const CAPABILITY_MUTATION_OPERATIONS: readonly CapabilityMutation["operation"][] = [
  "capability.create",
  "capability.update",
  "capability.transition",
  "capability.consolidate",
  "capability.remove",
];
