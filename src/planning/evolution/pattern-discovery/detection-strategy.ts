// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A1.1 — DetectionStrategy Interface.
 *
 * Pure interface for stateless detection strategies. Each strategy owns
 * exactly one detection algorithm, inspects the run-scoped DiscoveryContext,
 * and emits PatternObservation results.
 *
 * @module detection-strategy
 */

import type {
  PatternCategory,
  PatternObservation,
} from "../contracts/pattern-discovery-contract.js";
import type {
  DiscoveryContext,
} from "../contracts/discovery-context.js";

/**
 * Stateless detection strategy interface.
 *
 * Strategies are stateless analyzers — each owns exactly one detection
 * algorithm, emits only PatternObservation, and does not communicate
 * with other strategies.
 *
 * @invariant Strategies are stateless — no mutable state between runs.
 * @invariant Each strategy owns exactly one detection algorithm.
 * @invariant Strategies emit only PatternObservation.
 */
export interface DetectionStrategy {
  /** Human-readable strategy name. */
  readonly name: string;

  /** Category of patterns this strategy detects. */
  readonly category: PatternCategory;

  /**
   * Run detection against the given context.
   *
   * Called once per discovery run by the PatternDiscoveryEngine with the
   * shared run-scoped context. Returns discovered pattern observations.
   *
   * @param context - Immutable run-scoped context shared across strategies
   * @returns Discovered pattern observations
   */
  run(
    context: DiscoveryContext
  ): Promise<readonly PatternObservation[]>;
}
