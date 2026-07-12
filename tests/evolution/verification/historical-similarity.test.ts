/**
 * Tests A2.1 — Historical Similarity Assessment.
 *
 * Covers identical, orthogonal, and partial similarity scoring, plus
 * coverage gap detection.
 *
 * @module historical-similarity
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeHistoricalSimilarity,
} from "../../../src/evolution/verification/index.js";
import type { ReplayDataset } from "../../../src/evolution/verification/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDataset(overrides: Partial<ReplayDataset> = {}): ReplayDataset {
  return {
    datasetId: "ds-001",
    datasetHash: "hash-001",
    historicalWindow: {
      startTime: "2026-05-01T00:00:00.000Z",
      endTime: "2026-07-01T00:00:00.000Z",
      durationMs: 5270400000,
    },
    evidenceSources: [
      { sourceId: "x3b", sourceType: "execution_evidence", referenceCount: 10000 },
    ],
    evidenceCount: 10000,
    policySnapshot: {
      policyId: "policy-retry",
      policyVersion: "v3",
      policyHash: "hash-pol-001",
      capturedAt: "2026-05-01T00:00:00.000Z",
      rules: 12,
    },
    topologySnapshot: {
      agentCount: 5,
      activePolicies: ["policy-retry"],
      runtimeVersion: "alix-runtime-v2.1.0",
    },
    telemetrySnapshot: {
      metricNames: ["latency", "success_rate"],
      sampleCount: 50000,
      timeRangeMs: 5270400000,
    },
    agentConfigurationSnapshot: {
      agentIds: ["agent-1", "agent-2"],
      configurationHashes: { "agent-1": "hash-1", "agent-2": "hash-2" },
    },
    constructionMetadata: {
      constructionStrategy: "time_window",
      evidenceFilterCriteria: { window_days: 60 },
      snapshotVersions: { policy: "v3" },
    },
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeHistoricalSimilarity
// ---------------------------------------------------------------------------

describe("computeHistoricalSimilarity", () => {
  it("identical snapshots produce 1.0 similarity", () => {
    const result = computeHistoricalSimilarity({
      historicalSnapshot: makeDataset(),
      currentSnapshot: makeDataset(),
    });

    assert.ok(result.overallSimilarity > 0.9, `identical should be near 1.0, got ${result.overallSimilarity}`);
    assert.ok(result.workloadSimilarity >= 0.99);
    assert.ok(result.topologySimilarity >= 0.99);
    assert.ok(result.policySimilarity >= 0.99);
  });

  it("orthogonal snapshots produce low similarity", () => {
    const historical = makeDataset();
    const current = makeDataset({
      evidenceCount: 1,
      topologySnapshot: {
        agentCount: 99,
        activePolicies: ["completely-different-policy"],
        runtimeVersion: "alix-runtime-v9.9.9",
      },
      policySnapshot: {
        policyId: "different-policy",
        policyVersion: "v99",
        policyHash: "hash-diff",
        capturedAt: "2026-07-01T00:00:00.000Z",
        rules: 1,
      },
      telemetrySnapshot: {
        metricNames: ["unrelated_metric"],
        sampleCount: 1,
        timeRangeMs: 1000,
      },
      agentConfigurationSnapshot: {
        agentIds: ["agent-99", "agent-100"],
        configurationHashes: { "agent-99": "x", "agent-100": "y" },
      },
      constructionMetadata: {
        constructionStrategy: "scenario_match",
        evidenceFilterCriteria: {},
        snapshotVersions: {},
      },
    });

    const result = computeHistoricalSimilarity({
      historicalSnapshot: historical,
      currentSnapshot: current,
    });

    assert.ok(
      result.overallSimilarity < 0.5,
      `orthogonal should be < 0.5, got ${result.overallSimilarity}`,
    );
  });

  it("records coverage gaps when versions differ", () => {
    const result = computeHistoricalSimilarity({
      historicalSnapshot: makeDataset({
        topologySnapshot: {
          agentCount: 5,
          activePolicies: ["policy-retry"],
          runtimeVersion: "alix-runtime-v2.0.0",
        },
      }),
      currentSnapshot: makeDataset({
        topologySnapshot: {
          agentCount: 5,
          activePolicies: ["policy-retry"],
          runtimeVersion: "alix-runtime-v2.1.0",
        },
      }),
    });

    assert.ok(
      result.coverageGaps.some((g) => g.includes("runtime_version_mismatch")),
      `expected runtime version gap, got: ${result.coverageGaps.join(", ")}`,
    );
  });

  it("overallSimilarity is bounded in [0, 1]", () => {
    const result = computeHistoricalSimilarity({
      historicalSnapshot: makeDataset(),
      currentSnapshot: makeDataset(),
    });

    assert.ok(result.overallSimilarity >= 0 && result.overallSimilarity <= 1);
    assert.ok(result.workloadSimilarity >= 0 && result.workloadSimilarity <= 1);
    assert.ok(result.topologySimilarity >= 0 && result.topologySimilarity <= 1);
    assert.ok(result.policySimilarity >= 0 && result.policySimilarity <= 1);
    assert.ok(result.resourceSimilarity >= 0 && result.resourceSimilarity <= 1);
    assert.ok(result.agentCompositionSimilarity >= 0 && result.agentCompositionSimilarity <= 1);
    assert.ok(result.trafficSimilarity >= 0 && result.trafficSimilarity <= 1);
    assert.ok(result.failurePatternSimilarity >= 0 && result.failurePatternSimilarity <= 1);
  });

  it("records failure pattern gap when evidence is missing on one side", () => {
    const result = computeHistoricalSimilarity({
      historicalSnapshot: makeDataset({ evidenceCount: 0 }),
      currentSnapshot: makeDataset(),
    });

    assert.ok(
      result.coverageGaps.some((g) => g.includes("failure_pattern")),
      "failure pattern gap should be recorded when evidence count is zero",
    );
  });

  it("computes meaningful failure pattern score for identical snapshots (no gap)", () => {
    const result = computeHistoricalSimilarity({
      historicalSnapshot: makeDataset(),
      currentSnapshot: makeDataset(),
    });

    assert.ok(
      result.failurePatternSimilarity > 0.9,
      `identical snapshots should produce high failure pattern similarity, got ${result.failurePatternSimilarity}`,
    );
    assert.ok(
      !result.coverageGaps.some((g) => g.includes("failure_pattern")),
      "identical snapshots should not produce failure pattern gap",
    );
  });

  it("policy similarity is 1.0 when policy and version match", () => {
    const result = computeHistoricalSimilarity({
      historicalSnapshot: makeDataset(),
      currentSnapshot: makeDataset(),
    });

    assert.ok(result.policySimilarity >= 0.99);
  });

  it("policy similarity is reduced when version differs", () => {
    const result = computeHistoricalSimilarity({
      historicalSnapshot: makeDataset({
        policySnapshot: {
          policyId: "policy-retry",
          policyVersion: "v3",
          policyHash: "h1",
          capturedAt: "2026-05-01T00:00:00.000Z",
          rules: 12,
        },
      }),
      currentSnapshot: makeDataset({
        policySnapshot: {
          policyId: "policy-retry",
          policyVersion: "v4",
          policyHash: "h2",
          capturedAt: "2026-07-01T00:00:00.000Z",
          rules: 12,
        },
      }),
    });

    assert.ok(result.policySimilarity < 1.0);
  });
});
