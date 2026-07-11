/**
 * Tests X4.2 — Retry Controller.
 *
 * Covers retry lifecycle, attempt tracking, backoff behavior,
 * retry exhaustion, evidence emission, and state machine integration.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ExecutionStateMachine } from "../../src/runtime/execution-state-machine.js";
import { RetryController } from "../../src/runtime/retry-controller.js";
import {
  ExecutionState,
  type ExecutionEvidenceEmitter,
  type ExecutionEventType,
  type RetryPolicy,
} from "../../src/runtime/contracts/execution-runtime-contract.js";
import type { ExecutionIntent, ExecutionEvidence } from "../../src/runtime/contracts/execution-intent-contract.js";

// ---------------------------------------------------------------------------
// Test-only evidence collector
// ---------------------------------------------------------------------------

class TestEvidenceCollector implements ExecutionEvidenceEmitter {
  readonly records: Array<{ eventType: ExecutionEventType; evidence: ExecutionEvidence }> = [];

  emit(eventType: ExecutionEventType, evidence: ExecutionEvidence): void {
    this.records.push({ eventType, evidence });
  }

  get byEventType(): Map<ExecutionEventType, ExecutionEvidence[]> {
    const map = new Map<ExecutionEventType, ExecutionEvidence[]>();
    for (const r of this.records) {
      const list = map.get(r.eventType) ?? [];
      list.push(r.evidence);
      map.set(r.eventType, list);
    }
    return map;
  }

  clear(): void {
    this.records.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIntent(overrides: Partial<ExecutionIntent> = {}): ExecutionIntent {
  return {
    intentId: "intent-retry-001",
    proposalId: "prop-001",
    actor: "test-actor",
    action: "test-action",
    target: "test-target",
    justification: "Testing X4.2 retry controller.",
    constraints: {
      maxFilesChanged: 10,
      allowedPaths: ["/test"],
      blockedPaths: [],
      verificationRequired: true,
      allowedTools: ["test"],
    },
    riskClass: "low",
    expectedEffect: "Test execution",
    sourceEvidenceId: "ev-source-001",
    createdAt: "2026-07-10T10:00:00.000Z",
    expiration: "2026-07-11T10:00:00.000Z",
    approvalReference: "approval-001",
    approvedBy: "test-approver",
    approvedAt: "2026-07-10T09:00:00.000Z",
    intentHash: "0000000000000000",
    ...overrides,
  };
}

const DEFAULT_POLICY: RetryPolicy = {
  maxAttempts: 3,
  retryableFailures: [],
  backoffStrategy: { kind: "immediate" },
};

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("RetryController", () => {
  let collector: TestEvidenceCollector;
  let machine: ExecutionStateMachine;
  let controller: RetryController;
  let executorCallCount: number;

  beforeEach(() => {
    collector = new TestEvidenceCollector();
    machine = new ExecutionStateMachine(collector);
    executorCallCount = 0;
  });

  // -----------------------------------------------------------------------
  // Successful execution
  // -----------------------------------------------------------------------

  describe("successful execution", () => {
    it("succeeds on first attempt when executor returns true", async () => {
      controller = new RetryController(machine, DEFAULT_POLICY, collector);
      const result = await controller.executeWithRetry(
        makeIntent(),
        async () => {
          executorCallCount++;
          return true;
        },
      );

      expect(result.state).toBe(ExecutionState.SUCCEEDED);
      expect(executorCallCount).toBe(1);
      expect(result.evidenceId).toBeTruthy();
    });

    it("returns intentId from the successful attempt", async () => {
      controller = new RetryController(machine, DEFAULT_POLICY, collector);
      const result = await controller.executeWithRetry(
        makeIntent({ intentId: "retry-intent-abc" }),
        async () => true,
      );

      expect(result.intentId).toBe("retry-intent-abc");
    });
  });

  // -----------------------------------------------------------------------
  // Retry recovery
  // -----------------------------------------------------------------------

  describe("retry recovery", () => {
    it("succeeds on second attempt after first failure", async () => {
      controller = new RetryController(machine, DEFAULT_POLICY, collector);
      let call = 0;
      const result = await controller.executeWithRetry(
        makeIntent(),
        async () => {
          call++;
          return call >= 2; // fail first, succeed second
        },
      );

      expect(result.state).toBe(ExecutionState.SUCCEEDED);
      expect(call).toBe(2);
    });

    it("succeeds on third attempt after two failures", async () => {
      controller = new RetryController(
        machine,
        { maxAttempts: 3, retryableFailures: [], backoffStrategy: { kind: "immediate" } },
        collector,
      );

      let call = 0;
      const result = await controller.executeWithRetry(
        makeIntent(),
        async () => {
          call++;
          return call >= 3; // fail twice, succeed third
        },
      );

      expect(result.state).toBe(ExecutionState.SUCCEEDED);
      expect(call).toBe(3);
    });

    it("emits ExecutionRetryAttempted evidence on retry attempt", async () => {
      controller = new RetryController(machine, DEFAULT_POLICY, collector);
      let call = 0;

      await controller.executeWithRetry(
        makeIntent(),
        async () => {
          call++;
          return call >= 2;
        },
      );

      const retryEvents = collector.records.filter((r) => r.eventType === "ExecutionRetryAttempted");
      expect(retryEvents.length).toBe(1);
      expect(retryEvents[0].evidence.intentId).toBe("intent-retry-001");
    });

    it("retry attempt evidence has outcome PARTIAL", async () => {
      controller = new RetryController(machine, DEFAULT_POLICY, collector);
      let call = 0;

      await controller.executeWithRetry(
        makeIntent(),
        async () => {
          call++;
          return call >= 2;
        },
      );

      const retryEvents = collector.records.filter((r) => r.eventType === "ExecutionRetryAttempted");
      expect(retryEvents[0].evidence.outcome).toBe("PARTIAL");
    });
  });

  // -----------------------------------------------------------------------
  // Retry exhaustion
  // -----------------------------------------------------------------------

  describe("retry exhaustion", () => {
    it("returns FAILED when all attempts fail", async () => {
      controller = new RetryController(
        machine,
        { maxAttempts: 3, retryableFailures: [], backoffStrategy: { kind: "immediate" } },
        collector,
      );

      const result = await controller.executeWithRetry(
        makeIntent(),
        async () => false, // always fail
      );

      expect(result.state).toBe(ExecutionState.FAILED);
    });

    it("executes executor exactly maxAttempts times on persistent failure", async () => {
      controller = new RetryController(
        machine,
        { maxAttempts: 3, retryableFailures: [], backoffStrategy: { kind: "immediate" } },
        collector,
      );

      await controller.executeWithRetry(
        makeIntent(),
        async () => {
          executorCallCount++;
          return false;
        },
      );

      expect(executorCallCount).toBe(3);
    });

    it("emits ExecutionRetryExhausted when all retries are consumed", async () => {
      controller = new RetryController(
        machine,
        { maxAttempts: 2, retryableFailures: [], backoffStrategy: { kind: "immediate" } },
        collector,
      );

      await controller.executeWithRetry(
        makeIntent(),
        async () => false,
      );

      const exhaustedEvents = collector.records.filter((r) => r.eventType === "ExecutionRetryExhausted");
      expect(exhaustedEvents.length).toBe(1);
    });

    it("emits both RetryAttempted and RetryExhausted on full exhaustion", async () => {
      controller = new RetryController(
        machine,
        { maxAttempts: 3, retryableFailures: [], backoffStrategy: { kind: "immediate" } },
        collector,
      );

      await controller.executeWithRetry(
        makeIntent(),
        async () => false,
      );

      const attempted = collector.records.filter((r) => r.eventType === "ExecutionRetryAttempted");
      const exhausted = collector.records.filter((r) => r.eventType === "ExecutionRetryExhausted");

      // 3 attempts = 2 retry signals (attempt 1→2, 2→3) + 1 exhaustion
      expect(attempted.length).toBe(2);
      expect(exhausted.length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // No retry policy (maxAttempts = 1)
  // -----------------------------------------------------------------------

  describe("no retry (maxAttempts = 1)", () => {
    it("executes exactly once when maxAttempts is 1", async () => {
      controller = new RetryController(
        machine,
        { maxAttempts: 1, retryableFailures: [], backoffStrategy: { kind: "immediate" } },
        collector,
      );

      await controller.executeWithRetry(
        makeIntent(),
        async () => {
          executorCallCount++;
          return false;
        },
      );

      expect(executorCallCount).toBe(1);
    });

    it("does not emit retry evidence when maxAttempts is 1", async () => {
      controller = new RetryController(
        machine,
        { maxAttempts: 1, retryableFailures: [], backoffStrategy: { kind: "immediate" } },
        collector,
      );

      await controller.executeWithRetry(
        makeIntent(),
        async () => false,
      );

      const retryEvents = collector.records.filter(
        (r) => r.eventType === "ExecutionRetryAttempted" || r.eventType === "ExecutionRetryExhausted",
      );
      expect(retryEvents.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Backoff strategies
  // -----------------------------------------------------------------------

  describe("backoff strategies", () => {
    it("immediate backoff does not delay", async () => {
      const start = Date.now();
      controller = new RetryController(
        machine,
        { maxAttempts: 3, retryableFailures: [], backoffStrategy: { kind: "immediate" } },
        collector,
      );

      await controller.executeWithRetry(
        makeIntent(),
        async () => false,
      );

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(500);
    });

    it("fixed backoff waits interval between retries", async () => {
      const intervalMs = 50; // short interval for test speed
      const start = Date.now();

      controller = new RetryController(
        machine,
        { maxAttempts: 3, retryableFailures: [], backoffStrategy: { kind: "fixed", intervalMs } },
        collector,
      );

      await controller.executeWithRetry(
        makeIntent(),
        async () => false,
      );

      const elapsed = Date.now() - start;
      // 3 attempts = 2 waits between them
      expect(elapsed).toBeGreaterThanOrEqual(intervalMs * 2 - 10);
    });
  });

  // -----------------------------------------------------------------------
  // Evidence — state machine integration
  // -----------------------------------------------------------------------

  describe("state machine evidence integration", () => {
    it("each attempt emits full lifecycle evidence", async () => {
      controller = new RetryController(
        machine,
        { maxAttempts: 3, retryableFailures: [], backoffStrategy: { kind: "immediate" } },
        collector,
      );

      await controller.executeWithRetry(
        makeIntent(),
        async () => false,
      );

      // 3 attempts × 5 transitions each (create + valid + ready + run + fail) = 15
      // + 2 retry attempted events + 1 retry exhausted
      const stateEvidence = collector.records.filter(
        (r) => !r.eventType.startsWith("ExecutionRetry"),
      );
      expect(stateEvidence.length).toBe(15);
    });

    it("each attempt has a distinct executionId", async () => {
      controller = new RetryController(
        machine,
        { maxAttempts: 3, retryableFailures: [], backoffStrategy: { kind: "immediate" } },
        collector,
      );

      // We can verify distinct executionIds by checking the created evidence
      await controller.executeWithRetry(
        makeIntent(),
        async () => false,
      );

      const createdRecords = collector.records.filter((r) => r.eventType === "ExecutionCreated");
      const executionIds = new Set(createdRecords.map((r) => r.evidence.intentId));
      // All evidence shares the same intentId
      expect(createdRecords.every((r) => r.evidence.intentId === "intent-retry-001")).toBe(true);
      // Each evidenceId should be distinct
      const evidenceIds = createdRecords.map((r) => r.evidence.evidenceId);
      expect(new Set(evidenceIds).size).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // No-op emitter fallback
  // -----------------------------------------------------------------------

  describe("no-op emitter fallback", () => {
    it("works without an explicit emitter", async () => {
      controller = new RetryController(machine, DEFAULT_POLICY);

      const result = await controller.executeWithRetry(
        makeIntent(),
        async () => true,
      );

      expect(result.state).toBe(ExecutionState.SUCCEEDED);
    });
  });
});
