// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-9 — Governance event types + service result projections.
 *
 * This module is the type-level spine of CAP-9 governance. It defines:
 *
 *   - The five canonical governance event types (ruling #2).
 *   - The shared `capability.governance.proposal.` event prefix so a single
 *     EventLog hosts lifecycle AND governance events (ruling #1).
 *   - The narrow CAP-9 projection of an A4 (CAP-6) capability mutation
 *     result. The CAP-6 full `ExecutionStepResult` (or richer executor
 *     result) is wider than CAP-9 governance needs; this alias strips it
 *     to the four fields application-facing consumers use.
 *   - The discriminated `CapabilityGovernanceEvent` union (ledger shape).
 *   - The discriminated `CapabilityGovernanceEventProjection` union
 *     (application-facing shape, ruling #22).
 *
 * Architectural invariants (ruling #19):
 *   The governance ledger is append-only governance history; the catalog
 *   store is the authoritative capability state. These types MUST NOT
 *   carry references to live catalog/registry state.
 *
 * @module capability/governance/governance-types
 */

import type { ExecutionStepResult } from "../../evolution/execution/contracts/execution-contract.js";
import type { CapabilityEvolutionCandidate } from "../../adaptation/capability-evolution-types.js";

// ---------------------------------------------------------------------------
// CAP-9 narrow projection of an A4 (CAP-6) capability mutation result
// ---------------------------------------------------------------------------

/**
 * CAP-9 narrow projection of an A4 (CAP-6) capability mutation result.
 *
 * The CAP-6 capability-mutation-executor returns the full
 * `ExecutionStepResult` (see `contracts/execution-contract.ts`); CAP-9
 * strips it down to the fields application-facing consumers need. This is
 * a deliberate CAP-9 projection — coupling governance types directly to
 * A4 internals would leak CAP-6 evolution history into a stable public
 * surface.
 *
 * Invariant: `artifactId` is a SHA-256 hex string (64 lowercase chars) per
 * the CAP-6 verdict on Task 4.
 */
export interface CapabilityMutationResult {
  readonly success: boolean;
  readonly mutation: Record<string, unknown>;
  readonly artifactId: string;
  readonly error?: string;
}

/**
 * Permissive constructor — any A4-shaped executor result can be projected
 * down to `CapabilityMutationResult` without touching CAP-6 internals.
 *
 * CAP-6 (A4) executor wraps the inner capability-mutation result in a
 * two-level envelope:
 *   `{ success, output: { operation, mutation, result: { artifactId, … } } }`
 * so the projected `mutation` is `output.mutation` (the actual capability
 * mutation) and the projected `artifactId` is `output.result.artifactId`
 * (the SHA-256 hex immutable artifact id). Reading them from the top
 * level (`output.artifactId`, `output`) is the F1 critical defect.
 * Pure type-level adapter (no runtime cost beyond a `Object.freeze`).
 */
export function projectCapabilityMutationResult(
  result: ExecutionStepResult,
): CapabilityMutationResult {
  const output = result.output ?? {};
  const inner = (output as { result?: { artifactId?: unknown } }).result;
  const mutation = (output as { mutation?: Record<string, unknown> }).mutation ?? {};
  const artifactId =
    typeof inner?.artifactId === "string" ? inner.artifactId : "";
  return Object.freeze({
    success: result.success,
    mutation,
    artifactId,
    ...(result.error !== undefined ? { error: result.error } : {}),
  });
}

// ---------------------------------------------------------------------------
// Event type taxonomy (ruling #2)
// ---------------------------------------------------------------------------

/** Five governance event types emitted by CAP-9 governance ledger.
 *  Append-only — `pending` is a status, not an event type.
 *
 *  The full string form (e.g. `capability.governance.proposal.submitted`)
 *  is what is actually written to the EventLog `type` field — it carries
 *  the locked `capability.governance.*` prefix (ruling #1) so the shared
 *  EventLog can host lifecycle AND governance events under a single
 *  prefix rule. The bare `proposal.submitted` short form is exposed via
 *  `GOVERNANCE_EVENT_SHORT_TYPES` for callers that need the operation
 *  name without the prefix. */
export type CapabilityGovernanceEventType =
  | "capability.governance.proposal.submitted"
  | "capability.governance.proposal.approved"
  | "capability.governance.proposal.rejected"
  | "capability.governance.proposal.executed"
  | "capability.governance.proposal.execution_failed";

// Event names are stored in long form (`capability.governance.proposal.*`)
// — not the brief's verbatim short form (`proposal.submitted` …) — to
// satisfy ruling #1: "EventLog hosts lifecycle AND governance events under
// a single filter rule (`capability.*`)" by baking the shared
// `capability.governance.*` prefix into every event type. The brief's
// short form is preserved for projection/display via
// `CAPABILITY_GOVERNANCE_EVENT_SHORT_TYPES` (derived by stripping
// `GOVERNANCE_EVENT_PREFIX`).
export const CAPABILITY_GOVERNANCE_EVENT_TYPES: readonly CapabilityGovernanceEventType[] = [
  "capability.governance.proposal.submitted",
  "capability.governance.proposal.approved",
  "capability.governance.proposal.rejected",
  "capability.governance.proposal.executed",
  "capability.governance.proposal.execution_failed",
] as const;

/** Short form of the five governance event types (no namespace prefix).
 *  Useful for projection display and CLI output. Derived from the long
 *  form by stripping the locked `GOVERNANCE_EVENT_PREFIX`. */
export const CAPABILITY_GOVERNANCE_EVENT_SHORT_TYPES = [
  "proposal.submitted",
  "proposal.approved",
  "proposal.rejected",
  "proposal.executed",
  "proposal.execution_failed",
] as const;
export type CapabilityGovernanceEventShortType =
  (typeof CAPABILITY_GOVERNANCE_EVENT_SHORT_TYPES)[number];

/** Shared prefix used as the EventLog event `type` prefix for all
 *  governance events. Allows the same EventLog to host `capability.*`
 *  lifecycle AND governance events under a single filter rule (ruling #1). */
export const GOVERNANCE_EVENT_PREFIX = "capability.governance.proposal.";

/** Type guard — runtime narrowing from `unknown` to a known event type. */
export function isGovernanceEventType(value: unknown): value is CapabilityGovernanceEventType {
  return (
    typeof value === "string" &&
    (CAPABILITY_GOVERNANCE_EVENT_TYPES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Payload discriminated union members
// ---------------------------------------------------------------------------

export interface ProposalSubmittedPayload {
  readonly candidate: CapabilityEvolutionCandidate;
  readonly signalIds: ReadonlyArray<string>;
  /**
   * CAP-9 ruling #17 — the version of `candidate.target.id` at the time
   * the proposal was submitted, captured *before* persistence so the
   * apply step can re-resolve the pin against the current catalog and
   * reject stale publications. `null` indicates the target capability
   * was not yet present in the catalog (create intent).
   */
  readonly sourceVersion: string | null;
}

export interface ProposalApprovedPayload {
  readonly approvedBy: string;
  readonly approvedAt: string;
}

export interface ProposalRejectedPayload {
  readonly rejectedBy: string;
  readonly reason: string;
}

export interface ProposalExecutedPayload {
  readonly mutation: CapabilityMutationResult;
  readonly artifactId: string;
}

export type ProposalPartialState = "rolled_back" | "not_committed";

export interface ProposalExecutionFailedPayload {
  readonly error: string;
  readonly partialState?: ProposalPartialState;
}

// ---------------------------------------------------------------------------
// Ledger shape — full discriminated union over 5 event types
// ---------------------------------------------------------------------------

export type CapabilityGovernanceEvent =
  | {
      readonly seq: number;
      readonly timestamp: string;
      readonly proposalId: string;
      readonly type: "capability.governance.proposal.submitted";
      readonly payload: ProposalSubmittedPayload;
    }
  | {
      readonly seq: number;
      readonly timestamp: string;
      readonly proposalId: string;
      readonly type: "capability.governance.proposal.approved";
      readonly payload: ProposalApprovedPayload;
    }
  | {
      readonly seq: number;
      readonly timestamp: string;
      readonly proposalId: string;
      readonly type: "capability.governance.proposal.rejected";
      readonly payload: ProposalRejectedPayload;
    }
  | {
      readonly seq: number;
      readonly timestamp: string;
      readonly proposalId: string;
      readonly type: "capability.governance.proposal.executed";
      readonly payload: ProposalExecutedPayload;
    }
  | {
      readonly seq: number;
      readonly timestamp: string;
      readonly proposalId: string;
      readonly type: "capability.governance.proposal.execution_failed";
      readonly payload: ProposalExecutionFailedPayload;
    };

// ---------------------------------------------------------------------------
// Projection — application-facing, drops internals like actor
// ---------------------------------------------------------------------------

export type CapabilityGovernanceEventProjection =
  | {
      readonly seq: number;
      readonly timestamp: string;
      readonly proposalId: string;
      readonly type: "capability.governance.proposal.submitted";
      readonly payload: ProposalSubmittedPayload;
    }
  | {
      readonly seq: number;
      readonly timestamp: string;
      readonly proposalId: string;
      readonly type: "capability.governance.proposal.approved";
      readonly payload: ProposalApprovedPayload;
    }
  | {
      readonly seq: number;
      readonly timestamp: string;
      readonly proposalId: string;
      readonly type: "capability.governance.proposal.rejected";
      readonly payload: ProposalRejectedPayload;
    }
  | {
      readonly seq: number;
      readonly timestamp: string;
      readonly proposalId: string;
      readonly type: "capability.governance.proposal.executed";
      readonly payload: ProposalExecutedPayload;
    }
  | {
      readonly seq: number;
      readonly timestamp: string;
      readonly proposalId: string;
      readonly type: "capability.governance.proposal.execution_failed";
      readonly payload: ProposalExecutionFailedPayload;
    };
