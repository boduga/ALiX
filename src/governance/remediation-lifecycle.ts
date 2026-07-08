/**
 * P17.1 — Remediation Lifecycle Transitions.
 *
 * Pure state machine for remediation proposal lifecycle.
 * No stores, no CLI, no execution plans, no audit imports.
 */

export type RemediationLifecycleState =
  | "open"
  | "accepted"
  | "dismissed"
  | "resolved"
  | "superseded";

const TERMINAL: ReadonlySet<RemediationLifecycleState> = new Set([
  "dismissed",
  "resolved",
  "superseded",
]);

/** Valid transitions. Key = `${current}->${target}`. */
const VALID_TRANSITIONS: ReadonlySet<string> = new Set([
  "open->accepted",
  "open->dismissed",
  "open->superseded",
  "accepted->resolved",
  "accepted->superseded",
]);

export interface RemediationTransitionResult {
  newState: RemediationLifecycleState;
  transitionedAt: string;
}

export class InvalidTransitionError extends Error {
  constructor(current: string, target: string) {
    super(`Invalid lifecycle transition: ${current} → ${target}`);
    this.name = "InvalidTransitionError";
  }
}

/**
 * Attempt a lifecycle transition on a remediation proposal.
 *
 * @param currentState - Current lifecycle state.
 * @param targetState - Desired new state.
 * @param options - Optional injected timestamp.
 * @returns Result with new state and timestamp.
 * @throws {InvalidTransitionError} if transition is not allowed.
 */
export function transitionRemediationState(
  currentState: RemediationLifecycleState,
  targetState: RemediationLifecycleState,
  options?: { now?: string },
): RemediationTransitionResult {
  if (TERMINAL.has(currentState)) {
    throw new InvalidTransitionError(currentState, targetState);
  }

  const key = `${currentState}->${targetState}`;
  if (!VALID_TRANSITIONS.has(key)) {
    throw new InvalidTransitionError(currentState, targetState);
  }

  return {
    newState: targetState,
    transitionedAt: options?.now ?? new Date().toISOString(),
  };
}
