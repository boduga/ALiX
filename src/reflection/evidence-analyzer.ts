/**
 * P5.0b — EvidenceAnalyzer: targeted evidence queries for failure/stall patterns.
 *
 * Uses the EvidenceStore to query for specific evidence types (workflow_aborted,
 * workflow_blocked, execution_test_failed) and produces observations when
 * patterns exceed configured thresholds.
 *
 * @module
 */

import type { Analyzer, AnalysisResult, Observation, Recommendation } from "./reflection-types.js";
import type { EvidenceStore } from "../security/evidence/evidence-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum count for a pattern to be considered significant. */
const DEFAULT_THRESHOLD = 3;

/** Evidence type to observation type mapping. */
const EVIDENCE_TO_OBSERVATION: Record<string, {
  observationType: Observation["type"];
  severity: Observation["severity"];
  label: string;
}> = {
  workflow_aborted: {
    observationType: "workflow_failure",
    severity: "high",
    label: "Workflow failures detected",
  },
  workflow_blocked: {
    observationType: "workflow_stall",
    severity: "medium",
    label: "Workflow stalls detected",
  },
  execution_test_failed: {
    observationType: "test_coverage_gap",
    severity: "medium",
    label: "Test gaps detected",
  },
};

/** Evidence types this analyzer queries (targeted, no full scan). */
const QUERIED_TYPES = Object.keys(EVIDENCE_TO_OBSERVATION);

// ---------------------------------------------------------------------------
// EvidenceAnalyzer
// ---------------------------------------------------------------------------

export class EvidenceAnalyzer implements Analyzer {
  readonly name = "evidence-analyzer";

  private readonly store: EvidenceStore;
  private readonly threshold: number;

  constructor(store: EvidenceStore, threshold: number = DEFAULT_THRESHOLD) {
    this.store = store;
    this.threshold = threshold;
  }

  /**
   * Run targeted evidence queries and produce observations for patterns
   * that exceed the configured threshold.
   */
  async analyze(): Promise<AnalysisResult> {
    const observations: Observation[] = [];

    for (const evidenceType of QUERIED_TYPES) {
      const result = await this.store.query({ type: evidenceType as "workflow_aborted" | "workflow_blocked" | "execution_test_failed" });
      const count = result.total;
      if (count >= this.threshold) {
        const mapping = EVIDENCE_TO_OBSERVATION[evidenceType];
        observations.push({
          type: mapping.observationType,
          severity: mapping.severity,
          title: mapping.label,
          detail: `Found ${count} ${evidenceType} evidence records (threshold: ${this.threshold}).`,
          source: this.name,
          count,
        });
      }
    }

    const recommendations = this.buildRecommendations(observations);

    return { observations, recommendations };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private buildRecommendations(observations: Observation[]): Recommendation[] {
    const recommendations: Recommendation[] = [];

    for (const obs of observations) {
      const evidence = [`${obs.count} ${this.observationSourceType(obs)} records`];

      switch (obs.type) {
        case "workflow_failure":
          recommendations.push({
            type: "process_change",
            confidence: 0.9,
            title: "Investigate workflow abort root causes",
            evidence,
            recommendedAction: "Review aborted workflow payloads for common failure reasons; consider adding retry logic or human escalation.",
          });
          break;
        case "workflow_stall":
          recommendations.push({
            type: "process_change",
            confidence: 0.8,
            title: "Investigate workflow stall causes",
            evidence,
            recommendedAction: "Review blocked workflow payloads for dependency or approval patterns; consider timeouts or automatic unblocking.",
          });
          break;
        case "test_coverage_gap":
          recommendations.push({
            type: "skill_revision",
            confidence: 0.8,
            title: "Address test coverage gaps",
            evidence,
            recommendedAction: "Review failed test payloads for common failure modes; add targeted tests or improve test generation prompts.",
          });
          break;
        default:
          break;
      }
    }

    return recommendations;
  }

  /**
   * Map an observation type back to the evidence type for reporting.
   */
  private observationSourceType(obs: Observation): string {
    for (const [evidenceType, mapping] of Object.entries(EVIDENCE_TO_OBSERVATION)) {
      if (mapping.observationType === obs.type) return evidenceType;
    }
    return "unknown";
  }
}
