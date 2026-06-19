/**
 * P5.0e — QualityAnalyzer: review trend detection from review_completed evidence.
 *
 * Queries review_completed events from EvidenceStore, calculates approval rate
 * and average findings per review, and produces quality_decline observations
 * when patterns indicate systemic quality issues.
 *
 * @module
 */

import type { Analyzer, AnalysisResult, Observation } from "./reflection-types.js";
import type { EvidenceStore } from "../security/evidence/evidence-store.js";

// ---------------------------------------------------------------------------
// QualityAnalyzer
// ---------------------------------------------------------------------------

export class QualityAnalyzer implements Analyzer {
  readonly name = "QualityAnalyzer";

  constructor(private store: EvidenceStore) {}

  async analyze(): Promise<AnalysisResult> {
    const reviews = await this.store.query({ type: "review_completed", limit: 5000 });
    const observations: Observation[] = [];

    if (reviews.records.length === 0) return { observations, recommendations: [] };

    let changesRequested = 0, rejects = 0, totalFindings = 0;
    for (const r of reviews.records) {
      const v = r.payload.verdict as string;
      if (v === "changes_requested") changesRequested++;
      if (v === "reject") rejects++;
      totalFindings += (r.payload.findingCount as number) ?? 0;
    }

    const approvalRate = (reviews.records.length - changesRequested - rejects) / reviews.records.length;
    const avgFindings = totalFindings / reviews.records.length;

    if (approvalRate < 0.5) {
      observations.push({
        type: "quality_decline",
        severity: "high",
        title: `Low approval rate: ${Math.round(approvalRate * 100)}%`,
        detail: `${changesRequested} changes requested, ${rejects} rejected. Avg ${avgFindings.toFixed(1)} findings/review.`,
        source: this.name,
        count: reviews.records.length,
      });
    } else if (approvalRate < 0.75) {
      observations.push({
        type: "quality_decline",
        severity: "medium",
        title: `Moderate rejection rate: ${Math.round((1 - approvalRate) * 100)}%`,
        detail: `Review approval rate is ${Math.round(approvalRate * 100)}% over ${reviews.records.length} reviews.`,
        source: this.name,
        count: reviews.records.length,
      });
    }

    if (avgFindings > 5) {
      observations.push({
        type: "quality_decline",
        severity: "medium",
        title: `High average findings per review: ${avgFindings.toFixed(1)}`,
        detail: `Averages over 5 findings per review may indicate systemic quality issues.`,
        source: this.name,
        count: Math.round(avgFindings),
      });
    }

    return { observations, recommendations: [] };
  }
}
