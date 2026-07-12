/**
 * Tests A2 — End-to-end verification lifecycle integration.
 *
 * Exercises the full pipeline: A2.0 types → A2.1 dataset → A2.2 replay →
 * A2.3 evaluation → A2.4 evidence → A2.5 recommendation.
 *
 * @module verification-lifecycle-integration
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ReplayEngine,
  CounterfactualEvaluator,
  RecommendationEngine,
  InMemoryVerificationEvidenceLedger,
  LineageTracker,
  VerificationReportBuilder,
  createVerificationEvidence,
  computeOverallConfidence,
  computeDatasetHash,
  computeHistoricalSimilarity,
  isEvidenceExpired,
  type ReplayDataset,
  type ReplayExecutor,
  type DeterministicEvent,
} from "../../../../src/evolution/verification/index.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeDataset(): ReplayDataset {
  const base = {
    datasetId: "ds-001",
    historicalWindow: {
      startTime: "2026-05-01T00:00:00.000Z",
      endTime: "2026-07-01T00:00:00.000Z",
      durationMs: 5270400000,
    },
    evidenceSources: [
      { sourceId: "x3b", sourceType: "execution_evidence" as const, referenceCount: 1000 },
    ],
    evidenceCount: 1000,
    policySnapshot: {
      policyId: "policy-retry",
      policyVersion: "v3",
      policyHash: "h",
      capturedAt: "2026-05-01T00:00:00.000Z",
      rules: 12,
    },
    topologySnapshot: { agentCount: 5, activePolicies: ["policy-retry"], runtimeVersion: "v2.1.0" },
    telemetrySnapshot: { metricNames: ["success_rate", "latency"], sampleCount: 5000, timeRangeMs: 5270400000 },
    agentConfigurationSnapshot: { agentIds: ["a1", "a2"], configurationHashes: { a1: "h1", a2: "h2" } },
    constructionMetadata: {
      constructionStrategy: "time_window" as const,
      evidenceFilterCriteria: { window_days: 60 },
      snapshotVersions: { policy: "v3" },
    },
    createdAt: "2026-07-01T00:00:00.000Z",
  };
  return { ...base, datasetHash: computeDatasetHash(base) };
}

/** Executor that simulates a proposal improving success rate. */
function improvementExecutor(): ReplayExecutor {
  return {
    async processEvent(event) {
      // Proposal succeeds on 96% of events (vs baseline 90%)
      const isSuccess = (event.sequenceNumber % 25) !== 0; // 24/25 = 96%
      return {
        events: [],
        metricDeltas: {
          candidate_success: isSuccess ? 1 : 0,
          candidate_total: 1,
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

describe("Verification lifecycle integration", () => {
  it("runs the full A2 pipeline end-to-end", async () => {
    // --- A2.1: Dataset construction ---
    const dataset = makeDataset();
    assert.ok(dataset.datasetHash);

    // --- A2.1: Historical similarity ---
    const similarity = computeHistoricalSimilarity({
      historicalSnapshot: dataset,
      currentSnapshot: dataset, // identical for test
    });
    assert.ok(similarity.overallSimilarity > 0.9);

    // --- A2.2: Replay execution ---
    const engine = new ReplayEngine({
      seed: 42,
      clockStart: 0,
      environmentId: "env-001",
      environmentHash: "hash-env-001",
    });

    // Build input streams — 100 events
    const inputStreams: DeterministicEvent[][] = [[]];
    for (let i = 1; i <= 100; i++) {
      inputStreams[0].push({ sourceId: "exec", tick: i, sequenceNumber: i, payload: null });
    }

    const executor = improvementExecutor();
    const result = await engine.execute(dataset, executor, inputStreams);
    assert.strictEqual(result.errors.length, 0);

    // --- A2.0: Confidence computation ---
    const confidenceProfile = computeOverallConfidence({
      replayFidelity: 0.95,
      coverage: 0.90,
      determinism: 1.0,
      historicalSimilarity: similarity.overallSimilarity,
    });

    // --- A2.3: Counterfactual evaluation ---
    const evaluator = new CounterfactualEvaluator({
      significanceThreshold: 0.05,
      minimumConfidence: 0.3,
      metricDirections: { candidate_success: "higher_is_better" },
    });

    const candidateSuccessRate = result.metrics.candidate_success / result.metrics.candidate_total;
    const evaluation = evaluator.evaluate(
      { candidate_success: 0.90 }, // baseline
      { candidate_success: candidateSuccessRate },
      confidenceProfile,
    );
    assert.ok(evaluation.outcomeClassifications.length >= 1);

    // --- A2.4: Evidence construction ---
    const lineage = new LineageTracker();
    lineage.addRecord("dataset", dataset.datasetId, "replay_dataset", "2026-07-12T10:00:00.000Z");
    lineage.addRecord("replay", "ver-run-001", "run", "2026-07-12T10:00:01.000Z");

    const evidence = createVerificationEvidence({
      verificationId: "ver-run-001",
      proposalId: "prop-001",
      replayDatasetId: dataset.datasetId,
      proposalSnapshotHash: "hash-prop-001",
      environmentHash: "hash-env-001",
      baselineMetrics: { candidate_success: 0.90 },
      candidateMetrics: { candidate_success: candidateSuccessRate },
      metricDeltas: evaluation.metricDeltas,
      behavioralChanges: evaluation.behavioralChanges,
      confidenceProfile,
      reproducibilityLevel: 2,
      lineage: [...lineage.getLineage()],
      verifiedAt: "2026-07-12T10:05:00.000Z",
      expiresAt: "2099-12-31T00:00:00.000Z",
    });
    assert.ok(evidence.integrityHash);
    assert.equal(isEvidenceExpired(evidence), false);

    // --- A2.4: Ledger persistence ---
    const ledger = new InMemoryVerificationEvidenceLedger();
    await ledger.store(evidence);
    const retrieved = await ledger.get(evidence.evidenceId);
    assert.strictEqual(retrieved.evidenceId, evidence.evidenceId);

    // --- A2.4: Report construction ---
    const report = new VerificationReportBuilder("ver-run-001")
      .addExecutionLog("Replay completed")
      .addMetricResult("candidate_success", 0.90, candidateSuccessRate)
      .build();
    assert.strictEqual(report.evidenceClass, "projected");

    // --- A2.5: Governance recommendation ---
    const recEngine = new RecommendationEngine();
    const classifications = {
      improvement: evaluation.outcomeClassifications.filter((c) => c.classification === "improvement").length,
      neutral: evaluation.outcomeClassifications.filter((c) => c.classification === "neutral").length,
      regression: evaluation.outcomeClassifications.filter((c) => c.classification === "regression").length,
      insufficient: evaluation.outcomeClassifications.filter((c) => c.classification === "insufficient").length,
      total: evaluation.outcomeClassifications.length,
    };
    const recommendation = recEngine.generate(evidence, classifications);
    assert.ok(["APPROVE", "MONITOR", "REQUEST_ADDITIONAL_EVIDENCE", "REJECT", "ESCALATE"].includes(recommendation.kind));
    assert.strictEqual(recommendation.evidenceId, evidence.evidenceId);
  });
});
