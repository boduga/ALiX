/**
 * Tests A2.2 — ReplayEngine.
 *
 * @module replay-engine
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ReplayEngine,
  type ReplayExecutor,
  type DeterministicEvent,
} from "../../../src/evolution/verification/index.js";
import type { ReplayDataset } from "../../../src/evolution/verification/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDataset(): ReplayDataset {
  return {
    datasetId: "ds-001",
    datasetHash: "hash-001",
    historicalWindow: {
      startTime: "2026-05-01T00:00:00.000Z",
      endTime: "2026-07-01T00:00:00.000Z",
      durationMs: 5270400000,
    },
    evidenceSources: [],
    evidenceCount: 0,
    policySnapshot: {
      policyId: "policy-1",
      policyVersion: "v1",
      policyHash: "h",
      capturedAt: "2026-05-01T00:00:00.000Z",
      rules: 1,
    },
    topologySnapshot: { agentCount: 1, activePolicies: [], runtimeVersion: "v1" },
    telemetrySnapshot: { metricNames: [], sampleCount: 0, timeRangeMs: 0 },
    agentConfigurationSnapshot: { agentIds: [], configurationHashes: {} },
    constructionMetadata: {
      constructionStrategy: "time_window",
      evidenceFilterCriteria: {},
      snapshotVersions: {},
    },
    createdAt: "2026-07-01T00:00:00.000Z",
  };
}

/** An executor that counts events and emits a derived event per input. */
function countingExecutor(): ReplayExecutor {
  return {
    async processEvent(event) {
      return {
        events: [{ ...event, sourceId: `${event.sourceId}-out`, sequenceNumber: event.sequenceNumber }],
        metricDeltas: { events_processed: 1 },
      };
    },
  };
}

/** An executor that throws on every event. */
function failingExecutor(): ReplayExecutor {
  return {
    async processEvent() {
      throw new Error("Intentional executor failure");
    },
  };
}

// ---------------------------------------------------------------------------
// ReplayEngine
// ---------------------------------------------------------------------------

describe("ReplayEngine", () => {
  it("deterministic: same inputs produce same result", async () => {
    const config = {
      seed: 42,
      clockStart: 0,
      environmentId: "env-001",
      environmentHash: "hash-env-001",
    };

    const streams: DeterministicEvent[][] = [
      [{ sourceId: "a", tick: 1, sequenceNumber: 1, payload: null }],
      [{ sourceId: "b", tick: 2, sequenceNumber: 1, payload: null }],
    ];

    const engine1 = new ReplayEngine(config);
    const engine2 = new ReplayEngine(config);

    const result1 = await engine1.execute(makeDataset(), countingExecutor(), streams);
    const result2 = await engine2.execute(makeDataset(), countingExecutor(), streams);

    assert.strictEqual(result1.events.length, result2.events.length);
    assert.deepStrictEqual(result1.metrics, result2.metrics);
    assert.strictEqual(result1.ticksExecuted, result2.ticksExecuted);
  });

  it("different seed produces potentially different results (configs not equivalent)", () => {
    assert.ok(
      !ReplayEngine.configsEquivalent(
        { seed: 42, clockStart: 0, environmentId: "e", environmentHash: "h" },
        { seed: 43, clockStart: 0, environmentId: "e", environmentHash: "h" },
      ),
    );
  });

  it("processes input events through executor and collects metrics", async () => {
    const engine = new ReplayEngine({
      seed: 42,
      clockStart: 0,
      environmentId: "env-001",
      environmentHash: "hash-env-001",
    });

    const streams: DeterministicEvent[][] = [
      [
        { sourceId: "a", tick: 1, sequenceNumber: 1, payload: null },
        { sourceId: "a", tick: 2, sequenceNumber: 2, payload: null },
        { sourceId: "a", tick: 3, sequenceNumber: 3, payload: null },
      ],
    ];

    const result = await engine.execute(makeDataset(), countingExecutor(), streams);

    assert.strictEqual(result.events.length, 3);
    assert.strictEqual(result.metrics.events_processed, 3);
    assert.strictEqual(result.errors.length, 0);
  });

  it("executor errors are isolated and typed", async () => {
    const engine = new ReplayEngine({
      seed: 42,
      clockStart: 0,
      environmentId: "env-001",
      environmentHash: "hash-env-001",
    });

    const streams: DeterministicEvent[][] = [
      [
        { sourceId: "a", tick: 1, sequenceNumber: 1, payload: null },
        { sourceId: "a", tick: 2, sequenceNumber: 2, payload: null },
      ],
    ];

    const result = await engine.execute(makeDataset(), failingExecutor(), streams);

    assert.strictEqual(result.errors.length, 2);
    assert.strictEqual(result.errors[0].kind, "ProposalExecutionFailure");
    assert.ok(result.errors[0].message.includes("Intentional executor failure"));
    // Error isolation: both events processed despite failures
    assert.strictEqual(result.errors.length, 2);
  });

  it("empty input streams produce empty result", async () => {
    const engine = new ReplayEngine({
      seed: 42,
      clockStart: 0,
      environmentId: "env-001",
      environmentHash: "hash-env-001",
    });

    const result = await engine.execute(makeDataset(), countingExecutor(), []);

    assert.strictEqual(result.events.length, 0);
    assert.strictEqual(Object.keys(result.metrics).length, 0);
    assert.strictEqual(result.errors.length, 0);
  });

  it("rejects config with missing environmentId", () => {
    assert.throws(() => new ReplayEngine({
      seed: 42,
      clockStart: 0,
      environmentId: "",
      environmentHash: "h",
    }));
  });

  it("rejects config with missing environmentHash", () => {
    assert.throws(() => new ReplayEngine({
      seed: 42,
      clockStart: 0,
      environmentId: "e",
      environmentHash: "",
    }));
  });

  it("rejects config with non-finite seed", () => {
    assert.throws(() => new ReplayEngine({
      seed: NaN,
      clockStart: 0,
      environmentId: "e",
      environmentHash: "h",
    }));
  });

  it("configsEquivalent returns true for identical configs", () => {
    const a = { seed: 42, clockStart: 0, environmentId: "e", environmentHash: "h" };
    const b = { seed: 42, clockStart: 99, environmentId: "different", environmentHash: "h" };
    assert.ok(ReplayEngine.configsEquivalent(a, b));
  });

  it("events processed in deterministic merge order", async () => {
    const engine = new ReplayEngine({
      seed: 42,
      clockStart: 0,
      environmentId: "env-001",
      environmentHash: "hash-env-001",
    });

    // Stream b has earlier tick — should be processed first
    const streams: DeterministicEvent[][] = [
      [{ sourceId: "a", tick: 5, sequenceNumber: 1, payload: null }],
      [{ sourceId: "b", tick: 1, sequenceNumber: 1, payload: null }],
    ];

    const result = await engine.execute(makeDataset(), countingExecutor(), streams);

    assert.strictEqual(result.events[0].sourceId, "b-out");
    assert.strictEqual(result.events[1].sourceId, "a-out");
  });
});
