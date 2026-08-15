import type { LearningAdapter, ProposalGovernanceRecord } from "../contracts/learning-contract.js";
import type { EventLog } from "../../../events/event-log.js";

/**
 * Read-only adapter over EventLog `capability.governance.proposal.*` events.
 * Returns normalized ProposalGovernanceRecord[].
 *
 * Implementation note: EventLog exposes readAll() but no listByPrefix.
 * Filter by `event.type.startsWith(prefix)` inside the adapter.
 *
 * Never writes. Never joins or transforms into findings — joins belong
 * above the adapter boundary (in the engine).
 *
 * Schema reconciliation (A8 wayfinder map #517):
 * - `proposalId` lives on the event itself (event-level field), not in payload.
 * - `capabilityId` only populated for `proposal.submitted` (via
 *   `payload.candidate.target.id`); empty string for the other 4 event types.
 * - `operatorId` / `operatorReason` populated only for `proposal.approved`
 *   (`payload.approvedBy`) / `proposal.rejected` (`payload.rejectedBy` +
 *   `payload.reason`); absent on the other 3 types.
 */
export class ProposalEventsAdapter implements LearningAdapter<ProposalGovernanceRecord> {
  readonly name = "proposal-events";
  constructor(private readonly eventLog: EventLog) {}

  async list(): Promise<ReadonlyArray<ProposalGovernanceRecord>> {
    const all = await this.eventLog.readAll();
    return all
      .filter((e) => e.type.startsWith("capability.governance.proposal."))
      .map((e) => this.normalize(e));
  }

  private normalize(event: {
    seq: number;
    timestamp: string;
    type: string;
    payload: unknown;
    proposalId?: string;
  }): ProposalGovernanceRecord {
    // The ProposalGovernanceRecord["kind"] union preserves the "proposal."
    // prefix ("proposal.submitted" | "proposal.approved" | ...), so we
    // strip only the locked `capability.governance.` namespace.
    const shortKind = event.type.replace("capability.governance.", "") as ProposalGovernanceRecord["kind"];
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    // capabilityId only available for proposal.submitted (via candidate.target.id).
    const capabilityId =
      shortKind === "proposal.submitted"
        ? ((payload["candidate"] as { target?: { id?: unknown } } | undefined)?.target?.id as string | undefined) ?? ""
        : "";
    return {
      proposalId: event.proposalId ?? "",
      capabilityId,
      kind: shortKind,
      operatorId:
        (payload["approvedBy"] as string | undefined) ??
        (payload["rejectedBy"] as string | undefined),
      operatorReason: payload["reason"] as string | undefined,
      recordedAt: event.timestamp,
      eventId: String(event.seq),
    };
  }
}
