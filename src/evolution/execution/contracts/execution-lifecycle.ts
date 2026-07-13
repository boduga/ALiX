// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A4.0 — Execution Lifecycle Types.
 *
 * Defines the execution state machine: lifecycle states, terminal
 * states, and state validation utilities.
 *
 * Lifecycle: pending -> planning -> approved -> executing -> completed
 *                                          |              |
 *                                          v              v
 *                                       rolling_back -> rolled_back
 *                                          |              |
 *                                          v              v
 *                                        failed        failed
 *
 * @module execution-lifecycle
 */

import type { ValidationResult } from "../../contracts/evolution-contract.js";

// ---------------------------------------------------------------------------
// Execution State
// ---------------------------------------------------------------------------

/**
 * All possible states in the execution lifecycle.
 *
 * - `pending`: Execution requested, awaiting planning.
 * - `planning`: Execution plan being constructed.
 * - `approved`: Plan approved, awaiting execution.
 * - `executing`: Steps are being executed.
 * - `completed`: All steps executed successfully.
 * - `failed`: Execution terminated with an error.
 * - `rolling_back`: Rollback in progress.
 * - `rolled_back`: Rollback completed.
 */
export type ExecutionState =
  | "pending"
  | "planning"
  | "approved"
  | "executing"
  | "completed"
  | "failed"
  | "rolling_back"
  | "rolled_back";

// ---------------------------------------------------------------------------
// Terminal States
// ---------------------------------------------------------------------------

/**
 * States that represent the end of the execution lifecycle.
 * Once reached, no further state transitions should occur.
 */
export const EXECUTION_TERMINAL_STATES: readonly ExecutionState[] = [
  "completed",
  "failed",
  "rolled_back",
];

/**
 * All valid execution states.
 */
export const EXECUTION_ALL_STATES: readonly ExecutionState[] = [
  "pending",
  "planning",
  "approved",
  "executing",
  "completed",
  "failed",
  "rolling_back",
  "rolled_back",
];

// ---------------------------------------------------------------------------
// State Validation
// ---------------------------------------------------------------------------

/**
 * Check whether a string is a valid ExecutionState.
 */
export function isValidExecutionState(value: string): value is ExecutionState {
  return (EXECUTION_ALL_STATES as readonly string[]).includes(value);
}

/**
 * Check whether an ExecutionState is terminal.
 */
export function isExecutionTerminal(state: ExecutionState): boolean {
  return (EXECUTION_TERMINAL_STATES as readonly ExecutionState[]).includes(state);
}
