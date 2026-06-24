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
import type { GovernanceCriteriaResult } from "../governance/governance-types.js";
import type { ProposalStore } from "./proposal-store.js";
import type { AdaptationProposal, ProposalTarget } from "./adaptation-types.js";

/** Async function that performs the actual mutation for a proposal. */
export type Applier = (proposal: AdaptationProposal) => Promise<void>;

/** A human or system identifier approving/rejecting a proposal. */
export type Actor = string;

/** P9.3: Governance criteria callback — pure read-only validation. */
export type GovernanceCriteriaFn = (
  proposal: AdaptationProposal,
) => Promise<GovernanceCriteriaResult>;

/** Error entry from a batch approval operation. */
export type ApprovalBatchError = { id: string; error: string };

export class ApprovalGate {
  constructor(
    private readonly store: ProposalStore,
    private readonly writer: EvidenceEventWriter,
    private readonly governanceCriteria?: GovernanceCriteriaFn,
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

    // P9.3: governance criteria check for governance_change proposals
    if (existing.action === "governance_change" && this.governanceCriteria) {
      const result = await this.governanceCriteria(existing);

      if (!result.passed) {
        // Record denial evidence — proposal status does NOT change
        // Includes integrityScore (0–100) and threshold (60) for self-contained audit.
        await this.writer.recordGovernanceApprovalDenied(id, {
          criterion: result.failedCriterion ?? "unknown",
          integrityScore: result.integrityScore,
          threshold: 60,
        });
        throw new Error(
          `Governance approval denied: ${result.failedCriterion}` +
          (result.integrityScore !== undefined
            ? ` (integrityScore: ${result.integrityScore})`
            : ""),
        );
      }

      // Record decision evidence BEFORE status transition.
      // Fail-closed: if recording fails, do NOT transition to approved.
      const decisionRecorded = await this.writer.recordGovernanceApprovalDecision(id, {
        integrityScore: result.integrityScore ?? 0,
        threshold: 60,
        passed: true,
      });
      if (!decisionRecorded) {
        throw new Error(
          `Governance approval failed: unable to record governance_approval_decision for ${id}`,
        );
      }
    }

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
  // approveBatch
  // -------------------------------------------------------------------------

  /**
   * Approve multiple proposals in a best-effort batch. Each proposal is
   * independently validated via {@link approve}. Errors are collected
   * per-proposal — one failure does not stop the batch.
   *
   * Does NOT throw. Returns a result object with counts and error details.
   * An empty `ids` array is a no-op.
   */
  async approveBatch(ids: string[], by: Actor): Promise<{
    approved: number;
    skipped: number;
    errors: ApprovalBatchError[];
  }> {
    const errors: ApprovalBatchError[] = [];
    let approved = 0;
    let skipped = 0;

    for (const id of ids) {
      try {
        await this.approve(id, by);
        approved++;
      } catch (err) {
        skipped++;
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ id, error: message });
      }
    }

    return { approved, skipped, errors };
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
