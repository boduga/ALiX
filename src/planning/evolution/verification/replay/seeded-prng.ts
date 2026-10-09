// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.2 — Seeded PRNG.
 *
 * Deterministic pseudo-random number generator for replay execution.
 * Replaces Math.random() with a seeded source so that replay behaviour
 * requiring randomness is reproducible.
 *
 * Uses mulberry32 — a simple, fast, deterministic 32-bit PRNG.
 *
 * @module seeded-prng
 */

// ---------------------------------------------------------------------------
// SeededPRNGSnapshot
// ---------------------------------------------------------------------------

export interface SeededPRNGSnapshot {
  seed: number;
  state: number;
}

// ---------------------------------------------------------------------------
// SeededPRNG
// ---------------------------------------------------------------------------

/**
 * Deterministic seeded PRNG for replay execution.
 *
 * @invariant Same seed produces the same sequence.
 * @invariant Different seeds produce different sequences.
 * @invariant reset() restores the initial state exactly.
 */
export class SeededPRNG {
  private readonly seed: number;
  private state: number;

  constructor(seed: number) {
    if (!Number.isFinite(seed)) {
      throw new Error(`SeededPRNG requires a finite seed, got: ${seed}`);
    }
    this.seed = Math.floor(seed) >>> 0;
    this.state = this.seed;
  }

  /**
   * Return a float in [0, 1).
   *
   * Uses mulberry32 — deterministic across all JS runtimes.
   */
  next(): number {
    let t = (this.state += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Return an integer in [min, max] inclusive.
   */
  nextInt(min: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      throw new Error(`nextInt requires min <= max, got min=${min} max=${max}`);
    }
    const range = max - min + 1;
    return Math.floor(this.next() * range) + Math.floor(min);
  }

  /**
   * Reset to the initial seed state.
   */
  reset(): void {
    this.state = this.seed;
  }

  /**
   * Get the original seed.
   */
  getSeed(): number {
    return this.seed;
  }

  /**
   * Serialize current state for deterministic reconstruction.
   */
  snapshot(): SeededPRNGSnapshot {
    return { seed: this.seed, state: this.state };
  }

  /**
   * Restore from a previous snapshot.
   */
  restore(snapshot: SeededPRNGSnapshot): void {
    this.state = snapshot.state >>> 0;
  }
}
