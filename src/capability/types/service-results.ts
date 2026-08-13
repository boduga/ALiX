// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-8 — Result-shape contracts for the CapabilityService surface (design §72).
 *
 * Locked ruling #8 (verbatim): "Narrow typed result shapes, one per method,
 * no generic envelope. No {ok, value, error} wrapper. No
 * CapabilityServiceResult<T>. No mutable domain objects by reference — results
 * are snapshots."
 *
 * Every interface here is readonly end-to-end. The service returns snapshots,
 * never live references; mutating a returned object can never change the
 * underlying catalog/registry/event-log state.
 *
 * @module capability/types/service-results
 */

import type { CapabilityKind } from "../canonical/kind.js";
import type { LifecycleState } from "../../adaptation/capability-evolution-types.js";
import type { CapabilityProviderBinding } from "../canonical/provider.js";
import type { CapabilityPermission, CapabilityRisk } from "../canonical/definition.js";

// ---------------------------------------------------------------------------
// Read-side result shapes (methods: list / inspect / search / health / recommend)
// ---------------------------------------------------------------------------

/** `service.list()` — flat enumeration of capabilities with lifecycle + availability snapshot. */
export interface CapabilityListItem {
  readonly id: string;
  readonly version: string;
  readonly kind: CapabilityKind;
  readonly title: string;
  readonly lifecycle: LifecycleState | undefined;
  readonly available: boolean;
  readonly bindings: readonly { readonly id: string; readonly type: string }[];
}

export interface CapabilityListResult {
  readonly items: readonly CapabilityListItem[];
  readonly total: number;
}

/** `service.inspect(id)` — single-capability full snapshot. */
export interface CapabilityInspectResult {
  readonly id: string;
  readonly version: string;
  readonly kind: CapabilityKind;
  readonly title: string;
  readonly description: string;
  readonly lifecycle: LifecycleState | undefined;
  readonly availability: {
    readonly available: boolean;
    readonly reason?: "missing_binding" | "provider_unavailable";
  };
  readonly bindings: readonly CapabilityProviderBinding[];
  readonly requiredPermissions: readonly CapabilityPermission[];
  readonly tags: readonly string[];
  readonly category: string;
  readonly risk: CapabilityRisk;
  readonly dependencies: readonly string[];
  readonly allowFallbacks: boolean | undefined;
}

/** `service.search(q)` — filtered enumeration. */
export interface CapabilitySearchQuery {
  readonly text?: string;
  readonly kind?: CapabilityKind;
  readonly tags?: readonly string[];
  readonly lifecycle?: LifecycleState;
  readonly availableOnly?: boolean;
  readonly limit?: number;
}

export interface CapabilitySearchResult {
  readonly query: CapabilitySearchQuery;
  readonly items: readonly CapabilityListItem[];
  readonly total: number;
}

/** `service.health(id)` — narrow health snapshot (locked ruling #9: NOT ProviderCandidate[]). */
export interface CapabilityHealthResult {
  readonly id: string;
  readonly version: string;
  readonly available: boolean;
  readonly reason?: "missing_binding" | "provider_unavailable" | "lifecycle_ineligible";
  readonly lifecycle: LifecycleState | undefined;
  readonly providersChecked: number;
}

/** `service.recommend(input)` — read-only suggestions (locked ruling #3). */
export interface CapabilityRecommendInput {
  readonly text: string;
  readonly limit?: number;
}

export interface CapabilityRecommendResult {
  readonly input: CapabilityRecommendInput;
  readonly suggestions: readonly CapabilityListItem[];
  readonly total: number;
}

// ---------------------------------------------------------------------------
// History (EventLog projection — locked ruling #5)
// ---------------------------------------------------------------------------

/** One capability-tagged event from EventLog. Payload is intentionally
 *  permissive because event payloads are schema-per-CAP-version, but the
 *  shape is typed (no `any`) and readonly. */
export interface CapabilityHistoryEvent {
  readonly seq: number;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly at: string;
}

export interface CapabilityHistoryResult {
  readonly id: string;
  readonly events: readonly CapabilityHistoryEvent[];
  readonly total: number;
}

// ---------------------------------------------------------------------------
// Apply (delegation to CAP-6 — locked ruling #1)
// ---------------------------------------------------------------------------

/** The A4 step shape the service forwards to CAP-6's `CapabilityMutationExecutor.executeStep`.
 *  Mirrors `ExecutionStep` but excludes A4 internal envelope; idempotency defaults to false,
 *  pre/postconditions default to empty records. */
export interface CapabilityApplyInput {
  readonly step: {
    stepId: string;
    operation:
      | "capability.create"
      | "capability.update"
      | "capability.transition"
      | "capability.consolidate"
      | "capability.remove";
    parameters: Readonly<Record<string, unknown>>;
    idempotent?: boolean;
    preconditions?: Readonly<Record<string, unknown>>;
    postconditions?: Readonly<Record<string, unknown>>;
  };
}

export interface CapabilityApplyResult {
  readonly success: boolean;
  readonly operation: string;
  readonly affected: readonly string[];
  readonly artifactId?: string;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Constructor dependency list (locked ruling #6 — derived from ownership graph)
// ---------------------------------------------------------------------------

/** Exactly four dependencies. `CapabilityResolver` already owns the
 *  `CapabilityRegistry` dep (CAP-7 ruling); the service does NOT double-inject.
 *  A future PR that adds a 5th dep is a locked-ruling-#6 violation. */
export interface CapabilityServiceOptions {
  readonly catalog: import("../canonical/catalog.js").CapabilityCatalog;
  readonly resolver: import("../provider-resolver.js").CapabilityResolver;
  readonly mutationExecutor: import("../../evolution/execution/capability-mutation-executor.js").CapabilityMutationExecutor;
  readonly eventLog: import("../../events/event-log.js").EventLog;
}

// ---------------------------------------------------------------------------
// CAP-9 governance result types (Task 1 — APPEND ONLY)
// ---------------------------------------------------------------------------

import type { CapabilityEvolutionCandidate } from "../../adaptation/capability-evolution-types.js";
import type { CapabilityGovernanceEventProjection, CapabilityMutationResult } from "../governance/governance-types.js";

/** CAP-9 ruling #3 — sole proposal submission route result.
 *  Fail-closed when input missing required fields (ruling #6). */
export interface CapabilityProposeResult {
  readonly proposalId: string;
  readonly status: "pending";
  readonly candidate: CapabilityEvolutionCandidate;
}

/** CAP-9 ruling #4 — approval→execution bridge result. `mutation` is
 *  present only when `status === 'executed'`; `error` is present only when
 *  `status === 'execution_failed'`. Narrow union — no generic envelope
 *  (CAP-8 ruling #8). */
export interface CapabilityApplyProposalResult {
  readonly proposalId: string;
  readonly status: "executed" | "execution_failed";
  readonly mutation?: CapabilityMutationResult;
  readonly error?: string;
}

/** CAP-9 ruling #22 — governance event projection. Filters by
 *  `capability.governance.*` prefix (and capabilityId if supplied). Pure
 *  projection; no catalog reads (ruling #23). */
export interface CapabilityGovernanceResult {
  readonly events: ReadonlyArray<CapabilityGovernanceEventProjection>;
}