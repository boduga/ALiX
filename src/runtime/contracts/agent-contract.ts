// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * M1.2 — Runtime Agent Contract
 *
 * Defines the contract for agent lifecycle types, run limits, and scope
 * tracking in the ALiX system.  Every consumer of agent state, run results,
 * or scope management MUST adhere to these types and interfaces.
 *
 * This contract mirrors the concrete types in
 * {@link ../../autonomy/scope-tracker.ts} and
 * {@link ../../autonomy/state-machine.ts}.  It exists as the single source
 * of truth that downstream consumers (stores, governance, dashboards) depend
 * on — the implementation files are the reference, this contract is the
 * interface that must not drift.
 *
 * ─────────────── AGENT STATE INVARIANTS ───────────────
 *
 * The agent state machine follows a strict lifecycle.  Every state transition
 * is governed by the TaskStateMachine and guarded by RunLimits:
 *
 *   - **Total states:** Exactly 10 states.  The set is closed — no consumer
 *     may introduce a new state without updating this contract.
 *   - **Linear progress:** States progress from `idle` through `planning`,
 *     `executing`, `verifying`, and finally `completed` or `failed`.
 *     `repairing` loops back to `executing`; `waiting_approval` suspends
 *     until resumed.
 *   - **Terminal sink:** `stopped` is a hard terminal state entered when
 *     a limit is exceeded.  No transitions leave `stopped`.
 *   - **No concurrent states:**  The agent occupies exactly one state at
 *     any time.
 *   - **Scope governs mutation:**  A file write outside the initial scope
 *     requires explicit approval via `ScopeTracker`.  No mutation is
 *     permitted while `pendingApproval` is non-null.
 *   - **Run limits are enforced at every transition:**  `maxIterations`,
 *     `maxRepairs`, and `maxRuntimeMs` are checked before any state change.
 *
 * These invariants are enforced structurally by the `TaskStateMachine` and
 * `RunLimiter` implementations and by this contract's type definitions —
 * there is no runtime enforcement layer that validates them after the fact.
 *
 * @module agent-contract
 */

import type { AgentState as SourceAgentState } from "../../autonomy/scope-tracker.js";
import type {
  TaskScope as SourceTaskScope,
  ScopeSnapshot as SourceScopeSnapshot,
  Expansion as SourceExpansion,
  ChangeEvaluation as SourceChangeEvaluation,
} from "../../autonomy/scope-tracker.js";
import type {
  RunLimits as SourceRunLimits,
  RunCounters as SourceRunCounters,
  StateSnapshot as SourceStateSnapshot,
  RunResult as SourceRunResult,
} from "../../autonomy/state-machine.js";
import type { AgentContext as SourceAgentContext } from "../../agent/agent.js";

// ─── Core Agent Types ─────────────────────────────────────────────

/**
 * The ten agent lifecycle states.
 *
 * Matches {@link AgentState} in `src/autonomy/scope-tracker.ts` exactly.
 *
 * | # | State              | Description                                         |
 * |---|--------------------|-----------------------------------------------------|
 * | 1 | `idle`             | Agent is inactive, awaiting a task.                 |
 * | 2 | `planning`         | Agent is constructing a plan from the task.         |
 * | 3 | `executing`        | Agent is carrying out plan steps (files, shell).    |
 * | 4 | `verifying`        | Agent is verifying that changes meet requirements.  |
 * | 5 | `repairing`        | Agent is fixing a verification failure.             |
 * | 6 | `summarizing`      | Agent is producing a final summary.                 |
 * | 7 | `waiting_approval` | Agent is paused awaiting user approval.             |
 * | 8 | `completed`        | Agent finished successfully.                        |
 * | 9 | `failed`           | Agent encountered an unrecoverable error.            |
 * |10 | `stopped`          | Agent was halted by a run limit.                    |
 */
export type AgentState = SourceAgentState;

/**
 * The initial scope of work assigned to the agent.
 *
 * Matches {@link TaskScope} in `src/autonomy/scope-tracker.ts` exactly.
 * Every agent run starts with a scope.  Any file mutation outside this
 * scope triggers a scope expansion workflow.
 *
 * @property goal     - The natural-language goal of the task.
 * @property files    - File paths the agent is permitted to touch.
 * @property approvedAt - ISO timestamp of when scope was approved, if any.
 */
export type TaskScope = SourceTaskScope;

/**
 * A record of a scope expansion event.
 *
 * Matches {@link Expansion} in `src/autonomy/scope-tracker.ts` exactly.
 * Created whenever the agent accesses a file outside the initial scope.
 */
export type Expansion = SourceExpansion;

/**
 * Result of evaluating a proposed change against the current scope.
 *
 * Matches {@link ChangeEvaluation} in `src/autonomy/scope-tracker.ts` exactly.
 */
export type ChangeEvaluation = SourceChangeEvaluation;

/**
 * Serialisable snapshot of scope tracker state.
 *
 * Matches {@link ScopeSnapshot} in `src/autonomy/scope-tracker.ts` exactly.
 */
export type ScopeSnapshot = SourceScopeSnapshot;

// ─── Run Limit Types ──────────────────────────────────────────────

/**
 * Hard limits for an agent run.
 *
 * Matches {@link RunLimits} in `src/autonomy/state-machine.ts` exactly.
 * All limits are enforced at every state transition.  A value of 0 means
 * the limit is disabled.
 */
export type RunLimits = SourceRunLimits;

/**
 * Current counters for a running agent.
 *
 * Matches {@link RunCounters} in `src/autonomy/state-machine.ts` exactly.
 * Counters are monotonic and never decrease for the lifetime of the run.
 */
export type RunCounters = SourceRunCounters;

/**
 * Snapshot of the state machine at a point in time.
 *
 * Matches {@link StateSnapshot} in `src/autonomy/state-machine.ts` exactly.
 */
export type StateSnapshot = SourceStateSnapshot;

/**
 * Terminal result of an agent run.
 *
 * Matches {@link RunResult} in `src/autonomy/state-machine.ts` exactly.
 * Produced by `TaskStateMachine.stop()` or `TaskStateMachine.complete()`.
 */
export type RunResult = SourceRunResult;

// ─── Agent Context ────────────────────────────────────────────────

/**
 * Full runtime context for an agent session.
 *
 * Matches {@link AgentContext} in `src/agent/agent.ts` exactly.
 * Provides access to all services the agent needs during execution.
 */
export type AgentContext = SourceAgentContext;

// ─── ScopeTracker Contract Interface ─────────────────────────────

/**
 * Contract for the scope tracking layer.
 *
 * Maps 1:1 to the `ScopeTracker` class in
 * `src/autonomy/scope-tracker.ts`.  Every method signature matches the
 * concrete implementation so that consumers coded against this interface
 * can swap implementations or be tested with a mock.
 *
 * Scope tracking governs the invariant that file mutations stay within
 * the task's initial boundary.  Any access to a path outside the initial
 * file set produces `"scope_expansion"`, which must be resolved via
 * `approveScope` or `denyScope` before execution can proceed.
 */
export interface ScopeTrackerContract {
  /** The path currently pending approval, or null if none. */
  readonly pendingApproval: string | null;

  /**
   * Set the initial scope for this tracker.
   * Resets all tracked expansions, approvals, and denials.
   */
  setInitialScope(scope: TaskScope): void;

  /**
   * Return the current scope, or undefined if none has been set.
   */
  getCurrentScope(): TaskScope | undefined;

  /**
   * Check whether a file path may be mutated.
   *
   * @returns `"allowed"` if the path is within scope,
   *          `"approved"` if it was previously approved,
   *          `"denied"` if it was previously denied,
   *          `"scope_expansion"` if it requires approval.
   */
  checkMutation(path: string): "allowed" | "denied" | "scope_expansion" | "approved";

  /**
   * Mark a path as approved for mutation.
   * Clears the pending approval.
   */
  approveScope(path: string): void;

  /**
   * Mark a path as denied for mutation.
   * Clears the pending approval.
   */
  denyScope(path: string): void;

  /**
   * Set or clear the pending approval path.
   */
  setPending(path: string, pending?: boolean): void;

  /**
   * Detect scope expansion by comparing current files against initial scope.
   * Pushes an Expansion record if new files are found.
   */
  checkExpansion(current: { files?: string[] }): void;

  /**
   * Return all recorded expansions (copy).
   */
  getExpansions(): Expansion[];

  /**
   * Check whether a change set requires user confirmation.
   * Returns true when files have grown beyond the initial scope
   * and the scope has not yet been approved.
   */
  needsConfirmation(current: { files?: string[] }): boolean;

  /**
   * Evaluate a proposed change against the current scope.
   * Returns an evaluation result with approval decision and reason.
   */
  evaluateChange(change: { files?: string[] }): ChangeEvaluation;

  /**
   * Confirm scope expansion, marking the scope as approved.
   * Clears expansions morelist.
   */
  confirmExpansion(): void;

  /** Serialise to a plain object for persistence. */
  toJSON(): ScopeSnapshot;
}

// ─── RunLimiter Contract Interface ────────────────────────────────

/**
 * Context object passed to transition guards.
 *
 * Mirrors the un-exported `TransitionContext` type in
 * `src/autonomy/state-machine.ts` exactly — this contract re-defines
 * the shape so consumers need not reference the internal type.
 */
export type RunTransitionContext = {
  state: AgentState;
  counters: RunCounters;
  scopeExpanded: boolean;
  verificationPassed: boolean;
  modelSignaledDone: boolean;
  pendingScopeFile: string | null;
};

/**
 * Contract for the run-limiter layer.
 *
 * Maps 1:1 to the `RunLimiter` class in
 * `src/autonomy/state-machine.ts`.
 */
export interface RunLimiterContract {
  /**
   * Check whether a transition is allowed given the current counters.
   * Returns `{ allowed: false, reason }` when a limit is exceeded.
   */
  canTransition(
    from: AgentState,
    to: AgentState,
    ctx: RunTransitionContext,
  ): { allowed: boolean; reason?: string };

  /**
   * Check whether a specific counter has reached its limit.
   */
  checkCounter(limit: keyof RunLimits, value: number): boolean;
}

// ─── TaskStateMachine Contract Interface ──────────────────────────

/**
 * Contract for the task state machine.
 *
 * Maps 1:1 to the `TaskStateMachine` class in
 * `src/autonomy/state-machine.ts`.
 */
export interface TaskStateMachineContract {
  /** The current state of the agent. */
  readonly currentState: AgentState;

  /** Snapshot of the current run counters. */
  readonly snapshot: RunCounters;

  /** Advance iteration counter and add runtime. */
  tick(runtimeMs: number): void;

  /** Increment file change counter. */
  recordFileChange(): void;

  /** Increment shell command counter. */
  recordShellCommand(): void;

  /** Increment repair counter. */
  recordRepair(): void;

  /** Transition to executing (from planning). */
  toExecuting(scopeExpanded: boolean): { allowed: boolean; reason?: string };

  /** Transition to verifying (from executing or repairing). */
  toVerifying(verificationPassed: boolean): { allowed: boolean; reason?: string };

  /** Transition to repairing (from verifying). */
  toRepairing(): { allowed: boolean; reason?: string };

  /** Transition to summarising (from verifying). */
  toSummarizing(): { allowed: boolean; reason?: string };

  /** Hard stop — reached a limit.  Produces a terminal RunResult. */
  stop(reason: string): RunResult;

  /** Normal completion.  Produces a terminal RunResult. */
  complete(): RunResult;

  /** Serialise to a plain object for persistence. */
  toJSON(): StateSnapshot;
}

// ─── Invariants ──────────────────────────────────────────────────

/**
 * Agent state invariants: the type-level constant version.
 * Used by contract consumers to assert the invariants at compile time.
 */
export type AgentInvariantsAssertion = {
  readonly totalStates: 10;
  readonly states: readonly [
    "idle",
    "planning",
    "executing",
    "verifying",
    "repairing",
    "summarizing",
    "waiting_approval",
    "completed",
    "failed",
    "stopped",
  ];
  readonly noConcurrentStates: true;
  readonly scopeGovernsMutation: true;
  readonly limitsEnforcedAtTransitions: true;
  readonly terminalSinkIsStopped: true;
};

/**
 * Singleton asserting all agent-state invariants are active.
 * Consumers that depend on the state machine shape can reference
 * this value as a documentary anchor.
 */
export const AGENT_INVARIANTS: AgentInvariantsAssertion = {
  totalStates: 10,
  states: [
    "idle",
    "planning",
    "executing",
    "verifying",
    "repairing",
    "summarizing",
    "waiting_approval",
    "completed",
    "failed",
    "stopped",
  ],
  noConcurrentStates: true,
  scopeGovernsMutation: true,
  limitsEnforcedAtTransitions: true,
  terminalSinkIsStopped: true,
} as const;

// ─── (No runtime code in this file — pure type exports, re-exports,
//        and a const assertion that serves as documentary anchor.) ──
