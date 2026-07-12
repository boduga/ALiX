/**
 * Tests A1.1 — PatternDiscoveryEngine
 *
 * Covers pipeline orchestration, error isolation, store failure propagation,
 * empty store handling, and sequential strategy execution.
 *
 * @module pattern-discovery-engine
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { PatternObservation } from "../../../src/evolution/contracts/pattern-discovery-contract.js";
import type { DetectionStrategy } from "../../../src/evolution/pattern-discovery/detection-strategy.js";
import { PatternDiscoveryEngine } from "../../../src/evolution/pattern-discovery/pattern-discovery-engine.js";
import type { DiscoveryContext } from "../../../src/evolution/contracts/discovery-context.js";

// ---------------------------------------------------------------------------
// Sample patterns
// ---------------------------------------------------------------------------

const pattern1: PatternObservation = {
  patternId: "test-pattern-1",
  category: "execution_failure",
  frequency: 3,
  confidence: 0.8,
  evidenceIds: ["ev-001"],
  description: "Test execution failure pattern",
  firstObserved: "2026-07-01T00:00:00.000Z",
  lastObserved: "2026-07-10T00:00:00.000Z",
};

const pattern2: PatternObservation = {
  patternId: "test-pattern-2",
  category: "approval_friction",
  frequency: 5,
  confidence: 0.6,
  evidenceIds: ["gov-001"],
  description: "Test approval friction pattern",
  firstObserved: "2026-07-05T00:00:00.000Z",
  lastObserved: "2026-07-12T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// PatternDiscoveryEngine
// ---------------------------------------------------------------------------

describe("PatternDiscoveryEngine", () => {
  it("multiple strategies produce combined patterns", async () => {
    const strategy1: DetectionStrategy = {
      name: "Strategy1",
      category: "execution_failure",
      run: async (_ctx: DiscoveryContext) => [pattern1],
    };
    const strategy2: DetectionStrategy = {
      name: "Strategy2",
      category: "approval_friction",
      run: async (_ctx: DiscoveryContext) => [pattern2],
    };

    const engine = new PatternDiscoveryEngine({
      evidenceStore: { list: mock.fn(async () => []) } as any,
      auditStore: { listChronological: mock.fn(async () => []) } as any,
      strategies: [strategy1, strategy2],
    });

    const result = await engine.run();

    assert.strictEqual(result.patterns.length, 2);
    assert.strictEqual(result.metadata.strategiesRun, 2);
    assert.ok(result.patterns.some((p) => p.patternId === "test-pattern-1"));
    assert.ok(result.patterns.some((p) => p.patternId === "test-pattern-2"));
  });

  it("strategies execute in order (deterministic)", async () => {
    const execOrder: string[] = [];
    const strategy1: DetectionStrategy = {
      name: "Strategy1",
      category: "execution_failure",
      run: async (_ctx: DiscoveryContext) => {
        execOrder.push("Strategy1");
        return [];
      },
    };
    const strategy2: DetectionStrategy = {
      name: "Strategy2",
      category: "approval_friction",
      run: async (_ctx: DiscoveryContext) => {
        execOrder.push("Strategy2");
        return [];
      },
    };

    const engine = new PatternDiscoveryEngine({
      evidenceStore: { list: mock.fn(async () => []) } as any,
      auditStore: { listChronological: mock.fn(async () => []) } as any,
      strategies: [strategy1, strategy2],
    });

    await engine.run();

    assert.deepStrictEqual(execOrder, ["Strategy1", "Strategy2"]);
  });

  it("failed strategy does not stop pipeline", async () => {
    const failingStrategy: DetectionStrategy = {
      name: "FailingStrategy",
      category: "execution_failure",
      run: async (_ctx: DiscoveryContext) => {
        throw new Error("Intentional failure");
      },
    };
    const workingStrategy: DetectionStrategy = {
      name: "WorkingStrategy",
      category: "approval_friction",
      run: async (_ctx: DiscoveryContext) => [pattern2],
    };

    const engine = new PatternDiscoveryEngine({
      evidenceStore: { list: mock.fn(async () => []) } as any,
      auditStore: { listChronological: mock.fn(async () => []) } as any,
      strategies: [failingStrategy, workingStrategy],
    });

    const result = await engine.run();

    // Working strategy's patterns should still be present
    assert.strictEqual(result.patterns.length, 1);
    assert.strictEqual(result.patterns[0].patternId, "test-pattern-2");
  });

  it("failed strategies appear in metadata.strategiesFailed", async () => {
    const failingStrategy: DetectionStrategy = {
      name: "BrokenStrategy",
      category: "execution_failure",
      run: async (_ctx: DiscoveryContext) => {
        throw new Error("Simulated failure");
      },
    };

    const engine = new PatternDiscoveryEngine({
      evidenceStore: { list: mock.fn(async () => []) } as any,
      auditStore: { listChronological: mock.fn(async () => []) } as any,
      strategies: [failingStrategy],
    });

    const result = await engine.run();

    assert.ok(result.metadata.strategiesFailed);
    assert.strictEqual(result.metadata.strategiesFailed.length, 1);
    assert.strictEqual(result.metadata.strategiesFailed[0], "BrokenStrategy");
  });

  it("empty stores produce empty result", async () => {
    const strategy: DetectionStrategy = {
      name: "EmptyStrategy",
      category: "execution_failure",
      run: async (_ctx: DiscoveryContext) => [],
    };

    const engine = new PatternDiscoveryEngine({
      evidenceStore: { list: mock.fn(async () => []) } as any,
      auditStore: { listChronological: mock.fn(async () => []) } as any,
      strategies: [strategy],
    });

    const result = await engine.run();

    assert.strictEqual(result.patterns.length, 0);
    assert.strictEqual(result.candidates.length, 0);
    assert.strictEqual(result.drafts.length, 0);
    assert.strictEqual(result.metadata.evidenceScanned, 0);
  });

  it("store failure propagates to caller", async () => {
    const engine = new PatternDiscoveryEngine({
      evidenceStore: {
        list: mock.fn(async () => {
          throw new Error("Database connection failed");
        }),
      } as any,
      auditStore: { listChronological: mock.fn(async () => []) } as any,
      strategies: [],
    });

    await assert.rejects(
      async () => engine.run(),
      /Database connection failed/,
    );
  });
});
