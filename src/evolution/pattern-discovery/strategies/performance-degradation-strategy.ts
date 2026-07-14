// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A1.3 — PerformanceDegradationStrategy
 *
 * Detects execution performance degradation by analyzing latency trends
 * over successive successful executions. Groups execution evidence by
 * normalized intent ID and compares average latency between the first
 * and second halves of the group's time window. Emits a pattern when
 * the latency increase exceeds a configured threshold.
 *
 * Pure detection — no store access, no side effects, I/O only through
 * the provided DiscoveryContext.
 *
 * @module performance-degradation-strategy
 */

import type { DetectionStrategy } from "../detection-strategy.js";
import type { DiscoveryContext } from "../../contracts/discovery-context.js";
import type {
  PatternObservation,
  PatternCategory,
} from "../../contracts/pattern-discovery-contract.js";
import { computeConfidence } from "../../contracts/pattern-discovery-contract.js";
import { normalizeIntentId } from "./strategy-utils.js";
import type { ExecutionEvidence } from "../../../runtime/contracts/execution-intent-contract.js";

// ---------------------------------------------------------------------------
// PerformanceDegradationConfig
// ---------------------------------------------------------------------------

export interface PerformanceDegradationConfig {
  /** Minimum execution count required to consider a trend (>= this). */
  minimumExecutions: number;
  /** Latency increase ratio threshold (1.0 = 100% increase). */
  degradationThreshold: number;
  /** How far back (in days) to consider execution evidence. */
  lookbackWindowDays: number;
  /** Expected baseline count for confidence scaling. */
  baselineCount: number;
}

export const DEFAULT_PERFORMANCE_DEGRADATION_CONFIG: PerformanceDegradationConfig = {
  minimumExecutions: 10,
  degradationThreshold: 0.5,
  lookbackWindowDays: 14,
  baselineCount: 20,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute execution latency in milliseconds for a SUCCESS evidence record.
 */
function computeLatency(evidence: ExecutionEvidence): number {
  const start = new Date(evidence.startedAt).getTime();
  const end = new Date(evidence.completedAt).getTime();
  return Math.max(0, end - start);
}

// ---------------------------------------------------------------------------
// PerformanceDegradationStrategy
// ---------------------------------------------------------------------------

/**
 * Detection strategy that identifies performance degradation trends from
 * successful execution evidence.
 *
 * Algorithm:
 * 1. Filter evidence to SUCCESS outcomes within the lookback window
 * 2. Group by normalized intent ID
 * 3. For each group, sort by startedAt timestamp
 * 4. Require minimum execution count
 * 5. Split into first half / second half by count
 * 6. Compare average latency: if second half avg >= (1 + threshold) * first half avg, emit
 *
 * @invariant Stateless — no mutable state between runs.
 * @invariant No store access — receives all data through DiscoveryContext.
 */
export class PerformanceDegradationStrategy implements DetectionStrategy {
  readonly name = "PerformanceDegradationStrategy";
  readonly category: PatternCategory = "performance_degradation";

  private readonly config: PerformanceDegradationConfig;

  constructor(config?: Partial<PerformanceDegradationConfig>) {
    this.config = { ...DEFAULT_PERFORMANCE_DEGRADATION_CONFIG, ...config };
  }

  /**
   * Run detection against the provided context.
   *
   * @param context - Run-scoped context with execution evidence.
   * @returns Discovered performance degradation patterns.
   */
  async run(context: DiscoveryContext): Promise<readonly PatternObservation[]> {
    const now = Date.now();
    const windowMs = this.config.lookbackWindowDays * 24 * 60 * 60 * 1000;
    const cutoffMs = now - windowMs;

    // Step 1: Filter to SUCCESS outcomes within the lookback window
    const successful = context.evidence.filter((e) => {
      if (e.outcome !== "SUCCESS") return false;
      const completedMs = new Date(e.completedAt).getTime();
      return completedMs >= cutoffMs;
    });

    // Step 2: Group by normalized intent ID
    const groups = new Map<string, ExecutionEvidence[]>();
    for (const ev of successful) {
      const normalized = normalizeIntentId(ev.intentId);
      const group = groups.get(normalized) ?? [];
      group.push(ev);
      groups.set(normalized, group);
    }

    const patterns: PatternObservation[] = [];

    for (const [normalizedId, groupEvidences] of groups) {
      // Step 4: Require minimum execution count
      if (groupEvidences.length < this.config.minimumExecutions) continue;

      // Step 3: Sort by startedAt
      const sorted = [...groupEvidences].sort((a, b) =>
        a.startedAt.localeCompare(b.startedAt),
      );

      // Step 5: Split into first half / second half
      const mid = Math.floor(sorted.length / 2);
      const firstHalf = sorted.slice(0, mid);
      const secondHalf = sorted.slice(mid);

      // Compute average latency per half
      const firstAvg =
        firstHalf.reduce((sum, e) => sum + computeLatency(e), 0) / firstHalf.length;
      const secondAvg =
        secondHalf.reduce((sum, e) => sum + computeLatency(e), 0) / secondHalf.length;

      // Guard against zero first-half average
      if (firstAvg <= 0) continue;

      // Step 6: Check degradation
      const increaseRatio = (secondAvg - firstAvg) / firstAvg;
      if (increaseRatio < this.config.degradationThreshold) continue;

      // Compute recency factor
      const newest = sorted[sorted.length - 1];
      const newestAgeMs = now - new Date(newest.completedAt).getTime();
      const newestAgeDays = newestAgeMs / (24 * 60 * 60 * 1000);
      const recencyFactor = Math.max(
        0,
        1 - newestAgeDays / this.config.lookbackWindowDays,
      );

      const patternStrength = Math.min(1, increaseRatio / this.config.degradationThreshold);

      const confidence = computeConfidence({
        evidenceCount: sorted.length,
        baselineCount: this.config.baselineCount,
        patternStrength,
        recencyFactor,
      });

      patterns.push({
        patternId: `performance_degradation:${normalizedId}`,
        category: "performance_degradation",
        frequency: sorted.length,
        confidence,
        evidenceIds: sorted.map((e) => e.evidenceId),
        description: `Detected ${(increaseRatio * 100).toFixed(1)}% latency increase for ${normalizedId} (${sorted.length} executions)`,
        firstObserved: sorted[0].completedAt,
        lastObserved: newest.completedAt,
      });
    }

    return patterns;
  }
}
