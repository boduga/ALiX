/**
 * P5.0f — ReflectionAgent: plugin-based analyzer composition with metrics.
 *
 * The ReflectionAgent is the orchestrator for the reflection phase.  It accepts
 * any number of Analyzer plugins via constructor injection, runs all of them in
 * parallel (Promise.all), and assembles a complete ReflectionReport that
 * includes merged observations/recommendations plus metrics computed from the
 * EvidenceStore.
 *
 * @module
 */

import type { Analyzer, AnalysisResult, Observation, Recommendation, ReflectionReport, ReflectionMetrics } from "./reflection-types.js";
import type { EvidenceStore } from "../security/evidence/evidence-store.js";
import { computeMetricsSnapshot } from "./metrics-snapshot.js";

// ---------------------------------------------------------------------------
// ReflectionAgent
// ---------------------------------------------------------------------------

export class ReflectionAgent {
  private readonly analyzers: Analyzer[];
  private readonly storeForMetrics: EvidenceStore;

  /**
   * @param analyzers - Any number of Analyzer plugins (evidence, workflow,
   *   capability, quality).  All must implement the {@link Analyzer} interface.
   * @param storeForMetrics - An EvidenceStore used exclusively for computing
   *   aggregate metrics (workflow completion counts, capability gaps, etc.).
   */
  constructor(analyzers: Analyzer[], storeForMetrics: EvidenceStore) {
    this.analyzers = analyzers;
    this.storeForMetrics = storeForMetrics;
  }

  /**
   * Generate a complete reflection report.
   *
   * 1. Runs every registered analyzer in parallel via Promise.all.
   * 2. Flattens all observations and recommendations.
   * 3. Queries the evidence store for workflow and capability metrics.
   * 4. Returns a typed {@link ReflectionReport}.
   */
  async generateReport(): Promise<ReflectionReport> {
    // Phase 1: run all analyzers in parallel
    const results: AnalysisResult[] = await Promise.all(
      this.analyzers.map((a) => a.analyze()),
    );

    const allObs: Observation[] = results.flatMap((r) => r.observations);
    const allRecs: Recommendation[] = results.flatMap((r) => r.recommendations);

    // Phase 2: compute metrics from evidence store
    const metrics = await this.computeMetrics();

    // Phase 3: assemble report
    return {
      generatedAt: new Date().toISOString(),
      observations: allObs,
      recommendations: allRecs,
      metrics,
      summary: {
        totalObservations: allObs.length,
        totalRecommendations: allRecs.length,
        highSeverityCount: allObs.filter((o) => o.severity === "high").length,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Compute aggregate metrics from the evidence store.
   *
   * Queries are targeted by type so we avoid a full scan:
   * - `merge_completed` for workflowsCompleted
   * - `workflow_blocked` for workflowsBlocked
   * - `workflow_aborted` for workflowsAborted
   * - `capability_routed` for capabilitiesRequested and unresolvedCapabilities
   * - `review_completed` for reviewApprovalRate
   */
  private async computeMetrics(): Promise<ReflectionMetrics> {
    // P5.2b.1: delegates to the shared, windowable snapshot. No window ⇒
    // byte-for-byte identical to the previous inline computation.
    return computeMetricsSnapshot(this.storeForMetrics);
  }
}
