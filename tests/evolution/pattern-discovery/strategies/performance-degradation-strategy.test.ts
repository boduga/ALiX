/**
 * Tests A1.3 — PerformanceDegradationStrategy
 *
 * Covers latency trend detection, threshold filtering, empty data,
 * boundary conditions, and confidence scoring.
 *
 * @module performance-degradation-strategy
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PerformanceDegradationStrategy } from "../../../../src/evolution/pattern-discovery/strategies/performance-degradation-strategy.js";
import type { DiscoveryContext } from "../../../../src/evolution/contracts/discovery-context.js";
import type { ExecutionEvidence } from "../../../../src/runtime/contracts/execution-intent-contract.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_MS = 1000 * 60 * 60 * 24 * 5; // 5 days ago (ensures within 14-day window)

function makeEvidence(
  overrides: Partial<ExecutionEvidence> & { startedAt: string; completedAt: string },
): ExecutionEvidence {
  return {
    evidenceId: `ev-${Math.random().toString(36).slice(2, 8)}`,
    intentId: "agent/workflow/run-01",
    outcome: "SUCCESS",
    summary: "Execution completed",
    artifacts: [],
    verificationPassed: true,
    evidenceHash: "hash-placeholder",
    ...overrides,
  };
}

/**
 * Create a set of evidence records with a given latency pattern.
 *
 * @param count - Number of records.
 * @param baseLatencyMs - Latency for the first record (in ms).
 * @param incrementMs - Latency increase per record.
 * @param intentId - Intent ID for all records.
 */
function createLatencySeries(
  count: number,
  baseLatencyMs: number,
  incrementMs: number,
  intentId = "agent/workflow/run-01",
): ExecutionEvidence[] {
  const records: ExecutionEvidence[] = [];
  const baseTime = Date.now() - BASE_MS;

  for (let i = 0; i < count; i++) {
    const startMs = baseTime + i * 60_000; // 1 minute apart
    const latency = baseLatencyMs + i * incrementMs;
    records.push(makeEvidence({
      evidenceId: `ev-latency-${intentId.replace(/[^a-z]/g, "")}-${i}`,
      intentId: `${intentId}`,
      startedAt: new Date(startMs).toISOString(),
      completedAt: new Date(startMs + latency).toISOString(),
      outcome: "SUCCESS",
    }));
  }

  return records;
}

// ---------------------------------------------------------------------------
// PerformanceDegradationStrategy
// ---------------------------------------------------------------------------

describe("PerformanceDegradationStrategy", () => {
  it("emits pattern when latency degrades past threshold", async () => {
    // Use a monotonic series: 12 records increasing 50ms each → ~500% total increase
    const evidence = createLatencySeries(12, 100, 50, "agent/workflow/run-01");

    const strategy = new PerformanceDegradationStrategy({
      minimumExecutions: 8,
      degradationThreshold: 0.5,
      baselineCount: 20,
    });

    const context: DiscoveryContext = { evidence, governanceEvents: [] };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 1, "should emit 1 pattern for degrading latency");
    assert.strictEqual(patterns[0].category, "performance_degradation");
    assert.ok(patterns[0].description.includes("latency increase"));
    assert.ok(patterns[0].frequency >= 12);
  });

  it("returns empty when latency is stable", async () => {
    // 12 records all at ~100ms → no degradation
    const evidence = createLatencySeries(12, 100, 2, "agent/workflow/run-01");

    const strategy = new PerformanceDegradationStrategy({
      minimumExecutions: 8,
      degradationThreshold: 0.5,
      baselineCount: 20,
    });

    const context: DiscoveryContext = { evidence, governanceEvents: [] };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 0, "should not emit pattern for stable latency");
  });

  it("returns empty when execution count is below minimum", async () => {
    const evidence = createLatencySeries(3, 100, 100, "agent/workflow/run-01");

    const strategy = new PerformanceDegradationStrategy({
      minimumExecutions: 10,
      degradationThreshold: 0.5,
      baselineCount: 20,
    });

    const context: DiscoveryContext = { evidence, governanceEvents: [] };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 0, "should not emit pattern below minimum count");
  });

  it("returns empty when degradation is below threshold", async () => {
    // 12 records with tiny 3ms increment each: total increase ~33% (below 50% threshold)
    const evidence = createLatencySeries(12, 100, 3, "agent/workflow/run-01");

    const strategy = new PerformanceDegradationStrategy({
      minimumExecutions: 8,
      degradationThreshold: 0.5,
      baselineCount: 20,
    });

    const context: DiscoveryContext = { evidence, governanceEvents: [] };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 0, "should not emit for sub-threshold degradation");
  });

  it("ignores FAILED and PARTIAL outcomes", async () => {
    const evidence: ExecutionEvidence[] = [];
    const baseTime = Date.now() - BASE_MS;

    // 10 failed records (should be ignored)
    for (let i = 0; i < 10; i++) {
      evidence.push(makeEvidence({
        evidenceId: `ev-fail-${i}`,
        intentId: "agent/workflow/run-01",
        startedAt: new Date(baseTime + i * 60_000).toISOString(),
        completedAt: new Date(baseTime + i * 60_000 + 500).toISOString(),
        outcome: "FAILED",
      }));
    }

    const strategy = new PerformanceDegradationStrategy({
      minimumExecutions: 5,
      degradationThreshold: 0.5,
      baselineCount: 20,
    });

    const context: DiscoveryContext = { evidence, governanceEvents: [] };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 0, "should ignore non-SUCCESS outcomes");
  });

  it("evidence outside lookback window is filtered out", async () => {
    const evidence: ExecutionEvidence[] = [];
    const oldMs = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days ago

    // 10 old records (should be filtered out with 14-day window)
    for (let i = 0; i < 10; i++) {
      evidence.push(makeEvidence({
        evidenceId: `ev-old-${i}`,
        intentId: "agent/workflow/run-01",
        startedAt: new Date(oldMs + i * 60_000).toISOString(),
        completedAt: new Date(oldMs + i * 60_000 + 100).toISOString(),
        outcome: "SUCCESS",
      }));
    }

    const strategy = new PerformanceDegradationStrategy({
      minimumExecutions: 5,
      degradationThreshold: 0.5,
      lookbackWindowDays: 14,
      baselineCount: 20,
    });

    const context: DiscoveryContext = { evidence, governanceEvents: [] };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 0, "should not emit for filtered-out evidence");
  });

  it("grouping by normalized intent ID works across run suffixes", async () => {
    // Two run suffixes with staggered timestamps to avoid interleaving.
    // run-01: 6 records with times base+0..+300k, all at 100ms
    // run-02: 6 records with times base+600k..+900k, all at 400ms
    // Normalized path "agent/workflow" groups them — 12 records total.
    const baseTime1 = Date.now() - 5 * 24 * 60 * 60 * 1000;
    const baseTime2 = baseTime1 + 600_000;

    const run1: ExecutionEvidence[] = [];
    const run2: ExecutionEvidence[] = [];
    for (let i = 0; i < 6; i++) {
      run1.push(makeEvidence({
        evidenceId: `ev-run1-${i}`,
        intentId: "agent/workflow/run-01",
        startedAt: new Date(baseTime1 + i * 60_000).toISOString(),
        completedAt: new Date(baseTime1 + i * 60_000 + 100).toISOString(),
        outcome: "SUCCESS",
      }));
      run2.push(makeEvidence({
        evidenceId: `ev-run2-${i}`,
        intentId: "agent/workflow/run-02",
        startedAt: new Date(baseTime2 + i * 60_000).toISOString(),
        completedAt: new Date(baseTime2 + i * 60_000 + 400).toISOString(),
        outcome: "SUCCESS",
      }));
    }

    const strategy = new PerformanceDegradationStrategy({
      minimumExecutions: 8,
      degradationThreshold: 0.5,
      baselineCount: 20,
    });

    const context: DiscoveryContext = { evidence: [...run1, ...run2], governanceEvents: [] };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 1, "should group runs under same normalized ID");
    assert.ok(patterns[0].patternId.includes("agent/workflow"));
  });

  it("confidence score is always in [0, 1] range", async () => {
    // Aggressive monotonic increase: 12 records, 200ms increment each
    const evidence = createLatencySeries(12, 100, 200, "agent/workflow/run-01");

    const strategy = new PerformanceDegradationStrategy({
      minimumExecutions: 8,
      degradationThreshold: 0.3,
      baselineCount: 5,
    });

    const context: DiscoveryContext = { evidence, governanceEvents: [] };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 1);
    assert.ok(
      patterns[0].confidence >= 0 && patterns[0].confidence <= 1,
      `confidence ${patterns[0].confidence} should be in [0, 1]`,
    );
  });

  it("empty evidence returns empty", async () => {
    const strategy = new PerformanceDegradationStrategy();
    const context: DiscoveryContext = { evidence: [], governanceEvents: [] };
    const patterns = await strategy.run(context);

    assert.deepStrictEqual(patterns, []);
  });

  it("firstObserved <= lastObserved", async () => {
    // Use a monotonic series (gradual increase) so the pattern emits
    const evidence = createLatencySeries(12, 100, 40, "agent/workflow/run-01");

    const strategy = new PerformanceDegradationStrategy({
      minimumExecutions: 8,
      degradationThreshold: 0.3,
      baselineCount: 20,
    });

    const context: DiscoveryContext = { evidence, governanceEvents: [] };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 1, "should emit a pattern for monotonic latency");
    assert.ok(
      patterns[0].firstObserved <= patterns[0].lastObserved,
      `firstObserved (${patterns[0].firstObserved}) should be <= lastObserved (${patterns[0].lastObserved})`,
    );
  });

  it("detects gradual latency degradation (monotonic increase)", async () => {
    // 12 records increasing by 50ms each: 100, 150, 200, ... → clear trend
    const evidence = createLatencySeries(12, 100, 50, "agent/workflow/run-01");

    const strategy = new PerformanceDegradationStrategy({
      minimumExecutions: 8,
      degradationThreshold: 0.3,
      baselineCount: 20,
    });

    const context: DiscoveryContext = { evidence, governanceEvents: [] };
    const patterns = await strategy.run(context);

    assert.strictEqual(patterns.length, 1, "should detect gradual monotonic increase");
  });
});
