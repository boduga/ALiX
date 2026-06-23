/**
 * P8.5a.2a — Recommendation calibration adapter (P8.1).
 *
 * Pure: reads OutcomeStore, buckets by OutcomeRecord.confidence (the REAL
 * recommendation confidence populated by P7.5p.1), feeds the pure
 * RecommendationCalibrationBuilder, and returns an AdapterResult. Never
 * writes to LearningStore — the orchestrator is the sole writer.
 *
 * Adapter Purity Invariant: this file imports NO mutation surface
 * (LearningStore/ProposalStore/ApprovalGate/appliers). Sentinel-enforced.
 *
 * @module
 */

import type { OutcomeRecord } from "../adaptation/outcome-types.js";
import type { OutcomeStore } from "../adaptation/outcome-store.js";
import { RecommendationCalibrationBuilder } from "./recommendation-calibration-builder.js";
import type { ConfidenceBucketObservation } from "./recommendation-calibration-builder.js";
import type { AdapterResult, CalibrationAdapter } from "./adapter-diagnostics.js";

export interface RecommendationAdapterOptions {
  windowDays?: number;       // default 30
  generatedAt?: string;      // injected for determinism in tests; orchestrator passes the run's shared ts
}

// 5 fixed confidence buckets.
const BUCKETS: { label: string; lo: number; hi: number; midpoint: number }[] = [
  { label: "0.0-0.2", lo: 0.0, hi: 0.2, midpoint: 0.1 },
  { label: "0.2-0.4", lo: 0.2, hi: 0.4, midpoint: 0.3 },
  { label: "0.4-0.6", lo: 0.4, hi: 0.6, midpoint: 0.5 },
  { label: "0.6-0.8", lo: 0.6, hi: 0.8, midpoint: 0.7 },
  { label: "0.8-1.0", lo: 0.8, hi: 1.0, midpoint: 0.9 },
];

export class RecommendationCalibrationAdapter implements CalibrationAdapter {
  constructor(
    private readonly outcomeStore: OutcomeStore,
    private readonly builder = new RecommendationCalibrationBuilder(),
  ) {}

  async calibrate(opts?: RecommendationAdapterOptions): Promise<AdapterResult> {
    const windowDays = opts?.windowDays ?? 30;
    const generatedAt = opts?.generatedAt ?? new Date().toISOString();

    const outcomes = await this.outcomeStore.queryByWindow(windowDays);

    // Bucket by confidence. Outcomes with confidence === undefined are excluded
    // (they predate P7.5p.1 or had no recommendation) — bucketing undefined is meaningless.
    const counts: Record<string, { total: number; success: number }> = {};
    for (const b of BUCKETS) counts[b.label] = { total: 0, success: 0 };
    let processed = 0;
    let excludedMissingConfidence = 0;

    for (const o of outcomes) {
      if (o.confidence === undefined || o.confidence === null) {
        excludedMissingConfidence += 1;
        continue;
      }
      const bucket = BUCKETS.find((b) => o.confidence! >= b.lo && o.confidence! < b.hi)
        ?? BUCKETS[BUCKETS.length - 1]; // 1.0 lands in the last bucket
      counts[bucket.label].total += 1;
      if (o.outcome === "success") counts[bucket.label].success += 1;
      processed += 1;
    }

    const buckets: ConfidenceBucketObservation[] = BUCKETS.map((b) => ({
      bucketLabel: b.label,
      bucketMidpoint: b.midpoint,
      totalCount: counts[b.label].total,
      successCount: counts[b.label].success,
    }));

    const sourceReportId = `recommendation-accuracy-window-${windowDays}`;
    const built = this.builder.calibrate(buckets, sourceReportId, generatedAt);

    return {
      signals: built.signals,
      profiles: built.profiles,
      diagnostics: {
        adapter: "recommendation",
        sourceRecordsRead: outcomes.length,
        processed,
        excludedReasons: excludedMissingConfidence > 0
          ? { missingConfidence: excludedMissingConfidence }
          : {},
        fidelity: "high",
      },
    };
  }
}
