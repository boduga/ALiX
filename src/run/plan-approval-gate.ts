/**
 * Plan approval gate — shared interface used by both `runPlanPhase` and
 * the TUI's plan-approval card.
 *
 * `runPlanPhase` lives in `src/run/` and must not depend on the TUI layer.
 * This file is the seam: it defines the contract, and the TUI provides a
 * concrete implementation that drives a Promise resolution from Y/n/e/d
 * keypresses.
 *
 * Design constraints (see handoff):
 * - One-at-a-time: a second `requestDecision` while one is pending must
 *   reject (the operator is already reviewing a plan).
 * - Four decisions: `approve`, `reject`, `edit`, `detail`. The two
 *   informational ones (`edit`, `detail`) are resolved by the gate with
 *   the same Promise shape; `runPlanPhase` decides what to do with them
 *   (e.g. open editor for `edit`, re-prompt with detail for `detail`).
 * - No event bus, no callbacks. The contract is plain Promise + resolve.
 */

export type PlanDecision = "approve" | "reject" | "edit" | "detail";

export interface PlanApprovalRequest {
  /** Stable id for the plan under review (e.g. sessionId, planPath). */
  planId: string;
  /** Short summary surfaced in the TUI card header. */
  planSummary: string;
  /** Full plan content for `edit`/`detail` resolution paths. */
  planContent: string;
  /** Absolute path to the persisted plan file (for `edit`). */
  planPath: string;
}

export interface PlanApprovalGate {
  /**
   * Ask the gate to surface a plan for operator approval. Resolves when
   * the operator presses Y/n/e/d. Throws if another request is already
   * pending — the gate is one-at-a-time by design.
   */
  requestDecision(request: PlanApprovalRequest): Promise<PlanDecision>;
  /**
   * Resolve a pending request from the keyboard handler. No-op when no
   * request is pending for the given planId. The planId is part of the
   * contract so a stale resolve (e.g. after a tab switch) doesn't bleed
   * into the next request.
   */
  resolve(planId: string, decision: PlanDecision): void;
  /**
   * Test seam: return the currently pending request, or null. Read-only
   * — the TUI uses this to render the card without owning the request
   * state separately.
   */
  getPending(): PlanApprovalRequest | null;
}
