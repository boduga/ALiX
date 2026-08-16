/**
 * A9 — proposal events adapter (Slice 1, Phase 4/5).
 *
 * Read-only adapter over EventLog `capability.governance.proposal.*` events.
 * Returns RAW `ProposalEventRecord[]`.
 *
 * Key invariant: the raw `payload` is preserved VERBATIM. For
 * `proposal.submitted` this keeps the canonical two-hop bridge anchor
 * `payload.candidate.target.id` available downstream — A9 must NOT normalize
 * the target away (verified in Phase 0: `ProposalSubmittedPayload` is
 * `{ candidate, signalIds, sourceVersion }` and
 * `CapabilityEvolutionCandidate.target = { kind: "capability"; id }`).
 *
 * Schema reconciliation (verified against `ProposalStore.append()` in
 * `src/capability/governance/proposal-store.ts`):
 * - `proposalId` lives IN THE PAYLOAD — ProposalStore writes
 *   `payload: { proposalId, ...payload }` (its read-back helper
 *   `toCapabilityGovernanceEvent` reads `payload.proposalId`). A top-level
 *   `proposalId` on the event is a fallback only (the A8 adapter's shape).
 * - `capabilityId` is populated only for `proposal.submitted` (via
 *   `payload.candidate.target.id`); empty string for the other four kinds.
 *
 * Implementation note: EventLog exposes `readAll()` but no `listByPrefix`, so
 * filtering by `type.startsWith(prefix)` happens inside the adapter. Never
 * writes. Never joins — joins belong above the adapter boundary (the engine).
 *
 * @module evolution/a9/adapters/proposal-events-adapter
 */

import type { EventLog } from "../../../events/event-log.js";
import type { A9Adapter, ProposalEventRecord } from "../contracts/a9-contract.js";
import { readCandidateTargetId } from "../bridge-target.js";

/** Locked governance proposal event prefix (CAP-9 ruling #1/#2) — filter key. */
export const A9_PROPOSAL_EVENT_PREFIX = "capability.governance.proposal.";

/** Locked governance namespace prefix — stripped from the event type to keep
 *  the "proposal." short kind ("proposal.submitted" | ... | "proposal.execution_failed"). */
export const A9_GOVERNANCE_NAMESPACE_PREFIX = "capability.governance.";

export class ProposalEventsAdapter implements A9Adapter<ProposalEventRecord> {
  readonly name = "a9-proposal-events";
  constructor(private readonly eventLog: EventLog) {}

  async list(): Promise<ReadonlyArray<ProposalEventRecord>> {
    const all = await this.eventLog.readAll();
    return all
      .filter((e) => e.type.startsWith(A9_PROPOSAL_EVENT_PREFIX))
      .map((e) => this.toRecord(e));
  }

  private toRecord(event: {
    seq: number;
    timestamp: string;
    type: string;
    payload: unknown;
    proposalId?: string;
  }): ProposalEventRecord {
    // Strip the locked `capability.governance.` namespace so the kind keeps the
    // "proposal." prefix ("proposal.submitted" | ... | "proposal.execution_failed").
    const shortKind = event.type.replace(A9_GOVERNANCE_NAMESPACE_PREFIX, "") as ProposalEventRecord["kind"];
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    // proposalId canonical source: THE PAYLOAD. ProposalStore writes
    // `payload: { proposalId, ...payload }` (proposal-store.ts:175-180), so
    // `payload.proposalId` is the real persisted location. A top-level
    // `event.proposalId` is a fallback for any other/future writer that
    // attaches it on the event itself (the A8 adapter's shape).
    const proposalId =
      typeof payload["proposalId"] === "string"
        ? payload["proposalId"]
        : event.proposalId ?? "";
    // capabilityId only available for proposal.submitted via candidate.target.id.
    const capabilityId =
      shortKind === "proposal.submitted" ? (readCandidateTargetId(payload) ?? "") : "";
    return {
      proposalId,
      capabilityId,
      kind: shortKind,
      payload, // RAW — preserves proposal.submitted.payload.candidate.target.id
      recordedAt: event.timestamp,
      eventId: String(event.seq),
    };
  }
}
