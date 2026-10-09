// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.2 — Logical Clock.
 *
 * Provides a controlled, deterministic timeline for replay execution.
 * Replaces wall-clock time with a monotonically increasing tick counter,
 * so that replay behaviour is reproducible regardless of when the run
 * executes.
 *
 * @module logical-clock
 */

// ---------------------------------------------------------------------------
// LogicalClockSnapshot
// ---------------------------------------------------------------------------

export interface LogicalClockSnapshot {
  currentTick: number;
  startTime: number;
}

// ---------------------------------------------------------------------------
// LogicalClock
// ---------------------------------------------------------------------------

/**
 * Deterministic logical clock for replay execution.
 *
 * The clock advances only when explicitly ticked — never via wall-clock
 * time. This ensures that two replay runs with the same tick sequence
 * observe identical logical times.
 *
 * @invariant Ticks are monotonically increasing.
 * @invariant reset() restores the initial state exactly.
 * @invariant snapshot()/restore() round-trip losslessly.
 */
export class LogicalClock {
  private currentTick: number;
  private readonly startTime: number;

  /**
   * @param startTime - Optional anchor wall-clock value (purely informational;
   *                    the clock does not use wall-clock for advancement).
   */
  constructor(startTime: number = 0) {
    this.startTime = startTime;
    this.currentTick = 0;
  }

  /**
   * Advance the clock by one tick and return the new logical time.
   */
  tick(): number {
    this.currentTick += 1;
    return this.now();
  }

  /**
   * Advance the clock by N ticks and return the new logical time.
   */
  advance(steps: number): number {
    if (!Number.isFinite(steps) || steps < 0) {
      throw new Error(`advance() requires a non-negative finite number, got: ${steps}`);
    }
    this.currentTick += Math.floor(steps);
    return this.now();
  }

  /**
   * Get current logical time without advancing.
   */
  now(): number {
    return this.currentTick;
  }

  /**
   * Get the anchor start time (informational).
   */
  getStartTime(): number {
    return this.startTime;
  }

  /**
   * Reset to initial state (tick 0).
   */
  reset(): void {
    this.currentTick = 0;
  }

  /**
   * Serialize current state for deterministic reconstruction.
   */
  snapshot(): LogicalClockSnapshot {
    return { currentTick: this.currentTick, startTime: this.startTime };
  }

  /**
   * Restore from a previous snapshot.
   */
  restore(snapshot: LogicalClockSnapshot): void {
    this.currentTick = snapshot.currentTick;
  }
}
