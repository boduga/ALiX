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
export interface CapabilityApplyStep {
  readonly stepId: string;
  readonly operation:
    | "capability.create"
    | "capability.update"
    | "capability.transition"
    | "capability.consolidate"
    | "capability.remove";
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly idempotent?: boolean;
  readonly preconditions?: Readonly<Record<string, unknown>>;
  readonly postconditions?: Readonly<Record<string, unknown>>;
}

/** CAP-9 ruling #4 — `apply()` accepts either a verbatim A4 step
 *  (legacy CAP-8 path) or a ledger-bound proposalId (CAP-9 bridge).
 *  Discriminated by presence of `proposalId` vs `step`. */
export type CapabilityApplyInput =
  | { readonly step: CapabilityApplyStep }
  | { readonly proposalId: string };

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

/** Exactly five dependencies (CAP-9 extends the CAP-8 four-dep dep list
 *  with `proposalGenerator` — the A7 signal-only proposal intelligence
 *  adapter). `CapabilityResolver` already owns the `CapabilityRegistry`
 *  dep (CAP-7 ruling); the service does NOT double-inject.
 *
 *  `proposalGenerator` is OPTIONAL on the constructor to preserve
 *  backward compat with CAP-8 call-sites that only consume read methods
 *  (list/inspect/search/health/recommend). When `proposalGenerator` is
 *  absent, `service.propose()` throws `CapabilityServiceNotImplementedError`
 *  (CAP-8 ruling #4 — stable error contract). The `ProposalStore` is
 *  derived inside the constructor from the injected `eventLog`, so the
 *  service does not grow a separate persistence constructor dep. */
export interface CapabilityServiceOptions {
  readonly catalog: import("../canonical/catalog.js").CapabilityCatalog;
  readonly resolver: import("../provider-resolver.js").CapabilityResolver;
  readonly mutationExecutor: import("../../evolution/execution/capability-mutation-executor.js").CapabilityMutationExecutor;
  readonly eventLog: import("../../events/event-log.js").EventLog;
  /** CAP-9 ruling #5 — A7 proposal intelligence. Required by
   *  `service.propose()`. Backward-compat absent. */
  readonly proposalGenerator?: import("../evolution/proposals.js").CapabilityProposalGenerator;
  /** CAP-10 ruling #22 — measurement engine. Optional. Absent →
   *  `service.measure()` throws `CapabilityServiceNotImplementedError`
   *  (CAP-8 ruling #4 preserved). NEVER required. */
  readonly measurementEngine?: import("../measurement/capability-measurement-engine.js").CapabilityMeasurementEngine;
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

/** CAP-10 ruling #6 — measurement event projection. Lives in
 *  the same governance projection bucket (parent prefix
 *  `capability.governance.`) so `service.governance()` widens
 *  its filter to include `measurement.*` events alongside the
 *  CAP-9 `proposal.*` events. */
export interface CapabilityMeasurementEventProjection {
  readonly seq: number;
  readonly timestamp: string;
  readonly type: "capability.governance.measurement.measured";
  readonly payload: import("../measurement/measurement-event-types.js").CapabilityMeasurementPayload;
}

/** CAP-9 ruling #22 — governance event projection. Filters by
 *  `capability.governance.*` prefix (and capabilityId if supplied). Pure
 *  projection; no catalog reads (ruling #23).
 *  CAP-10 ruling #6 widens the filter to include `measurement.*`
 *  events in addition to CAP-9 `proposal.*` events. */
export interface CapabilityGovernanceResult {
  readonly events: ReadonlyArray<
    CapabilityGovernanceEventProjection | CapabilityMeasurementEventProjection
  >;
}

// ---------------------------------------------------------------------------
// CAP-10 — Measure input (ruling #2; type-gate section)
// ---------------------------------------------------------------------------

/** Capability measurement request input (CAP-10).
 *
 *  Identifies the capability `(capabilityId, version)` to measure
 *  and an optional baseline `ObservationResult.observationId`
 *  captured before measurement. `baselineObservationId` is optional —
 *  measurement may proceed without a baseline and record an
 *  absent-baseline posture in the resulting event. */
export interface CapabilityMeasureInput {
  readonly capabilityId: string;
  readonly version: string;
  readonly baselineObservationId?: string;
}

// ---------------------------------------------------------------------------
// CAP-10 — Measure result (ruling #4, #14)
// ---------------------------------------------------------------------------

import type { CapabilityMeasurementOutcome } from "../measurement/outcome-discriminated-union.js";
import type { ObservationStatus } from "../../evolution/observation/contracts/observation-contract.js";

/** Capability measurement result (CAP-10).
 *
 *  Atomic snapshot emitted by `CapabilityMeasurementEngine.measure()`
 *  on success (ruling #4). Lives in the `service/`-side result-shape
 *  registry alongside `CapabilityApplyResult` etc. — no generic
 *  envelope (ruling #8). Frozen — consumers may safely retain the
 *  snapshot across the event-log lifetime (CAP-6/9 precedent).
 *
 *  Exactly one `capability.governance.measurement.measured` event is
 *  recorded per successful measure() invocation (ruling #5); its
 *  `type+seq` is mirrored under `eventIds[0]`. */
export interface CapabilityMeasureResult {
  readonly status: "measured";
  readonly measurement: {
    readonly capabilityId: string;
    readonly version: string;
  };
  readonly baseline?: {
    readonly observationId: string;
    readonly takenAt: string;
  };
  readonly post: {
    readonly observationId: string;
    readonly takenAt: string;
    readonly status: ObservationStatus;
    readonly confidence: number;
  };
  readonly outcome: CapabilityMeasurementOutcome;
  readonly eventIds: ReadonlyArray<{
    readonly type: string;
    readonly seq: number;
  }>;
}