/**
 * P10.4a — ExecutionStateStore (mutable plan execution state).
 *
 * Stores mutable execution state (stepStates, status, approval, transitions)
 * as a JSON file. Updates are atomic (write .tmp → fsync → rename).
 * Maintains monotonically increasing transition.sequence.
 *
 * INVARIANT: update() mutator MUST NOT modify planTransitions directly.
 * The store appends the transition with the next sequence number.
 *
 * @module
 */

import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import type { PersistedExecutionPlan } from "./executive-plan-types.js";
import type {
  PlanExecutionState,
  PlanStatus,
  PlanTransition,
} from "./executive-plan-types.js";
import { validateStateStepIds } from "./executive-plan-types.js";

function stateFilePath(dir: string, planId: string): string {
  return join(dir, `${planId}-state.json`);
}

function loadRawState(dir: string, planId: string): PlanExecutionState | null {
  const path = stateFilePath(dir, planId);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as PlanExecutionState;
}

function saveState(dir: string, state: PlanExecutionState): void {
  const path = stateFilePath(dir, state.planId);
  const tmpPath = path + ".tmp";
  const fd = openSync(tmpPath, "w");
  try {
    writeFileSync(fd, JSON.stringify(state, null, 2), "utf-8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, path);
}

export class ExecutionStateStore {
  constructor(private readonly dir: string) {}

  /**
   * Initialize execution state for a freshly-saved plan.
   * All steps start as "pending".
   */
  init(plan: PersistedExecutionPlan): PlanExecutionState {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });

    const now = new Date().toISOString();
    const stepStates: Record<string, PlanExecutionState["stepStates"][string]> = {};
    for (const step of plan.steps) {
      stepStates[step.id] = {
        status: "pending",
        evidenceIds: [],
        generatedArtifacts: [],
        warnings: [],
      };
    }

    const state: PlanExecutionState = {
      planId: plan.id,
      status: "draft",
      approval: { status: "pending" },
      stepStates,
      planTransitions: [{
        sequence: 1,
        from: "draft",
        to: "draft",
        at: now,
        reason: "plan created",
      }],
      timestamps: {
        createdAt: now,
      },
    };

    // Enforce the constitutional invariant at init time:
    // exactly one StepRuntimeState per plan step, no extras, no gaps
    validateStateStepIds(plan, state);

    saveState(this.dir, state);
    return state;
  }

  /** Load current execution state. Returns null if none. */
  load(planId: string): PlanExecutionState | null {
    return loadRawState(this.dir, planId);
  }

  /**
   * Atomically update execution state.
   *
   * @param planId - The plan ID.
   * @param transition - Transition metadata (from, to, reason, executionId).
   *                     sequence is auto-assigned.
   * @param mutator - Callback receives current state. MUST NOT modify
   *                  planTransitions — only the store appends transitions.
   *                  May modify stepStates, approval, status, timestamps.
   * @returns the new state after mutation.
   */
  update(
    planId: string,
    transition: Omit<PlanTransition, "sequence" | "at">,
    mutator: (s: PlanExecutionState) => PlanExecutionState,
  ): PlanExecutionState {
    const current = loadRawState(this.dir, planId);
    if (!current) throw new Error(`Execution state not found: ${planId}`);

    // Compute hash of transitions BEFORE mutation (defense against in-place mutation)
    const beforeHash = JSON.stringify(current.planTransitions);

    // Apply mutator (deep clone prevents side effects on the original).
    // Using JSON.parse(JSON.stringify) rather than structuredClone because
    // structuredClone loses methods/functions (irrelevant here) and has
    // inconsistent Node.js support across minor versions. JSON round-trip
    // is slower but completely deterministic. If a future implementer wants
    // to "modernize" this, verify that Node >= 22 supports all edge cases
    // (circular refs, TypedArrays, Map, Set) — none of which exist here.
    const mutated: PlanExecutionState = mutator(JSON.parse(JSON.stringify(current)));

    // Validate mutator did not touch transitions (hash comparison, not just length
    // — a length check misses in-place mutations like planTransitions[0].reason = "evil")
    const afterHash = JSON.stringify(mutated.planTransitions);
    if (beforeHash !== afterHash) {
      throw new Error(
        "Mutator MUST NOT modify planTransitions — only the store appends transitions",
      );
    }

    // Append the transition with next sequence number
    const nextSeq = current.planTransitions.length > 0
      ? current.planTransitions[current.planTransitions.length - 1].sequence + 1
      : 1;
    mutated.planTransitions.push({
      sequence: nextSeq,
      ...transition,
      at: new Date().toISOString(),
    });

    // Update plan-level status if status changed in this transition
    if (transition.from !== transition.to) {
      mutated.status = transition.to;

      // Explicit status→timestamp mapping (NOT a dynamic cast — that would
      // silently accept unknown status values like "paused" and create
      // unreachable timestamp keys)
      const STATUS_TIMESTAMP_MAP: Partial<Record<PlanStatus, keyof PlanExecutionState["timestamps"]>> = {
        approved: "approvedAt",
        running: "runningAt",
        completed: "completedAt",
        failed: "failedAt",
        blocked: "blockedAt",
        cancelled: "cancelledAt",
      };
      const tsKey = STATUS_TIMESTAMP_MAP[transition.to];
      if (tsKey && !mutated.timestamps[tsKey]) {
        (mutated.timestamps as Record<string, string | undefined>)[tsKey] = mutated.planTransitions[mutated.planTransitions.length - 1].at;
      }
    }

    // Set lastExecutionId
    if (transition.executionId) {
      mutated.lastExecutionId = transition.executionId;
    }

    saveState(this.dir, mutated);
    return mutated;
  }
}
