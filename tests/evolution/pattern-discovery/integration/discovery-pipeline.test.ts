/**
 * A1.1 — Discovery Pipeline Integration Test
 *
 * Wires real detection strategies with in-memory mock stores
 * through the PatternDiscoveryEngine. Verifies the full pipeline:
 *
 *   In-memory stores
 *     |
 *     v
 *   PatternDiscoveryEngine
 *     |
 *     v
 *   DiscoveryContext (evidence + governanceEvents)
 *     |
 *     v
 *   ExecutionFailureStrategy + ApprovalFrictionStrategy (real instances)
 *     |
 *     v
 *   DiscoveryResult with patterns + metadata
 *
 * @module discovery-pipeline-integration
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { PatternDiscoveryEngine } from "../../../../src/evolution/pattern-discovery/pattern-discovery-engine.js";
import { ExecutionFailureStrategy } from "../../../../src/evolution/pattern-discovery/strategies/execution-failure-strategy.js";
import { ApprovalFrictionStrategy } from "../../../../src/evolution/pattern-discovery/strategies/approval-friction-strategy.js";
import type { ExecutionEvidence } from "../../../../src/runtime/contracts/execution-intent-contract.js";
import type { GovernanceAuditEvent } from "../../../../src/governance/audit-types.js";

// ---------------------------------------------------------------------------
// Integration: Full pipeline
// ---------------------------------------------------------------------------

describe("Pattern discovery integration pipeline", () => {
  it("wires real strategies with in-memory stores and produces patterns", async () => {
    const now = new Date();
    const day = (offset: number): string => {
      const d = new Date(now);
      d.setDate(d.getDate() - offset);
      return d.toISOString();
    };

    // -----------------------------------------------------------------------
    // Test data
    // -----------------------------------------------------------------------

    // 3 failed executions + 1 successful → ExecutionFailureStrategy produces 1 pattern
    const evidenceRecords: ExecutionEvidence[] = [
      {
        evidenceId: "ev-fail-1",
        intentId: "agent/workflow/run-01",
        startedAt: day(2),
        completedAt: day(2),
        outcome: "FAILED",
        summary: "Execution failed",
        artifacts: [],
        verificationPassed: false,
        evidenceHash: "hash-1",
      },
      {
        evidenceId: "ev-fail-2",
        intentId: "agent/workflow/run-01",
        startedAt: day(1),
        completedAt: day(1),
        outcome: "FAILED",
        summary: "Execution failed again",
        artifacts: [],
        verificationPassed: false,
        evidenceHash: "hash-2",
      },
      {
        evidenceId: "ev-fail-3",
        intentId: "agent/workflow/run-01",
        startedAt: day(0),
        completedAt: day(0),
        outcome: "FAILED",
        summary: "Execution failed third time",
        artifacts: [],
        verificationPassed: false,
        evidenceHash: "hash-3",
      },
      {
        evidenceId: "ev-success-1",
        intentId: "agent/workflow/run-02",
        startedAt: day(0),
        completedAt: day(0),
        outcome: "SUCCESS",
        summary: "Execution succeeded",
        artifacts: ["result.json"],
        verificationPassed: true,
        evidenceHash: "hash-4",
      },
    ];

    // 1 action_denied event → ApprovalFrictionStrategy produces 1 pattern with low threshold
    const governanceEvents: GovernanceAuditEvent[] = [
      {
        eventId: "audit-1",
        timestamp: day(0),
        eventType: "action_denied",
        actorType: "agent",
        actorId: "alix-agent",
        subjectType: "action",
        subjectId: "action-1",
        action: "execute_workflow",
        decision: "denied",
        policyId: null,
        policyVersion: null,
        ruleId: null,
        reason: "Policy violation",
        evidenceRefs: [],
        requestId: null,
        traceId: "trace-1",
        sessionId: null,
        parentEventId: null,
        riskLevel: "medium",
        requiresHumanReview: false,
        metadata: {},
        previousHash: null,
        eventHash: "audit-hash-1",
      },
    ];

    // -----------------------------------------------------------------------
    // In-memory mock stores (mock.fn from node:test)
    // -----------------------------------------------------------------------

    const mockEvidenceStore = {
      list: mock.fn(async () => evidenceRecords),
    };

    const mockAuditStore = {
      listChronological: mock.fn(async () => governanceEvents),
    };

    // -----------------------------------------------------------------------
    // Real strategy instances with configs tuned for test data
    // -----------------------------------------------------------------------

    // Default config: minimumOccurrences=3 → matches our 3 FAILED records
    const failureStrategy = new ExecutionFailureStrategy();

    // Low threshold config: 1 denied event → 100% denial rate > 50% threshold
    const frictionStrategy = new ApprovalFrictionStrategy({
      minimumEvents: 1,
      denialRateThreshold: 0.5,
    });

    // -----------------------------------------------------------------------
    // Engine wired with mocks + real strategies
    // -----------------------------------------------------------------------

    const engine = new PatternDiscoveryEngine({
      evidenceStore: mockEvidenceStore as any,
      auditStore: mockAuditStore as any,
      strategies: [failureStrategy, frictionStrategy],
    });

    const result = await engine.run();

    // -----------------------------------------------------------------------
    // Assertions
    // -----------------------------------------------------------------------

    // Stores were called
    assert.strictEqual(
      mockEvidenceStore.list.mock.callCount(),
      1,
      "evidenceStore.list should be called once",
    );
    assert.strictEqual(
      mockAuditStore.listChronological.mock.callCount(),
      1,
      "auditStore.listChronological should be called once",
    );

    // Both strategies produced patterns
    assert.strictEqual(
      result.patterns.length,
      2,
      "should produce 2 patterns (1 per strategy)",
    );

    // --- ExecutionFailureStrategy pattern ---
    const failurePattern = result.patterns.find(
      (p) => p.category === "execution_failure",
    );
    assert.ok(failurePattern, "should have an execution_failure pattern");
    assert.strictEqual(failurePattern!.frequency, 3);
    assert.strictEqual(failurePattern!.evidenceIds.length, 3);
    assert.ok(
      failurePattern!.patternId.startsWith("execution_failure:"),
      `patternId should start with execution_failure, got ${failurePattern!.patternId}`,
    );
    assert.ok(
      failurePattern!.description.includes("execution failure(s)"),
      `description should mention execution failure, got ${failurePattern!.description}`,
    );
    assert.ok(
      failurePattern!.firstObserved <= failurePattern!.lastObserved,
      "firstObserved should be <= lastObserved",
    );

    // --- ApprovalFrictionStrategy pattern ---
    const frictionPattern = result.patterns.find(
      (p) => p.category === "approval_friction",
    );
    assert.ok(frictionPattern, "should have an approval_friction pattern");
    assert.strictEqual(frictionPattern!.frequency, 1);
    assert.strictEqual(frictionPattern!.evidenceIds.length, 1);
    assert.ok(
      frictionPattern!.patternId.startsWith("approval_friction:"),
      `patternId should start with approval_friction, got ${frictionPattern!.patternId}`,
    );
    assert.ok(
      frictionPattern!.description.includes("denied governance action"),
      `description should mention denied governance action, got ${frictionPattern!.description}`,
    );

    // Both confidences in valid range
    for (const pattern of result.patterns) {
      assert.ok(
        pattern.confidence >= 0 && pattern.confidence <= 1,
        `confidence ${pattern.confidence} should be in [0, 1] for pattern ${pattern.patternId}`,
      );
    }

    // --- Metadata ---
    assert.strictEqual(
      result.metadata.evidenceScanned,
      5,
      "evidenceScanned should be 4 evidence + 1 governance event = 5",
    );
    assert.strictEqual(result.metadata.strategiesRun, 2);
    assert.ok(
      result.metadata.detectionDurationMs >= 0,
      "detectionDurationMs should be non-negative",
    );

    // Empty stubs are present
    assert.deepStrictEqual(result.candidates, []);
    assert.deepStrictEqual(result.drafts, []);

    // strategiesFailed should be absent when all strategies succeed
    assert.strictEqual(
      result.metadata.strategiesFailed,
      undefined,
      "strategiesFailed should be undefined when all strategies succeed",
    );
  });
});
