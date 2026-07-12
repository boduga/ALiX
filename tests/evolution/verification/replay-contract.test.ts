/**
 * Tests A2.1 — Replay Dataset Contract.
 *
 * Covers ReplayDataset validation, dataset hash determinism, and
 * HistoricalWindow validation.
 *
 * @module replay-contract
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeDatasetHash,
  validateReplayDataset,
  validateHistoricalWindow,
} from "../../../src/evolution/verification/index.js";
import type { ReplayDataset } from "../../../src/evolution/verification/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDataset(overrides: Partial<ReplayDataset> = {}): ReplayDataset {
  return {
    datasetId: "ds-001",
    datasetHash: "hash-placeholder",
    historicalWindow: {
      startTime: "2026-05-01T00:00:00.000Z",
      endTime: "2026-07-01T00:00:00.000Z",
      durationMs: 5270400000,
    },
    evidenceSources: [
      { sourceId: "x3b", sourceType: "execution_evidence", referenceCount: 12000 },
    ],
    evidenceCount: 12000,
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
// computeDatasetHash
// ---------------------------------------------------------------------------

describe("computeDatasetHash", () => {
  it("produces deterministic hash for identical content", () => {
    const ds1 = makeDataset();
    const ds2 = makeDataset();
    const h1 = computeDatasetHash(ds1);
    const h2 = computeDatasetHash(ds2);
    assert.strictEqual(h1, h2, "identical content must produce identical hash");
  });

  it("produces different hash when content differs", () => {
    const ds1 = makeDataset();
    const ds2 = makeDataset({ evidenceCount: 9999 });
    assert.notStrictEqual(computeDatasetHash(ds1), computeDatasetHash(ds2));
  });

  it("produces a 64-character hex SHA-256 digest", () => {
    const hash = computeDatasetHash(makeDataset());
    assert.strictEqual(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("ignores datasetHash field in computation", () => {
    const ds1 = makeDataset({ datasetHash: "aaa" });
    const ds2 = makeDataset({ datasetHash: "bbb" });
    assert.strictEqual(computeDatasetHash(ds1), computeDatasetHash(ds2));
  });

  it("order-independent for object keys (canonical serialization)", () => {
    const ds1 = makeDataset();
    const ds2 = makeDataset({
      constructionMetadata: {
        evidenceFilterCriteria: { window_days: 60 },
        constructionStrategy: "time_window" as const,
        snapshotVersions: { policy: "v3" },
      },
    });
    assert.strictEqual(computeDatasetHash(ds1), computeDatasetHash(ds2));
  });
});

// ---------------------------------------------------------------------------
// validateReplayDataset
// ---------------------------------------------------------------------------

describe("validateReplayDataset", () => {
  it("accepts a valid dataset", () => {
    const result = validateReplayDataset(makeDataset());
    assert.ok(result.valid, `expected valid, got: ${result.errors.join(", ")}`);
  });

  it("rejects null input", () => {
    assert.equal(validateReplayDataset(null).valid, false);
  });

  it("rejects missing datasetId", () => {
    const result = validateReplayDataset(makeDataset({ datasetId: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("datasetId")));
  });

  it("rejects missing historicalWindow", () => {
    const result = validateReplayDataset(makeDataset({ historicalWindow: undefined as unknown as ReplayDataset["historicalWindow"] }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("historicalWindow")));
  });

  it("rejects negative evidenceCount", () => {
    const result = validateReplayDataset(makeDataset({ evidenceCount: -1 }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("evidenceCount")));
  });
});

// ---------------------------------------------------------------------------
// validateHistoricalWindow
// ---------------------------------------------------------------------------

describe("validateHistoricalWindow", () => {
  it("accepts a valid window", () => {
    const result = validateHistoricalWindow({
      startTime: "2026-05-01T00:00:00.000Z",
      endTime: "2026-07-01T00:00:00.000Z",
      durationMs: 5270400000,
    });
    assert.ok(result.valid);
  });

  it("rejects missing startTime", () => {
    const result = validateHistoricalWindow({
      startTime: "",
      endTime: "2026-07-01T00:00:00.000Z",
      durationMs: 1000,
    });
    assert.equal(result.valid, false);
  });

  it("rejects negative durationMs", () => {
    const result = validateHistoricalWindow({
      startTime: "2026-05-01T00:00:00.000Z",
      endTime: "2026-07-01T00:00:00.000Z",
      durationMs: -1,
    });
    assert.equal(result.valid, false);
  });
});
