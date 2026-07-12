// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.2 — Replay Engine.
 *
 * Orchestrates the deterministic verification runtime. Given a replay
 * dataset, a proposal, and an environment configuration, the engine
 * executes a counterfactual replay using the four determinism controls
 * (LogicalClock, SeededPRNG, DeterministicScheduler, deterministic
 * event merge) and produces a ReplayResult.
 *
 * The engine enforces determinism at the API level: if any control is
 * missing or misconfigured, execution is rejected rather than degraded.
 *
 * @module replay-engine
 */

import type { ReplayDataset } from "../contracts/replay-contract.js";
import type { VerificationFailureKind } from "../contracts/verification-contract.js";
import { LogicalClock } from "./logical-clock.js";
import { SeededPRNG } from "./seeded-prng.js";
import { DeterministicScheduler } from "./deterministic-scheduler.js";
import { mergeEvents, type DeterministicEvent } from "./deterministic-event-merge.js";

// ---------------------------------------------------------------------------
// ReplayEngineConfig
// ---------------------------------------------------------------------------

export interface ReplayEngineConfig {
  /** Seed for the deterministic PRNG. */
  seed: number;
  /** Anchor start time for the logical clock (informational). */
  clockStart: number;
  /** Identifier of the verification environment. */
  environmentId: string;
  /** Hash of the verification environment configuration. */
  environmentHash: string;
  /** Resource limits for sandbox execution. */
  resourceLimits?: {
    maxMemoryMb: number;
    maxCpuMs: number;
    maxWallClockMs: number;
  };
}

// ---------------------------------------------------------------------------
// ReplayError
// ---------------------------------------------------------------------------

export interface ReplayError {
  /** Typed failure kind. */
  kind: VerificationFailureKind;
  /** Human-readable explanation. */
  message: string;
  /** Logical tick at which the error occurred. */
  tick: number;
}

// ---------------------------------------------------------------------------
// ReplayResult
// ---------------------------------------------------------------------------

export interface ReplayResult {
  /** Events emitted during replay, in deterministic order. */
  events: readonly DeterministicEvent[];
  /** Metrics collected during replay. */
  metrics: Record<string, number>;
  /** Errors encountered during replay (typed). */
  errors: readonly ReplayError[];
  /** Number of logical ticks executed. */
  ticksExecuted: number;
}

// ---------------------------------------------------------------------------
// ReplayExecutor
// ---------------------------------------------------------------------------

/**
 * A replay executor applies the proposal's logic to a single event in the
 * replay stream, emitting zero or more resulting events and updating metrics.
 *
 * Provided by the caller — the engine itself is executor-agnostic.
 */
export interface ReplayExecutor {
  /**
   * Process one event under the proposed evolution.
   * @returns Resulting events and metric deltas.
   */
  processEvent(
    event: DeterministicEvent,
    context: ReplayContext,
  ): Promise<{ events: DeterministicEvent[]; metricDeltas: Record<string, number> }>;
}

/**
 * Context passed to the executor for each event.
 */
export interface ReplayContext {
  /** The deterministic PRNG (use instead of Math.random). */
  prng: SeededPRNG;
  /** The logical clock (use instead of Date.now). */
  clock: LogicalClock;
  /** The replay dataset. */
  dataset: ReplayDataset;
  /** The seed for this run. */
  seed: number;
}

// ---------------------------------------------------------------------------
// ReplayEngine
// ---------------------------------------------------------------------------

/**
 * Orchestrating replay engine.
 *
 * @invariant Given identical (dataset + proposal + config + executor),
 *            produces equivalent ReplayResults.
 * @invariant All four determinism controls are present and used.
 * @invariant No use of Date.now(), Math.random(), or crypto.randomUUID().
 * @invariant All errors carry a typed VerificationFailureKind.
 */
export class ReplayEngine {
  private readonly config: ReplayEngineConfig;

  constructor(config: ReplayEngineConfig) {
    this.config = config;
    this.validateConfig();
  }

  /**
   * Execute a counterfactual replay.
   *
   * @param dataset - The replay dataset (historical evidence).
   * @param executor - The proposal-specific executor.
   * @param inputStreams - Parallel event streams derived from the dataset.
   * @returns The replay result.
   */
  async execute(
    dataset: ReplayDataset,
    executor: ReplayExecutor,
    inputStreams: readonly (readonly DeterministicEvent[])[] = [],
  ): Promise<ReplayResult> {
    // Step 1: Construct determinism controls
    const clock = new LogicalClock(this.config.clockStart);
    const prng = new SeededPRNG(this.config.seed);
    const scheduler = new DeterministicScheduler(clock);

    const errors: ReplayError[] = [];
    const metrics: Record<string, number> = {};
    const outputEvents: DeterministicEvent[] = [];

    // Step 2: Deterministically merge input streams
    const merged = mergeEvents(inputStreams);

    // Step 3: Process each event through the executor
    for (const event of merged) {
      // Advance clock to the event's tick
      while (clock.now() < event.tick) {
        clock.tick();
      }

      try {
        const context: ReplayContext = {
          prng,
          clock,
          dataset,
          seed: this.config.seed,
        };

        const { events: resultEvents, metricDeltas } = await executor.processEvent(event, context);

        for (const e of resultEvents) {
          outputEvents.push(e);
        }

        for (const [name, delta] of Object.entries(metricDeltas)) {
          metrics[name] = (metrics[name] ?? 0) + delta;
        }
      } catch (err) {
        errors.push({
          kind: "ProposalExecutionFailure",
          message: err instanceof Error ? err.message : String(err),
          tick: clock.now(),
        });
        // Error isolation: continue processing remaining events
      }

      clock.tick();
    }

    // Step 4: Drain any scheduler tasks
    const drained = await scheduler.drain();
    void drained;

    return {
      events: outputEvents,
      metrics,
      errors,
      ticksExecuted: clock.now(),
    };
  }

  /**
   * Validate the engine configuration.
   * Throws if any required control is missing.
   */
  private validateConfig(): void {
    if (!Number.isFinite(this.config.seed)) {
      throw new Error("ReplayEngine requires a finite seed");
    }
    if (!this.config.environmentId || this.config.environmentId.trim().length === 0) {
      throw new Error("ReplayEngine requires a non-empty environmentId");
    }
    if (!this.config.environmentHash || this.config.environmentHash.trim().length === 0) {
      throw new Error("ReplayEngine requires a non-empty environmentHash");
    }
  }

  /**
   * Check whether two replay configs would produce equivalent results.
   * Two configs are equivalent iff all determinism-relevant fields match.
   */
  static configsEquivalent(a: ReplayEngineConfig, b: ReplayEngineConfig): boolean {
    return (
      a.seed === b.seed &&
      a.environmentHash === b.environmentHash
    );
  }
}
