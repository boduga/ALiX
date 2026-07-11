/**
 * A0.2 — Evolution Lifecycle State Machine.
 *
 * Manages deterministic lifecycle transitions for evolution workflows.
 * Validates every transition against the allowed map, enforces terminal
 * state immutability, and generates typed transition events for
 * downstream consumption by A0.3.
 *
 * A0.2 owns lifecycle behavior. It does not persist evidence — transition
 * events are consumed by A0.3 to produce X2/X3b-compatible evidence records.
 *
 * @module evolution-state-machine
 */

import {
  EvolutionState,
  EVOLUTION_TERMINAL_STATES,
} from "./contracts/evolution-contract.js";

// ---------------------------------------------------------------------------
// Transition Event Types
// ---------------------------------------------------------------------------

export interface EvolutionTransitionEvent {
  evolutionId: string;
  from: EvolutionState;
  to: EvolutionState;
  eventType: string;
  timestamp: string;
  summary: string;
}

export interface EvolutionTransitionResult {
  previous: EvolutionState;
  current: EvolutionState;
  event: EvolutionTransitionEvent;
}

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

export class IllegalEvolutionTransitionError extends Error {
  readonly kind = "IllegalEvolutionTransitionError" as const;
  readonly evolutionId: string;
  readonly currentState: EvolutionState;
  readonly requestedState: EvolutionState;

  constructor(evolutionId: string, currentState: EvolutionState, requestedState: EvolutionState) {
    super(
      `Illegal evolution transition: ${currentState} → ${requestedState} for evolution ${evolutionId}`,
    );
    this.name = "IllegalEvolutionTransitionError";
    this.evolutionId = evolutionId;
    this.currentState = currentState;
    this.requestedState = requestedState;
  }
}

export class UnknownEvolutionError extends Error {
  readonly kind = "UnknownEvolutionError" as const;
  readonly evolutionId: string;

  constructor(evolutionId: string) {
    super(`Unknown evolution: ${evolutionId}`);
    this.name = "UnknownEvolutionError";
    this.evolutionId = evolutionId;
  }
}

export class DuplicateEvolutionError extends Error {
  readonly kind = "DuplicateEvolutionError" as const;
  readonly evolutionId: string;

  constructor(evolutionId: string) {
    super(`Duplicate evolution: ${evolutionId}`);
    this.name = "DuplicateEvolutionError";
    this.evolutionId = evolutionId;
  }
}

// ---------------------------------------------------------------------------
// Terminal states
// ---------------------------------------------------------------------------

const TERMINAL = new Set<EvolutionState>(EVOLUTION_TERMINAL_STATES);

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<EvolutionState, EvolutionState[]> = {
  [EvolutionState.DRAFT]: [EvolutionState.PROPOSED, EvolutionState.WITHDRAWN],
  [EvolutionState.PROPOSED]: [EvolutionState.UNDER_REVIEW, EvolutionState.REJECTED],
  [EvolutionState.UNDER_REVIEW]: [EvolutionState.APPROVED, EvolutionState.REJECTED, EvolutionState.WITHDRAWN],
  [EvolutionState.APPROVED]: [EvolutionState.IMPLEMENTING, EvolutionState.REJECTED],
  [EvolutionState.REJECTED]: [],
  [EvolutionState.WITHDRAWN]: [],
  [EvolutionState.IMPLEMENTING]: [EvolutionState.VALIDATING, EvolutionState.FAILED_VALIDATION],
  [EvolutionState.VALIDATING]: [EvolutionState.ACTIVE, EvolutionState.FAILED_VALIDATION],
  [EvolutionState.ACTIVE]: [],
  [EvolutionState.FAILED_VALIDATION]: [EvolutionState.ROLLED_BACK, EvolutionState.ACTIVE],
  [EvolutionState.ROLLED_BACK]: [],
};

// ---------------------------------------------------------------------------
// Event type mapping
// ---------------------------------------------------------------------------

const EVENT_TYPE_MAP: Record<EvolutionState, string> = {
  [EvolutionState.DRAFT]: "EvolutionDrafted",
  [EvolutionState.PROPOSED]: "EvolutionProposed",
  [EvolutionState.UNDER_REVIEW]: "EvolutionSentForReview",
  [EvolutionState.APPROVED]: "EvolutionApproved",
  [EvolutionState.REJECTED]: "EvolutionRejected",
  [EvolutionState.WITHDRAWN]: "EvolutionWithdrawn",
  [EvolutionState.IMPLEMENTING]: "EvolutionImplementationBegan",
  [EvolutionState.VALIDATING]: "EvolutionValidationBegan",
  [EvolutionState.ACTIVE]: "EvolutionActivated",
  [EvolutionState.FAILED_VALIDATION]: "EvolutionFailedValidation",
  [EvolutionState.ROLLED_BACK]: "EvolutionRolledBack",
};

// ---------------------------------------------------------------------------
// EvolutionStateMachine
// ---------------------------------------------------------------------------

export class EvolutionStateMachine {
  private readonly evolutions = new Map<string, EvolutionState>();
  private readonly history = new Map<string, EvolutionTransitionEvent[]>();

  // -----------------------------------------------------------------------
  // Creation
  // -----------------------------------------------------------------------

  /**
   * Register a new evolution in its initial state.
   *
   * @param evolutionId - Unique identifier for the evolution.
   * @param initialState - Starting state (defaults to DRAFT).
   * @throws {DuplicateEvolutionError} If evolutionId already exists.
   */
  createEvolution(evolutionId: string, initialState: EvolutionState = EvolutionState.DRAFT): void {
    if (this.evolutions.has(evolutionId)) {
      throw new DuplicateEvolutionError(evolutionId);
    }
    this.evolutions.set(evolutionId, initialState);
    this.history.set(evolutionId, []);

    // Emit the initial creation event
    const event = this.buildTransitionEvent(evolutionId, initialState, initialState);
    this.history.get(evolutionId)!.push(event);
  }

  // -----------------------------------------------------------------------
  // Transition
  // -----------------------------------------------------------------------

  /**
   * Attempt a validated state transition.
   *
   * Validates the transition against the allowed map and terminal
   * state rules before modifying state. On success, generates a
   * transition event and returns the result. On failure, state and
   * history are not modified.
   *
   * @param evolutionId - The evolution to transition.
   * @param to - The target state.
   * @returns EvolutionTransitionResult with previous/current state and event.
   * @throws {UnknownEvolutionError} If evolutionId does not exist.
   * @throws {IllegalEvolutionTransitionError} If transition is not allowed.
   */
  transition(evolutionId: string, to: EvolutionState): EvolutionTransitionResult {
    this.requireEvolution(evolutionId);
    const from = this.evolutions.get(evolutionId)!;

    if (!this.isTransitionAllowed(from, to)) {
      throw new IllegalEvolutionTransitionError(evolutionId, from, to);
    }

    this.evolutions.set(evolutionId, to);
    const event = this.buildTransitionEvent(evolutionId, from, to);
    this.history.get(evolutionId)!.push(event);

    return {
      previous: from,
      current: to,
      event,
    };
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * Get the current lifecycle state of an evolution.
   *
   * @param evolutionId - The evolution to query.
   * @returns Current EvolutionState.
   * @throws {UnknownEvolutionError} If evolutionId does not exist.
   */
  getStatus(evolutionId: string): EvolutionState {
    this.requireEvolution(evolutionId);
    return this.evolutions.get(evolutionId)!;
  }

  /**
   * Get the ordered transition history for an evolution.
   * Events are in chronological order (oldest first).
   *
   * @param evolutionId - The evolution to query.
   * @returns Array of EvolutionTransitionEvents.
   * @throws {UnknownEvolutionError} If evolutionId does not exist.
   */
  getHistory(evolutionId: string): EvolutionTransitionEvent[] {
    this.requireEvolution(evolutionId);
    return [...this.history.get(evolutionId)!];
  }

  // -----------------------------------------------------------------------
  // Validation helpers
  // -----------------------------------------------------------------------

  /**
   * Check whether a transition from one state to another is allowed
   * by the transition table and terminal state rules.
   *
   * Pure — no side effects.
   */
  private isTransitionAllowed(from: EvolutionState, to: EvolutionState): boolean {
    if (TERMINAL.has(from)) return false;
    const allowed = ALLOWED_TRANSITIONS[from];
    return allowed.includes(to);
  }

  private requireEvolution(evolutionId: string): void {
    if (!this.evolutions.has(evolutionId)) {
      throw new UnknownEvolutionError(evolutionId);
    }
  }

  // -----------------------------------------------------------------------
  // Event building
  // -----------------------------------------------------------------------

  private buildTransitionEvent(
    evolutionId: string,
    from: EvolutionState,
    to: EvolutionState,
  ): EvolutionTransitionEvent {
    const eventType = EVENT_TYPE_MAP[to];
    return {
      evolutionId,
      from,
      to,
      eventType,
      timestamp: new Date().toISOString(),
      summary: `Evolution ${eventType}: ${from} → ${to}`,
    };
  }
}
