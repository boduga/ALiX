// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-9 Task 4 — ProposalStore (append-only governance ledger wrapper).
 *
 * Persistence-only seam for the five canonical governance events. Wraps the
 * shared EventLog and writes events under the locked
 * `capability.governance.proposal.*` prefix (ruling #1) so the same EventLog
 * hosts lifecycle AND governance events under a single filter rule.
 *
 * Architectural invariants (ruling #19):
 *   - The governance ledger is the append-only governance history.
 *   - The catalog is the authoritative capability state.
 *   - ProposalStore carries no live catalog/registry references; it only
 *     reads from / writes to the EventLog.
 *
 * Read-back shape: `findById()` reconstructs `CapabilityGovernanceEvent`
 * objects from `eventLog.readAll()` — events are filtered by the governance
 * prefix and the proposal id (which lives in the payload, not a top-level
 * field, so a single prefix filter is enough to scope the governance
 * stream).
 *
 * Persistence path:
 *   1. Compute deterministic proposal id via `computeProposalId(candidate)`.
 *   2. Reject duplicates by scanning the ledger for an existing
 *      `proposal.submitted` event with this id (ruling #21).
 *   3. Construct the EventLog NewEvent with `type` set to the long-form
 *      event type (e.g. `capability.governance.proposal.submitted`,
 *      ruling #1), `actor: "system"`, and `payload: { proposalId, ... }`.
 *   4. Convert the persisted `AlixEvent` back to a frozen
 *      `CapabilityGovernanceEvent` with long-form discriminants (matches
 *      Task 1 type spine).
 *
 * @module capability/governance/proposal-store
 */

import type { EventLog } from "../../events/event-log.js";
import type { AlixEvent, NewEvent } from "../../events/types.js";
import { computeProposalId } from "./proposal-identity.js";
import {
  GOVERNANCE_EVENT_PREFIX,
  type CapabilityGovernanceEvent,
  type CapabilityGovernanceEventType,
  type ProposalApprovedPayload,
  type ProposalExecutionFailedPayload,
  type ProposalExecutedPayload,
  type ProposalRejectedPayload,
  type ProposalSubmittedPayload,
} from "./governance-types.js";
import { CapabilityProposalDuplicateError } from "../errors/proposal-duplicate.js";
import type { CapabilityEvolutionCandidate } from "../../adaptation/capability-evolution-types.js";
import type { CapabilityMutationResult } from "./governance-types.js";

export interface ProposalStoreOptions {
  readonly eventLog: EventLog;
}

export class ProposalStore {
  private readonly eventLog: EventLog;

  constructor(options: ProposalStoreOptions) {
    this.eventLog = options.eventLog;
  }

  /**
   * Append a `proposal.submitted` event. Computes a deterministic proposal
   * id via `computeProposalId(candidate)` and rejects duplicates (ruling
   * #21). Returns the persisted proposal id AND materialized event so the
   * caller does not need a second read.
   *
   * `sourceVersion` (ruling #17) is the catalog version of
   * `candidate.target.id` captured at submission time. The apply step
   * compares it against the current catalog and rejects stale
   * publications instead of silently rebasing. Pass `null` when the
   * target capability is not yet in the catalog (create intent).
   */
  async submit(
    candidate: CapabilityEvolutionCandidate,
    signalIds: ReadonlyArray<string>,
    sourceVersion: string | null,
  ): Promise<{ proposalId: string; event: CapabilityGovernanceEvent }> {
    const proposalId = computeProposalId(candidate);
    if (await this.existsSubmitted(proposalId)) {
      throw new CapabilityProposalDuplicateError(proposalId);
    }
    const payload: ProposalSubmittedPayload = { candidate, signalIds, sourceVersion };
    const event = await this.append(proposalId, "capability.governance.proposal.submitted", payload);
    return { proposalId, event };
  }

  async recordApproved(
    proposalId: string,
    approvedBy: string,
  ): Promise<CapabilityGovernanceEvent> {
    const payload: ProposalApprovedPayload = {
      approvedBy,
      approvedAt: new Date().toISOString(),
    };
    return this.append(proposalId, "capability.governance.proposal.approved", payload);
  }

  async recordRejected(
    proposalId: string,
    rejectedBy: string,
    reason: string,
  ): Promise<CapabilityGovernanceEvent> {
    const payload: ProposalRejectedPayload = { rejectedBy, reason };
    return this.append(proposalId, "capability.governance.proposal.rejected", payload);
  }

  async recordExecuted(
    proposalId: string,
    mutation: CapabilityMutationResult,
    artifactId: string,
  ): Promise<CapabilityGovernanceEvent> {
    const payload: ProposalExecutedPayload = { mutation, artifactId };
    return this.append(proposalId, "capability.governance.proposal.executed", payload);
  }

  async recordExecutionFailed(
    proposalId: string,
    error: string,
    partialState?: "rolled_back" | "not_committed",
  ): Promise<CapabilityGovernanceEvent> {
    const payload: ProposalExecutionFailedPayload = {
      error,
      ...(partialState !== undefined ? { partialState } : {}),
    };
    return this.append(proposalId, "capability.governance.proposal.execution_failed", payload);
  }

  /**
   * Reconstruct all governance events for a proposal id, ordered by `seq`.
   * Pure projection over `eventLog.readAll()` — no catalog state.
   */
  async findById(proposalId: string): Promise<CapabilityGovernanceEvent[]> {
    const all = await this.eventLog.readAll();
    const matched = all
      .filter(isGovernanceRawEvent)
      .filter((e) => (e.payload as { proposalId?: unknown } | undefined)?.proposalId === proposalId)
      .map(toCapabilityGovernanceEvent)
      .sort((a, b) => a.seq - b.seq);
    return matched;
  }

  /**
   * Duplicate-detection helper (ruling #21). Returns true iff the ledger
   * already contains a `proposal.submitted` event with this proposal id.
   */
  async existsSubmitted(proposalId: string): Promise<boolean> {
    const all = await this.eventLog.readAll();
    return all.some(
      (e) =>
        isGovernanceRawEvent(e) &&
        e.type === "capability.governance.proposal.submitted" &&
        (e.payload as { proposalId?: unknown } | undefined)?.proposalId === proposalId,
    );
  }

  // -------------------------------------------------------------------------
  // Internal — append helper
  // -------------------------------------------------------------------------

  private async append(
    proposalId: string,
    type: CapabilityGovernanceEventType,
    payload:
      | ProposalSubmittedPayload
      | ProposalApprovedPayload
      | ProposalRejectedPayload
      | ProposalExecutedPayload
      | ProposalExecutionFailedPayload,
  ): Promise<CapabilityGovernanceEvent> {
    const newEvent: NewEvent<string, { proposalId: string }> = {
      type,
      actor: "system",
      sessionId: "",
      payload: { proposalId, ...payload },
    };
    const written = await this.eventLog.append(newEvent);
    return toCapabilityGovernanceEvent(written);
  }
}

// ---------------------------------------------------------------------------
// Helpers — bridge between AlixEvent (EventLog shape) and CapabilityGovernanceEvent
// ---------------------------------------------------------------------------

function isGovernanceRawEvent(e: AlixEvent): boolean {
  return typeof e.type === "string" && e.type.startsWith(GOVERNANCE_EVENT_PREFIX);
}

function toCapabilityGovernanceEvent(e: AlixEvent): CapabilityGovernanceEvent {
  return Object.freeze({
    seq: e.seq,
    timestamp: e.timestamp,
    proposalId: (e.payload as { proposalId: string }).proposalId,
    type: e.type as CapabilityGovernanceEventType,
    payload: e.payload,
  }) as unknown as CapabilityGovernanceEvent;
}
