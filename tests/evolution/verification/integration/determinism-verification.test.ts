/**
 * Tests A2 — Determinism verification integration.
 *
 * Verifies that identical inputs produce identical evidence (hash + fields),
 * and that changing the seed produces different output.
 *
 * @module determinism-verification-integration
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ReplayEngine,
  createVerificationEvidence,
  computeEvidenceIntegrityHash,
  computeDatasetHash,
  type ReplayDataset,
  type ReplayExecutor,
  type DeterministicEvent,
} from "../../../../src/evolution/verification/index.js";

function makeDataset(): ReplayDataset {
  const base = {
    datasetId: "ds-001",
    historicalWindow: { startTime: "2026-05-01T00:00:00.000Z", endTime: "2026-07-01T00:00:00.000Z", durationMs: 5270400000 },
    evidenceSources: [],
    evidenceCount: 0,
    policySnapshot: { policyId: "p", policyVersion: "v1", policyHash: "h", capturedAt: "2026-05-01T00:00:00.000Z", rules: 1 },
    topologySnapshot: { agentCount: 1, activePolicies: [], runtimeVersion: "v1" },
    telemetrySnapshot: { metricNames: [], sampleCount: 0, timeRangeMs: 0 },
    agentConfigurationSnapshot: { agentIds: [], configurationHashes: {} },
    constructionMetadata: { constructionStrategy: "time_window" as const, evidenceFilterCriteria: {}, snapshotVersions: {} },
    createdAt: "2026-07-01T00:00:00.000Z",
  };
  return { ...base, datasetHash: computeDatasetHash(base) };
}

const noopExecutor: ReplayExecutor = {
  async processEvent() {
    return { events: [], metricDeltas: { count: 1 } };
  },
};

describe("Determinism verification", () => {
  it("same dataset + same config + same inputs produce identical replay metrics", async () => {
    const dataset = makeDataset();
    const config = { seed: 42, clockStart: 0, environmentId: "env-001", environmentHash: "hash-env-001" };

    const streams: DeterministicEvent[][] = [
      Array.from({ length: 10 }, (_, i) => ({ sourceId: "s", tick: i + 1, sequenceNumber: i + 1, payload: null })),
    ];

    const result1 = await new ReplayEngine(config).execute(dataset, noopExecutor, streams);
    const result2 = await new ReplayEngine(config).execute(dataset, noopExecutor, streams);

    assert.deepStrictEqual(result1.metrics, result2.metrics);
    assert.strictEqual(result1.ticksExecuted, result2.ticksExecuted);
  });

  it("same evidence content produces identical integrity hash", () => {
    const baseInput = {
      verificationId: "ver-run-001",
      proposalId: "prop-001",
      replayDatasetId: "ds-001",
      proposalSnapshotHash: "hash-prop",
      environmentHash: "hash-env",
      baselineMetrics: { m: 1 },
      candidateMetrics: { m: 2 },
      metricDeltas: { m: 1 },
      behavioralChanges: [],
      confidenceProfile: { replayFidelity: 0.9, coverage: 0.9, determinism: 1.0, historicalSimilarity: 0.9, overallConfidence: 0.81 },
      reproducibilityLevel: 2 as const,
      lineage: [],
      verifiedAt: "2026-07-12T10:00:00.000Z",
      expiresAt: "2099-12-31T00:00:00.000Z",
    };

    const ev1 = createVerificationEvidence(baseInput);
    const ev2 = createVerificationEvidence(baseInput);

    // Same content (modulo random evidenceId) → same integrity hash
    const content1 = { ...ev1, evidenceId: "fixed" };
    const content2 = { ...ev2, evidenceId: "fixed" };
    assert.strictEqual(
      computeEvidenceIntegrityHash(content1),
      computeEvidenceIntegrityHash(content2),
    );
  });

  it("different seed produces different replay state (configs not equivalent)", () => {
    const a = { seed: 42, clockStart: 0, environmentId: "e", environmentHash: "h" };
    const b = { seed: 99, clockStart: 0, environmentId: "e", environmentHash: "h" };
    assert.ok(!ReplayEngine.configsEquivalent(a, b));
  });

  it("dataset hash is stable across computations", () => {
    const base = {
      datasetId: "ds-x",
      historicalWindow: { startTime: "2026-01-01T00:00:00.000Z", endTime: "2026-02-01T00:00:00.000Z", durationMs: 2678400000 },
      evidenceSources: [{ sourceId: "s", sourceType: "execution_evidence" as const, referenceCount: 5 }],
      evidenceCount: 5,
      policySnapshot: { policyId: "p", policyVersion: "v1", policyHash: "h", capturedAt: "2026-01-01T00:00:00.000Z", rules: 1 },
      topologySnapshot: { agentCount: 1, activePolicies: [], runtimeVersion: "v1" },
      telemetrySnapshot: { metricNames: [], sampleCount: 0, timeRangeMs: 0 },
      agentConfigurationSnapshot: { agentIds: [], configurationHashes: {} },
      constructionMetadata: { constructionStrategy: "time_window" as const, evidenceFilterCriteria: {}, snapshotVersions: {} },
      createdAt: "2026-02-01T00:00:00.000Z",
    };
    const h1 = computeDatasetHash(base);
    const h2 = computeDatasetHash(base);
    assert.strictEqual(h1, h2);
  });
});
