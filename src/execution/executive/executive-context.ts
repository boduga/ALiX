import { join } from "node:path";
import { PlanStore } from "./plan-store.js";
import { ExecutionStateStore } from "./execution-state-store.js";
import type { PlanExecutionState } from "./executive-plan-types.js";

/**
 * Executive-owned composition/read seam (R6).
 *
 * The four CLI import sites (`executive.ts`, `executive-evaluate-handler.ts`,
 * `executive-orchestrate-handler.ts`, `adaptation/main.ts`) construct stores
 * through here instead of importing the legacy store directly. A later
 * ledger/event projection swap lands in this seam without touching callers.
 */

/** Absolute plans directory for a workspace root. */
export function executivePlansDir(cwd: string): string {
  return join(cwd, ".alix", "executive", "plans");
}

/** Absolute executive directory for a workspace root. */
export function executiveDir(cwd: string): string {
  return join(cwd, ".alix", "executive");
}

/** Composition root: plan + execution-state stores for a workspace. */
export function createExecutiveStores(cwd: string): {
  planStore: PlanStore;
  stateStore: ExecutionStateStore;
} {
  const plansDir = executivePlansDir(cwd);
  return { planStore: new PlanStore(plansDir), stateStore: new ExecutionStateStore(plansDir) };
}

/** Read a plan's execution state through the executive seam. */
export function loadExecutiveState(cwd: string, planId: string): PlanExecutionState | null {
  return createExecutiveStores(cwd).stateStore.load(planId);
}
