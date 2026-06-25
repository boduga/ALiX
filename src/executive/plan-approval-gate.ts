/**
 * P10.4a — PlanApprovalGate (lightweight whole-plan validator).
 *
 * Approves or rejects a plan at the whole-plan level. Does NOT inspect
 * step actions, behavior classes, or DAG — those are ExecutionEngine
 * responsibilities.
 *
 * Validations on approve():
 *   - Plan exists in PlanStore
 *   - Current state status === "draft" AND approval.status === "pending"
 *   - Plan has at least 1 step (empty plans are blocked and cannot be approved)
 *
 * Approval metadata is stored inside PlanExecutionState.approval — there
 * is no separate approval store.
 *
 * @module
 */

import type { PlanStore } from "./plan-store.js";
import type { ExecutionStateStore } from "./execution-state-store.js";
import type { EvidenceEventWriter } from "../workflow/evidence-writer.js";
import type { PlanExecutionState, PlanStatus } from "./executive-plan-types.js";

// Valid transition matrix for plan-level status changes through the gate
const VALID_APPROVE_FROM: PlanStatus[] = ["draft"];
const VALID_REJECT_FROM: PlanStatus[] = ["draft"];

export class PlanApprovalGate {
  constructor(
    private readonly planStore: PlanStore,
    private readonly stateStore: ExecutionStateStore,
    private readonly writer: EvidenceEventWriter,
  ) {}

  /**
   * Approve a plan. Throws if not in the correct state.
   * Records executive_plan_approved evidence.
   */
  approve(planId: string, by: string, executionId: string): PlanExecutionState {
    const plan = this.planStore.load(planId);
    const state = this.stateStore.load(planId);
    if (!state) throw new Error(`Execution state not found: ${planId}`);
    if (!VALID_APPROVE_FROM.includes(state.status)) {
      throw new Error(`Cannot approve plan in status: ${state.status}`);
    }
    if (state.approval.status !== "pending") {
      throw new Error(`Plan ${planId} approval already: ${state.approval.status}`);
    }
    if (plan.steps.length === 0) {
      throw new Error(`Cannot approve empty plan: ${planId}`);
    }
    // Startup consistency: state.planId must match plan.id
    if (state.planId !== plan.id) {
      throw new Error(
        `State planId mismatch: state="${state.planId}" != plan="${plan.id}"`,
      );
    }

    const now = new Date().toISOString();
    const updated = this.stateStore.update(
      planId,
      { from: state.status, to: "approved", executionId },
      s => {
        s.status = "approved";
        s.approval = {
          status: "approved",
          approvedBy: by,
          approvedAt: now,
        };
        s.timestamps.approvedAt = now;
        return s;
      },
    );

    // Fire-and-forget evidence recording
    this.writer.recordExecutivePlanApproved({
      planId,
      approvedBy: by,
      executionId,
    }).catch(() => {});

    return updated;
  }

  /**
   * Reject a plan. Throws if not in the correct state.
   * Records executive_plan_rejected evidence.
   */
  reject(planId: string, by: string, reason: string, executionId: string): PlanExecutionState {
    const state = this.stateStore.load(planId);
    if (!state) throw new Error(`Execution state not found: ${planId}`);

    // planStore.load() throws if plan not found — serves as existence check
    const plan = this.planStore.load(planId);
    if (state.planId !== plan.id) {
      throw new Error(
        `State planId mismatch: state="${state.planId}" != plan="${plan.id}"`,
      );
    }

    if (!VALID_REJECT_FROM.includes(state.status)) {
      throw new Error(`Cannot reject plan in status: ${state.status}`);
    }
    if (state.approval.status !== "pending") {
      throw new Error(`Plan ${planId} approval already: ${state.approval.status}`);
    }

    const now = new Date().toISOString();
    const updated = this.stateStore.update(
      planId,
      { from: state.status, to: "rejected", executionId, reason },
      s => {
        s.status = "rejected";
        s.approval = {
          status: "rejected",
          rejectedBy: by,
          rejectedAt: now,
          rejectionReason: reason,
        };
        s.timestamps.cancelledAt = now;
        return s;
      },
    );

    this.writer.recordExecutivePlanRejected({
      planId,
      rejectedBy: by,
      reason,
      executionId,
    }).catch(() => {});

    return updated;
  }
}
