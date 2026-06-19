/**
 * P5.1d — Approval Gate.
 *
 * The hard rule: no mutation without approval. This class enforces the
 * invariant by guarding every state transition on `AdaptationProposal` and
 * recording an evidence record for each transition.
 *
 * Lifecycle:
 *   pending → approved → applied   (happy path)
 *   pending → approved → failed    (applier errored)
 *   pending → rejected             (terminal)
 *
 * `apply()` is the only method that triggers external side effects (the
 * applier callback). It will not run unless the proposal's status is
 * `"approved"`. This is the single point of enforcement — every other
 * mutation path must funnel through here.
 *
 * @module
 */

import type { EvidenceEventWriter } from "../workflow/evidence-writer.js";
import type { ProposalStore } from "./proposal-store.js";
import type { AdaptationProposal, ProposalTarget } from "./adaptation-types.js";

/** Async function that performs the actual mutation for a proposal. */
export type Applier = (proposal: AdaptationProposal) => Promise<void>;

/** A human or system identifier approving/rejecting a proposal. */
export type Actor = string;

export class ApprovalGate {
  constructor(
    private readonly store: ProposalStore,
    private readonly writer: EvidenceEventWriter,
  ) {}

  // -------------------------------------------------------------------------
  // approve
  // -------------------------------------------------------------------------

  /**
   * Transition a pending proposal to `approved`. Records `adaptation_approved`
   * evidence and stamps the proposal with `approvedBy` and `approvedAt`.
   *
   * Throws if the proposal is missing or not in `pending` state.
   */
  async approve(id: string, by: Actor): Promise<AdaptationProposal> {
    const existing = await this.requirePending(id);

    const approvedAt = new Date().toISOString();
    const updated = await this.store.update(id, {
      status: "approved",
      approvedBy: by,
      approvedAt,
    });

    await this.writer.recordAdaptationApproved(id, {
      approvedBy: by,
      approvedAt,
      action: updated.action,
      target: updated.target as unknown as Record<string, unknown>,
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // reject
  // -------------------------------------------------------------------------

  /**
   * Transition a pending proposal to `rejected`. Records `adaptation_rejected`
   * evidence with the rejection reason.
   *
   * Throws if the proposal is missing or not in `pending` state.
   */
  async reject(id: string, by: Actor, reason: string): Promise<AdaptationProposal> {
    const existing = await this.requirePending(id);

    const updated = await this.store.update(id, { status: "rejected" });

    await this.writer.recordAdaptationRejected(id, {
      rejectedBy: by,
      reason,
      action: updated.action,
      target: updated.target as unknown as Record<string, unknown>,
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // apply
  // -------------------------------------------------------------------------

  /**
   * Execute the applier callback for a proposal that has already been
   * approved. The applier is responsible for the actual mutation (e.g.
   * writing an agent card JSON file).
   *
   * On success: status becomes `applied` and `adaptation_applied` is recorded.
   * On applier error: status becomes `failed`, the error is captured on the
   * proposal, and `adaptation_failed` is recorded. The error is re-thrown
   * so callers can surface it.
   *
   * Throws if the proposal is missing or not in `approved` state — this is
   * the no-approval-no-mutation invariant.
   */
  async apply(id: string, applier: Applier): Promise<AdaptationProposal> {
    const existing = await this.store.load(id);
    if (!existing) throw new Error(`Proposal not found: ${id}`);
    if (existing.status !== "approved") {
      throw new Error(
        `Cannot apply proposal ${id}: status is "${existing.status}", expected "approved"`,
      );
    }

    let updated: AdaptationProposal;
    try {
      await applier(existing);
      const appliedAt = new Date().toISOString();
      updated = await this.store.update(id, {
        status: "applied",
        appliedAt,
      });
      await this.writer.recordAdaptationApplied(id, {
        appliedAt,
        action: updated.action,
        target: updated.target as unknown as Record<string, unknown>,
        approvedBy: updated.approvedBy,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updated = await this.store.update(id, {
        status: "failed",
        error: message,
      });
      await this.writer.recordAdaptationFailed(id, {
        error: message,
        action: updated.action,
        target: updated.target as unknown as Record<string, unknown>,
        approvedBy: updated.approvedBy,
      });
      throw err;
    }

    return updated;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Load a proposal and assert it exists and is in `pending` state. */
  private async requirePending(id: string): Promise<AdaptationProposal> {
    const existing = await this.store.load(id);
    if (!existing) throw new Error(`Proposal not found: ${id}`);
    if (existing.status !== "pending") {
      throw new Error(
        `Cannot transition proposal ${id}: status is "${existing.status}", expected "pending"`,
      );
    }
    return existing;
  }
}
