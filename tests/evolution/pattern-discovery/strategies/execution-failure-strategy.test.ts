// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import test from "node:test";
import assert from "node:assert/strict";
import {
  ExecutionFailureStrategy,
} from "../../../../src/evolution/pattern-discovery/strategies/execution-failure-strategy.js";
import { normalizeIntentId } from "../../../../src/evolution/pattern-discovery/strategies/strategy-utils.js";
import type { DiscoveryContext } from "../../../../src/evolution/contracts/discovery-context.js";
import type { ExecutionEvidence } from "../../../../src/runtime/contracts/execution-intent-contract.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let evSeq = 0;

function makeEvidence(
  overrides: {
    intentId: string;
    completedAt: string;
    outcome?: "SUCCESS" | "FAILED" | "PARTIAL";
    evidenceId?: string;
  },
): ExecutionEvidence {
  return {
    evidenceId: overrides.evidenceId ?? `ev-${++evSeq}`,
    intentId: overrides.intentId,
    startedAt: new Date(Date.now() - 3600_000).toISOString(),
    completedAt: overrides.completedAt,
    outcome: overrides.outcome ?? "FAILED",
    summary: "test execution evidence",
    artifacts: [],
    verificationPassed: false,
    evidenceHash: "test-hash",
  };
}

function makeContext(evidence: ExecutionEvidence[]): DiscoveryContext {
  return { evidence, governanceEvents: [] };
}

// ---------------------------------------------------------------------------
// normalizeIntentId
// ---------------------------------------------------------------------------

test("normalizeIntentId strips path after final separator", () => {
  assert.equal(normalizeIntentId("agent/workflow/run-01"), "agent/workflow");
});

test("normalizeIntentId returns input unchanged when no separator present", () => {
  assert.equal(normalizeIntentId("task-001"), "task-001");
});

// ---------------------------------------------------------------------------
// ExecutionFailureStrategy
// ---------------------------------------------------------------------------

test("repeated failures emit pattern when meeting minimum occurrences", async () => {
  const strategy = new ExecutionFailureStrategy({ minimumOccurrences: 3 });
  const now = Date.now();

  const evidence = [
    makeEvidence({ intentId: "agent/workflow/run-01", completedAt: new Date(now - 86400_000).toISOString() }),
    makeEvidence({ intentId: "agent/workflow/run-02", completedAt: new Date(now - 43200_000).toISOString() }),
    makeEvidence({ intentId: "agent/workflow/run-03", completedAt: new Date(now - 10_000).toISOString() }),
  ];

  const patterns = await strategy.run(makeContext(evidence));

  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].category, "execution_failure");
  assert.equal(patterns[0].frequency, 3);
  assert.equal(patterns[0].evidenceIds.length, 3);
});

test("below threshold returns empty patterns", async () => {
  const strategy = new ExecutionFailureStrategy({ minimumOccurrences: 5 });
  const now = Date.now();

  const evidence = [
    makeEvidence({ intentId: "agent/workflow/run-01", completedAt: new Date(now - 10_000).toISOString() }),
    makeEvidence({ intentId: "agent/workflow/run-02", completedAt: new Date(now - 5_000).toISOString() }),
  ];

  const patterns = await strategy.run(makeContext(evidence));

  assert.equal(patterns.length, 0);
});

test("evidence outside lookback window is filtered out", async () => {
  const strategy = new ExecutionFailureStrategy({
    minimumOccurrences: 1,
    lookbackWindowDays: 7,
  });

  const oldDate = new Date(Date.now() - 20 * 86400_000).toISOString(); // 20 days ago

  const evidence = [
    makeEvidence({ intentId: "agent/workflow/run-01", completedAt: oldDate }),
  ];

  const patterns = await strategy.run(makeContext(evidence));

  assert.equal(patterns.length, 0);
});

test("successful executions are ignored; only FAILED counts", async () => {
  const strategy = new ExecutionFailureStrategy({ minimumOccurrences: 1 });
  const now = Date.now();

  const evidence = [
    makeEvidence({ intentId: "agent/workflow/run-01", completedAt: new Date(now - 10_000).toISOString(), outcome: "FAILED" }),
    makeEvidence({ intentId: "agent/workflow/run-02", completedAt: new Date(now - 5_000).toISOString(), outcome: "SUCCESS" }),
    makeEvidence({ intentId: "agent/workflow/run-03", completedAt: new Date(now - 2_000).toISOString(), outcome: "SUCCESS" }),
  ];

  const patterns = await strategy.run(makeContext(evidence));

  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].frequency, 1);
  assert.equal(patterns[0].evidenceIds.length, 1);
});

test("intent normalization groups failures with different run suffixes", async () => {
  const strategy = new ExecutionFailureStrategy({ minimumOccurrences: 3 });
  const now = Date.now();

  // Different run-N suffixes, all normalize to "agent/workflow"
  const evidence = [
    makeEvidence({ intentId: "agent/workflow/run-01", completedAt: new Date(now - 10_000).toISOString() }),
    makeEvidence({ intentId: "agent/workflow/run-02", completedAt: new Date(now - 5_000).toISOString() }),
    makeEvidence({ intentId: "agent/workflow/run-03", completedAt: new Date(now - 1_000).toISOString() }),
  ];

  const patterns = await strategy.run(makeContext(evidence));

  assert.equal(patterns.length, 1);
  assert.ok(patterns[0].patternId.includes("agent/workflow"));
});

test("confidence score is always in [0, 1] range", async () => {
  const strategy = new ExecutionFailureStrategy({ minimumOccurrences: 3 });
  const now = Date.now();

  const evidence = [
    makeEvidence({ intentId: "agent/workflow/run-01", completedAt: new Date(now - 86400_000).toISOString() }),
    makeEvidence({ intentId: "agent/workflow/run-02", completedAt: new Date(now - 43200_000).toISOString() }),
    makeEvidence({ intentId: "agent/workflow/run-03", completedAt: new Date(now - 10_000).toISOString() }),
  ];

  const patterns = await strategy.run(makeContext(evidence));

  assert.equal(patterns.length, 1);
  assert.ok(patterns[0].confidence >= 0, `confidence ${patterns[0].confidence} must be >= 0`);
  assert.ok(patterns[0].confidence <= 1, `confidence ${patterns[0].confidence} must be <= 1`);
});
