/**
 * Invariant test: Determinism — same dataset + proposal + config produces
 * the same evidence hash.
 *
 * @module invariant-determinism
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ReplayEngine,
  createVerificationEvidence,
  computeEvidenceIntegrityHash,
  type ReplayDataset,
  type ReplayExecutor,
  type DeterministicEvent,
} from "../../../../src/evolution/verification/index.js";

function makeDataset(): ReplayDataset {
  return {
    datasetId: "ds-1",
    datasetHash: "h",
    historicalWindow: { startTime: "2026-01-01T00:00:00.000Z", endTime: "2026-02-01T00:00:00.000Z", durationMs: 2678400000 },
    evidenceSources: [],
    evidenceCount: 0,
    policySnapshot: { policyId: "p", policyVersion: "v1", policyHash: "h", capturedAt: "2026-01-01T00:00:00.000Z", rules: 1 },
    topologySnapshot: { agentCount: 1, activePolicies: [], runtimeVersion: "v1" },
    telemetrySnapshot: { metricNames: [], sampleCount: 0, timeRangeMs: 0 },
    agentConfigurationSnapshot: { agentIds: [], configurationHashes: {} },
    constructionMetadata: { constructionStrategy: "time_window", evidenceFilterCriteria: {}, snapshotVersions: {} },
    createdAt: "2026-02-01T00:00:00.000Z",
  };
}

const executor: ReplayExecutor = {
  async processEvent() {
    return { events: [], metricDeltas: { processed: 1 } };
  },
};

describe("Invariant: Determinism", () => {
  it("same inputs produce identical replay metrics across runs", async () => {
    const dataset = makeDataset();
    const config = { seed: 42, clockStart: 0, environmentId: "e", environmentHash: "h" };
    const streams: DeterministicEvent[][] = [
      [{ sourceId: "s", tick: 1, sequenceNumber: 1, payload: null }],
      [{ sourceId: "s", tick: 2, sequenceNumber: 1, payload: null }],
    ];

    const r1 = await new ReplayEngine(config).execute(dataset, executor, streams);
    const r2 = await new ReplayEngine(config).execute(dataset, executor, streams);

    assert.deepStrictEqual(r1.metrics, r2.metrics);
    assert.strictEqual(r1.ticksExecuted, r2.ticksExecuted);
    assert.strictEqual(r1.events.length, r2.events.length);
  });

  it("same evidence content produces identical integrity hash", () => {
    const input = {
      verificationId: "v-1",
      proposalId: "p-1",
      replayDatasetId: "d-1",
      proposalSnapshotHash: "h",
      environmentHash: "h",
      baselineMetrics: { m: 1 },
      candidateMetrics: { m: 2 },
      metricDeltas: { m: 1 },
      behavioralChanges: [],
      confidenceProfile: { replayFidelity: 0.9, coverage: 0.9, determinism: 1.0, historicalSimilarity: 0.9, overallConfidence: 0.81 },
      reproducibilityLevel: 2 as const,
      lineage: [],
      verifiedAt: "2026-07-12T00:00:00.000Z",
      expiresAt: "2099-12-31T00:00:00.000Z",
    };

    const ev1 = createVerificationEvidence(input);
    const ev2 = createVerificationEvidence(input);

    // Normalize the random evidenceId before hashing
    const c1 = { ...ev1, evidenceId: "x" };
    const c2 = { ...ev2, evidenceId: "x" };

    assert.strictEqual(computeEvidenceIntegrityHash(c1), computeEvidenceIntegrityHash(c2));
  });

  it("integrity hash changes when content changes", () => {
    const baseInput = {
      verificationId: "v-1",
      proposalId: "p-1",
      replayDatasetId: "d-1",
      proposalSnapshotHash: "h",
      environmentHash: "h",
      baselineMetrics: { m: 1 },
      candidateMetrics: { m: 2 },
      metricDeltas: { m: 1 },
      behavioralChanges: [],
      confidenceProfile: { replayFidelity: 0.9, coverage: 0.9, determinism: 1.0, historicalSimilarity: 0.9, overallConfidence: 0.81 },
      reproducibilityLevel: 2 as const,
      lineage: [],
      verifiedAt: "2026-07-12T00:00:00.000Z",
      expiresAt: "2099-12-31T00:00:00.000Z",
    };

    const ev1 = createVerificationEvidence(baseInput);
    const ev2 = createVerificationEvidence({ ...baseInput, candidateMetrics: { m: 3 } });

    const c1 = { ...ev1, evidenceId: "x" };
    const c2 = { ...ev2, evidenceId: "x" };

    assert.notStrictEqual(computeEvidenceIntegrityHash(c1), computeEvidenceIntegrityHash(c2));
  });

  it("reproducibility level 2 (artifact) is the default target", () => {
    // Evidence constructed for governance carries reproducibilityLevel 2
    const evidence = createVerificationEvidence({
      verificationId: "v-1",
      proposalId: "p-1",
      replayDatasetId: "d-1",
      proposalSnapshotHash: "h",
      environmentHash: "h",
      baselineMetrics: {},
      candidateMetrics: {},
      metricDeltas: {},
      behavioralChanges: [],
      confidenceProfile: { replayFidelity: 1, coverage: 1, determinism: 1, historicalSimilarity: 1, overallConfidence: 1 },
      reproducibilityLevel: 2,
      lineage: [],
      verifiedAt: "2026-07-12T00:00:00.000Z",
      expiresAt: "2099-12-31T00:00:00.000Z",
    });

    assert.strictEqual(evidence.reproducibilityLevel, 2);
    // Integrity hash is deterministic → supports byte-identical reproduction
    assert.strictEqual(evidence.integrityHash, computeEvidenceIntegrityHash(evidence));
  });
});
