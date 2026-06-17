/**
 * replan-approval-gate.ts — Atomic approval gate for plan revision proposals.
 *
 * Bridges the replan pipeline and the ApprovalStore with exact binding keys
 * that tie approval to a specific run + draft fingerprint.
 *
 * - Low-risk (auto-approved) proposals skip the approval store entirely.
 * - Medium/high/critical proposals go through requestOrReusePending() which
 *   atomically looks up an existing pending approval by binding key or creates
 *   a fresh one (no check-then-create race).
 * - Before applying, consumeApproved() enforces exact binding key + run ID match
 *   so a proposal can only be consumed when both the binding key and the
 *   coordination run ID match.
 *
 * All imports use .js extensions (NodeNext).
 */

import type {
  ApprovalRecord,
  ConsumeResult,
} from "../approvals/approval-types.js";
import type { ApprovalStore, ApprovalRequestInput } from "../approvals/approval-store.js";
import type { ImpactAnalysis } from "./replan-types.js";

// ─── Public types ────────────────────────────────────────────────────────────

export type ApprovalGateResult = {
  /** Whether the proposal may proceed. */
  approved: boolean;
  /** True when the gate auto-approved without creating an approval record. */
  autoApproved: boolean;
  /** Human-readable reason for the result. */
  reason: string;
  /** The approval record ID, set when an approval was created/reused. */
  approvalId?: string;
  /** The full approval record, set when one was created/reused/consumed. */
  record?: ApprovalRecord;
};

// ─── Gate implementation ─────────────────────────────────────────────────────

export class ReplanApprovalGate {
  constructor(private approvalStore: ApprovalStore) {}

  /**
   * Evaluate a plan revision proposal through the approval gate.
   *
   * When analysis.requiresApproval is false, returns auto-approved immediately.
   * Otherwise, computes a deterministic binding key from the run ID and draft
   * fingerprint, then atomically reuses any existing pending approval or creates
   * a new one via requestOrReusePending().
   *
   * @param analysis — The impact analysis for the proposal.
   * @param runId — The coordination run ID.
   * @param draftFingerprint — The fingerprint of the plan revision draft.
   * @param impactFingerprint — The fingerprint of the impact analysis (unused
   *   in this gate but reserved for future policy checks).
   */
  async evaluate(
    analysis: ImpactAnalysis,
    runId: string,
    draftFingerprint: string,
    impactFingerprint: string,
  ): Promise<ApprovalGateResult> {
    // Auto-approve when no approval is required
    if (!analysis.requiresApproval) {
      return {
        approved: true,
        autoApproved: true,
        reason: "Impact analysis determined no approval is required",
      };
    }

    const bindingKey = `replan:${runId}:${draftFingerprint}`;

    // Check for existing non-terminal records by binding key FIRST so we don't
    // create a duplicate when a previous evaluate() created a pending that was
    // later resolved to "approved". requestOrReusePending only matches "pending".
    const existing = this.approvalStore.findExact(bindingKey);
    if (existing) {
      if (existing.status === "approved") {
        return {
          approved: true,
          autoApproved: false,
          reason: `Approval ${existing.id} is already approved`,
          approvalId: existing.id,
          record: existing,
        };
      }
      if (existing.status === "pending") {
        return {
          approved: false,
          autoApproved: false,
          reason: `Approval ${existing.id} is already pending`,
          approvalId: existing.id,
          record: existing,
        };
      }
      // Terminal states (denied, consumed, expired, etc.) fall through to
      // requestOrReusePending which atomically creates a fresh record.
    }

    const input: ApprovalRequestInput = {
      reason: `Plan revision for run ${runId} requires approval (risk: ${analysis.riskLevel})`,
      bindingKey,
      requestFingerprint: `replan:${runId}:${draftFingerprint}:${impactFingerprint}`,
      policyRevision: draftFingerprint,
      capabilities: ["coordination.plan.revise"],
      coordinationRunId: runId,
      riskLevel: analysis.riskLevel as "low" | "medium" | "high" | "critical",
    };

    const record = await this.approvalStore.requestOrReusePending(input);

    const isApproved = record.status === "approved";
    return {
      approved: isApproved,
      autoApproved: false,
      reason: record.status === "approved"
        ? `Approval ${record.id} is already approved`
        : `Approval ${record.id} created with status "${record.status}"`,
      approvalId: record.id,
      record,
    };
  }

  /**
   * Check the status of an existing approval by ID.
   * Returns whether the approval is in an applicable state.
   */
  async checkApproval(approvalId: string): Promise<ApprovalGateResult> {
    const record = this.approvalStore.get(approvalId);
    if (!record) {
      return {
        approved: false,
        autoApproved: false,
        reason: `Approval "${approvalId}" not found`,
      };
    }

    const approved = record.status === "approved";
    return {
      approved,
      autoApproved: false,
      reason: approved
        ? `Approval ${record.id} is "${record.status}"`
        : `Approval ${record.id} is "${record.status}"`,
      approvalId: record.id,
      record,
    };
  }

  /**
   * Apply (consume) an approved approval record.
   * Verifies exact binding key and coordination run ID before consuming.
   *
   * @returns The result of consuming the approval.
   */
  async consumeApproved(
    approvalId: string,
    expectedBindingKey: string,
    coordinationRunId: string,
  ): Promise<ConsumeResult> {
    return this.approvalStore.consumeApproved(approvalId, expectedBindingKey, {
      workerId: coordinationRunId,
    });
  }
}
