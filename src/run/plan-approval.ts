/**
 * src/run/plan-approval.ts — Shared approval loop extracted from plan-phase.ts.
 *
 * The approve / reject / edit / detail state machine was duplicated in
 * `resolvePlanDecisionViaGate()` and `promptForPlanApproval()`. This module
 * factors the loop into a single `runApprovalLoop()` function driven by a
 * `PlanApprovalIO` adapter, so the TUI gate path and CLI TTY prompt path both
 * share the same edit/re-detail/sidecar bookkeeping.
 *
 * @module
 */

import { parsePlanTasks } from "../planning/plan-task.js";
import {
  openPlanInEditor,
  persistPlanTaskSidecar,
  clearPlanTaskSidecar,
  summarisePlan,
} from "./plan-phase.js";
import type { SidecarFs, PlanPhaseResult } from "./plan-phase.js";

/** One round of operator input. */
export type PlanDecision = "approve" | "reject" | "edit" | "detail";

/**
 * IO adapter that the approval loop calls to interact with the operator.
 *
 * `requestDecision` surfaces the plan and returns a `PlanDecision`.
 * `showPlanDetail` is called when the operator asks for expanded detail
 * (the loop handles the content — the IO just displays it).
 */
export interface PlanApprovalIO {
  requestDecision(display: {
    planSummary: string;
    planContent: string;
    planPath: string;
  }): Promise<PlanDecision>;
  showPlanDetail(content: string, planPath: string): void | Promise<void>;
}

/**
 * Drive the approve / reject / edit / detail loop until the operator
 * approves or rejects, or the round budget is exhausted.
 *
 * The loop is bounded (10 rounds) as a defensive guard against a
 * misbehaving IO that keeps returning `edit`/`detail`.
 *
 * @param io            - Operator IO adapter.
 * @param planPath      - Path to the persisted plan file (for `edit`).
 * @param initialContent- Initial plan markdown.
 * @param sessionId     - Session id (for sidecar naming).
 * @param planDir       - Directory containing plan files (for sidecar).
 * @param sidecarFs     - Filesystem adapter for task sidecar persistence.
 */
export async function runApprovalLoop(
  io: PlanApprovalIO,
  planPath: string,
  initialContent: string,
  sessionId: string,
  planDir: string,
  sidecarFs: SidecarFs,
): Promise<PlanPhaseResult> {
  let planContent = initialContent;
  let currentTasks = parsePlanTasks(planContent, sessionId);

  for (let round = 0; round < 10; round++) {
    const decision = await io.requestDecision({
      planSummary: summarisePlan(planContent),
      planContent,
      planPath,
    });

    if (decision === "approve") {
      return { action: "approved", planContent, planTasks: currentTasks };
    }
    if (decision === "reject") {
      await clearPlanTaskSidecar(planDir, sessionId, sidecarFs);
      return { action: "rejected", planContent, planTasks: currentTasks };
    }
    if (decision === "edit") {
      // Open the editor in-place. The persisted file is the source of truth.
      const edited = await openPlanInEditor(planPath);
      if (edited === null) {
        console.error("Could not open editor (set $VISUAL or $EDITOR).");
        continue;
      }
      if (edited.trim().length === 0) {
        console.log("Empty plan — cancelling.");
        await clearPlanTaskSidecar(planDir, sessionId, sidecarFs);
        return { action: "rejected", planContent, planTasks: [] };
      }
      planContent = edited;
      currentTasks = parsePlanTasks(planContent, sessionId);
      await persistPlanTaskSidecar(planDir, sessionId, currentTasks, sidecarFs);
      continue;
    }
    // detail — show expanded detail, then re-prompt.
    await io.showPlanDetail(planContent, planPath);
  }

  // Rounds exhausted — reject instead of silently approving.
  return { action: "rejected", planContent, planTasks: currentTasks };
}
