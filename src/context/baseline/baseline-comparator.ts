/**
 * P10.10 — BaselineComparator interface + default numeric implementation.
 *
 * The comparator is framework-owned — providers never compare themselves.
 *
 * @module
 */

import type {
  BaselineArtifact,
  BaselineComparison,
  DriftCategory,
  DriftItem,
  DriftSeverity,
} from "./baseline-types.js";
import { computeHealthScore } from "./health-score.js";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Compares two artifacts and produces structured health data.
 *
 * Implementations are free to interpret `data` however they wish
 * (numeric fields, vectors, graphs, schemas). The default implementation
 * operates on Record<string, number>.
 */
export interface BaselineComparator<T = Record<string, number>> {
  compare(
    baseline: BaselineArtifact<T>,
    current: BaselineArtifact<T>,
  ): BaselineComparison;
}

// ---------------------------------------------------------------------------
// Default numeric implementation
// ---------------------------------------------------------------------------

/**
 * Default comparator that extracts numeric metrics from artifact data,
 * computes per-metric drift, delegates scoring to computeHealthScore,
 * and assembles a BaselineComparison.
 */
export class NumericComparator implements BaselineComparator {
  compare(
    baseline: BaselineArtifact,
    current: BaselineArtifact,
  ): BaselineComparison {
    const metrics = this.extractMetrics(baseline.data);
    const driftItems = this.buildDriftItems(baseline, current, metrics);
    const { score, status } = computeHealthScore(driftItems);

    return {
      subsystem: baseline.subsystem,
      score,
      status,
      drift: this.sortBySeverity(driftItems),
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers (overridable by subclass)
  // -------------------------------------------------------------------------

  /**
   * Extract numeric metric names from artifact data.
   * Override to select a subset or transform keys.
   */
  protected extractMetrics(data: Record<string, unknown>): string[] {
    return Object.entries(data)
      .filter(([, v]) => typeof v === "number")
      .map(([k]) => k);
  }

  /**
   * Build drift items for each metric by comparing baseline vs current.
   */
  protected buildDriftItems(
    baseline: BaselineArtifact,
    current: BaselineArtifact,
    metrics: string[],
  ): DriftItem[] {
    const bData = baseline.data as Record<string, number>;
    const cData = current.data as Record<string, number>;

    return metrics.map((metric) => {
      const bv = bData[metric] ?? 0;
      const cv = cData[metric] ?? 0;
      const delta = cv - bv;

      return {
        id: `${baseline.subsystem}.${metric}`,
        category: this.classifyDrift(metric, delta),
        metric,
        baselineValue: bv,
        currentValue: cv,
        delta,
        severity: this.classifySeverity(delta, Math.max(Math.abs(bv), 1)),
      };
    });
  }

  /**
   * Classify a metric into a drift category.
   * Override for subsystem-specific classification.
   */
  protected classifyDrift(_metric: string, _delta: number): DriftCategory {
    return "performance";
  }

  /**
   * Classify severity based on relative delta magnitude.
   */
  protected classifySeverity(delta: number, magnitude: number): DriftSeverity {
    const ratio = Math.abs(delta) / magnitude;
    if (ratio >= 0.5) return "critical";
    if (ratio >= 0.25) return "high";
    if (ratio >= 0.1) return "medium";
    return "low";
  }

  /**
   * Sort drift items by severity (critical first).
   */
  private sortBySeverity(items: DriftItem[]): DriftItem[] {
    const order: Record<DriftSeverity, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    return [...items].sort((a, b) => order[a.severity] - order[b.severity]);
  }
}
