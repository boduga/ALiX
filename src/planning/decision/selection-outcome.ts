/**
 * selection-outcome.ts — vocabulary shared by the task loop's tool-selection
 * trace and the offline selection experiment.
 *
 * Decision-owned on purpose: the run layer imports these, so the dependency
 * direction stays `run/task-loop → decision` and the experiment never reaches
 * back into the loop. Three separate dimensions, never collapsed into one
 * verdict: what happened mechanically, whether the choice was novel, and what
 * the result contributed.
 */

export type ExecutionOutcome = "success" | "failed" | "repaired";
export type SelectionOutcome = "novel" | "redundant";
/**
 * Mechanical signal only: `contributed` means the call returned content and was
 * not a provable no-op — not that it helped satisfy the objective.
 */
export type EvidenceContribution = "contributed" | "none" | "unknown";
