import type {
  PlanApprovalGate,
  PlanApprovalRequest,
  PlanDecision,
} from "../run/plan-approval-gate.js";

/**
 * In-TUI plan approval gate. Owns the Promise that `runPlanPhase` awaits;
 * resolved by the TUI's keyboard handler when the operator presses Y/n/e/d.
 *
 * Invariants (enforced by the test suite):
 * - One-at-a-time: a second `requestDecision` while one is pending
 *   throws — the operator is already reviewing a plan. The caller must
 *   `resolve()` (or `clear()`) the pending request before issuing a new one.
 * - Stale `resolve(planId)` is a no-op if `planId` no longer matches the
 *   pending request. This allows the keyboard handler to fire-and-forget
 *   after a tab switch.
 * - `getPending()` is the read-only view used by `paintFullFrame` to render
 *   the card. Mutating the returned object has no effect on the gate.
 */
export class TuiPlanApprovalGate implements PlanApprovalGate {
  private pending: {
    request: PlanApprovalRequest;
    resolve: (decision: PlanDecision) => void;
  } | null = null;

  /**
   * Throw if a request is already pending. The contract is one-at-a-time:
   * `runPlanPhase` is only called once per session turn, so this is
   * programmer-error / double-call insurance rather than a runtime branch.
   */
  requestDecision(request: PlanApprovalRequest): Promise<PlanDecision> {
    if (this.pending) {
      return Promise.reject(
        new Error(
          `plan approval gate already has a pending request for ${this.pending.request.planId}`,
        ),
      );
    }
    return new Promise<PlanDecision>((resolve) => {
      this.pending = { request, resolve };
    });
  }

  resolve(planId: string, decision: PlanDecision): void {
    if (!this.pending) return;
    if (this.pending.request.planId !== planId) return;
    const { resolve } = this.pending;
    this.pending = null;
    resolve(decision);
  }

  /**
   * Test / CLI-shutdown seam: drop the pending request without resolving.
   * The awaiting `runPlanPhase` call stays pending — caller must restart
   * the gate or refresh the session. Used in unit tests between cases.
   */
  clear(): void {
    this.pending = null;
  }

  getPending(): PlanApprovalRequest | null {
    if (!this.pending) return null;
    // Defensive shallow copy so callers can't mutate the gate's state by
    // mutating the returned object. The card renderer relies on this —
    // paintPlanApprovalCard reads planSummary and would otherwise leak
    // edits back into the gate.
    return { ...this.pending.request };
  }
}
