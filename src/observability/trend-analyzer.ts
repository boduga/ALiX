/**
 * trend-analyzer.ts — P4.2e Trend Analysis and Anomaly Detection.
 *
 * Correct window bucketing via Math.floor(ts / windowSize) * windowSize.
 * Computes p50/p95/p99 percentiles for histogram samples.
 * Anomaly detection with explicit timestamp sort before selecting latest.
 */

import type { MetricsStore, MetricRow } from "./metrics-store.js";

export interface WindowedSummary {
  windowStart: string;
  windowEnd: string;
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface WindowComparison {
  windowA: WindowedSummary;
  windowB: WindowedSummary;
  deltaPercent: number;
  trend: "up" | "down" | "stable";
}

export interface AnomalyResult {
  metricName: string;
  value: number;
  zScore: number;
  direction: "high" | "low";
  timestamp: string;
  labels?: Record<string, string>;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[Math.max(0, idx)];
}

export class TrendAnalyzer {
  constructor(private store: MetricsStore) {}

  /**
   * Compute per-window summaries. Each row is assigned to bucket:
   *   Math.floor(ts / windowSize) * windowSize
   * Handles timestamp gaps (including >1 window) correctly.
   */
  async computeWindowed(
    metricName: string,
    options?: { windowSizeMs?: number; after?: string; before?: string },
  ): Promise<WindowedSummary[]> {
    const windowSize = options?.windowSizeMs ?? 60_000;
    const buckets = new Map<number, number[]>();

    for await (const row of this.store.readAll({
      after: options?.after,
      before: options?.before,
    })) {
      if (row.name !== metricName) continue;
      const ts = new Date(row.timestamp).getTime();
      const bucketStart = Math.floor(ts / windowSize) * windowSize;
      const arr = buckets.get(bucketStart) ?? [];
      arr.push(row.value);
      buckets.set(bucketStart, arr);
    }

    return [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([bucketStart, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const count = values.length;
        const sum = values.reduce((a, b) => a + b, 0);
        return {
          windowStart: new Date(bucketStart).toISOString(),
          windowEnd: new Date(bucketStart + windowSize).toISOString(),
          count,
          sum,
          avg: count > 0 ? sum / count : 0,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          p50: percentile(sorted, 0.5),
          p95: percentile(sorted, 0.95),
          p99: percentile(sorted, 0.99),
        };
      });
  }

  async compareWindows(
    metricName: string,
    spec: {
      windowA: { durationMs: number; endTime: string };
      windowB: { durationMs: number; endTime: string };
    },
  ): Promise<WindowComparison> {
    const [windowA, windowB] = await Promise.all([
      this.collectWindow(metricName, spec.windowA),
      this.collectWindow(metricName, spec.windowB),
    ]);
    const deltaPercent = windowA.sum > 0
      ? ((windowB.sum - windowA.sum) / windowA.sum) * 100 : 0;
    const trend: "up" | "down" | "stable" =
      Math.abs(deltaPercent) < 10 ? "stable" : deltaPercent > 0 ? "up" : "down";
    return { windowA, windowB, deltaPercent, trend };
  }

  private async collectWindow(
    metricName: string,
    w: { durationMs: number; endTime: string },
  ): Promise<WindowedSummary> {
    const after = new Date(new Date(w.endTime).getTime() - w.durationMs).toISOString();
    const values: number[] = [];
    for await (const row of this.store.readAll({ after, before: w.endTime })) {
      if (row.name === metricName) values.push(row.value);
    }
    const sorted = [...values].sort((a, b) => a - b);
    const count = values.length;
    const sum = values.reduce((a, b) => a + b, 0);
    return {
      windowStart: after,
      windowEnd: w.endTime,
      count,
      sum,
      avg: count > 0 ? sum / count : 0,
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
    };
  }

  async detectAnomalies(
    options: { sensitivity?: number; maxResults?: number } = {},
  ): Promise<AnomalyResult[]> {
    const sensitivity = options.sensitivity ?? 2.0;
    const maxResults = options.maxResults ?? 10;
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();

    // Collect all recent metric rows
    const byName = new Map<string, MetricRow[]>();
    for await (const row of this.store.readAll({ after: hourAgo })) {
      const arr = byName.get(row.name) ?? [];
      arr.push(row);
      byName.set(row.name, arr);
    }

    const results: AnomalyResult[] = [];

    for (const [name, rows] of byName) {
      if (rows.length < 3) continue;
      // Sort by timestamp ascending
      rows.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const values = rows.map(r => r.value);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const stddev = Math.sqrt(values.reduce((sq, v) => sq + (v - mean) ** 2, 0) / values.length);
      if (stddev === 0) continue;

      // Use the LAST entry in sorted order as "latest"
      const latest = rows[rows.length - 1];
      const zScore = (latest.value - mean) / stddev;
      if (Math.abs(zScore) > sensitivity) {
        results.push({
          metricName: name,
          value: latest.value,
          zScore: Math.round(zScore * 100) / 100,
          direction: zScore > 0 ? "high" : "low",
          timestamp: latest.timestamp,
          labels: latest.labels,
        });
      }
    }

    results.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
    return results.slice(0, maxResults);
  }
}
