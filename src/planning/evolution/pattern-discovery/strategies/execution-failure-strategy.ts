// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A1.1 — ExecutionFailureStrategy
 *
 * Detects repeated execution failure patterns by grouping failed
 * execution evidence by normalized intent ID. Emits patterns only
 * when the failure count meets the configured minimum occurrences
 * threshold within the lookback window.
 *
 * Pure detection — no store access, no side effects, I/O only through
 * the provided DiscoveryContext.
 *
 * @module execution-failure-strategy
 */

import type { DetectionStrategy } from "../detection-strategy.js";
import type { DiscoveryContext } from "../../contracts/discovery-context.js";
import type {
  PatternObservation,
  PatternCategory,
} from "../../contracts/pattern-discovery-contract.js";
import { computeConfidence } from "../../contracts/pattern-discovery-contract.js";
import { normalizeIntentId } from "./strategy-utils.js";

// ---------------------------------------------------------------------------
// ExecutionFailureConfig
// ---------------------------------------------------------------------------

export interface ExecutionFailureConfig {
  /** Minimum failures of the same type to emit a pattern. */
  minimumOccurrences: number;
  /** How far back (in days) to consider evidence. */
  lookbackWindowDays: number;
  /** Expected baseline count for confidence scaling. */
  baselineCount: number;
}

export const DEFAULT_EXECUTION_FAILURE_CONFIG: ExecutionFailureConfig = {
  minimumOccurrences: 3,
  lookbackWindowDays: 7,
  baselineCount: 10,
};

// ---------------------------------------------------------------------------
// ExecutionFailureStrategy
// ---------------------------------------------------------------------------

/**
 * Detection strategy that identifies repeated execution failure patterns.
 *
 * Algorithm:
 * 1. Filter evidence to FAILED outcomes within the lookback window
 * 2. Normalize each intent ID (strip after final `/`)
 * 3. Group failures by normalized intent ID
 * 4. Emit PatternObservation only if `failureCount >= minimumOccurrences`
 *
 * @invariant Stateless — no mutable state between runs.
 * @invariant No store access — receives all data through DiscoveryContext.
 */
export class ExecutionFailureStrategy implements DetectionStrategy {
  readonly name = "ExecutionFailureStrategy";
  readonly category: PatternCategory = "execution_failure";

  private readonly config: ExecutionFailureConfig;

  constructor(config?: Partial<ExecutionFailureConfig>) {
    this.config = { ...DEFAULT_EXECUTION_FAILURE_CONFIG, ...config };
  }

  /**
   * Run detection against the provided context.
   *
   * @param context - Run-scoped context with execution evidence.
   * @returns Discovered execution failure patterns.
   */
  async run(context: DiscoveryContext): Promise<readonly PatternObservation[]> {
    const now = Date.now();
    const windowMs = this.config.lookbackWindowDays * 24 * 60 * 60 * 1000;
    const cutoffMs = now - windowMs;

    // Step 1: Filter to FAILED outcomes within lookback window
    const failures = context.evidence.filter((e) => {
      if (e.outcome !== "FAILED") return false;
      const completedMs = new Date(e.completedAt).getTime();
      return completedMs >= cutoffMs;
    });

    // Step 2+3: Normalize intent IDs and group failures by normalized ID
    const groups = new Map<string, Array<(typeof failures)[number]>>();
    for (const ev of failures) {
      const normalized = normalizeIntentId(ev.intentId);
      const group = groups.get(normalized) ?? [];
      group.push(ev);
      groups.set(normalized, group);
    }

    // Step 4: Emit pattern for groups meeting the minimum occurrence threshold
    const patterns: PatternObservation[] = [];

    for (const [normalizedId, groupEvidences] of groups) {
      if (groupEvidences.length < this.config.minimumOccurrences) continue;

      // Chronological sort for firstObserved / lastObserved
      const sorted = [...groupEvidences].sort((a, b) =>
        a.completedAt.localeCompare(b.completedAt),
      );
      const newest = sorted[sorted.length - 1];

      // Recency: how fresh is the most recent failure within the window?
      const newestAgeMs = now - new Date(newest.completedAt).getTime();
      const newestAgeDays = newestAgeMs / (24 * 60 * 60 * 1000);
      const recencyFactor = Math.max(
        0,
        1 - newestAgeDays / this.config.lookbackWindowDays,
      );

      const confidence = computeConfidence({
        evidenceCount: groupEvidences.length,
        baselineCount: this.config.baselineCount,
        patternStrength: 1.0,
        recencyFactor,
      });

      patterns.push({
        patternId: `execution_failure:${normalizedId}`,
        category: "execution_failure",
        frequency: groupEvidences.length,
        confidence,
        evidenceIds: groupEvidences.map((e) => e.evidenceId),
        description: `Detected ${groupEvidences.length} execution failure(s) for ${normalizedId}`,
        firstObserved: sorted[0].completedAt,
        lastObserved: newest.completedAt,
      });
    }

    return patterns;
  }
}
