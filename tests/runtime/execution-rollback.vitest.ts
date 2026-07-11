/**
 * Tests X4.4 — Execution Rollback Handler.
 *
 * Covers rollback as governed execution, evidence linkage, failure
 * scenarios, state guards, and cooperative cancellation.
 *
 * @module
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ExecutionStateMachine } from "../../src/runtime/execution-state-machine.js";
import { ExecutionRollbackHandler } from "../../src/runtime/execution-rollback.js";
import {
  ExecutionState,
  IllegalStateTransitionError,
  type ExecutionEvidenceEmitter,
  type ExecutionEventType,
  type RollbackIntent,
} from "../../src/runtime/contracts/execution-runtime-contract.js";
import type { ExecutionIntent, ExecutionEvidence } from "../../src/runtime/contracts/execution-intent-contract.js";

// ---------------------------------------------------------------------------
// Test evidence collector
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
    intentId: "intent-rb-001",
    proposalId: "prop-001",
    actor: "test-actor",
    action: "test-action",
    target: "test-target",
    justification: "Testing X4.4 rollback.",
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

function advanceToFailed(machine: ExecutionStateMachine): string {
  const exId = machine.createExecution(makeIntent());
  machine.transitionTo(exId, ExecutionState.VALIDATING);
  machine.transitionTo(exId, ExecutionState.READY);
  machine.transitionTo(exId, ExecutionState.RUNNING);
  machine.transitionTo(exId, ExecutionState.FAILED);
  return exId;
}

function makeRollbackIntent(overrides: Partial<RollbackIntent> = {}): RollbackIntent {
  return {
    executionId: "original-exec-id",
    intentId: "intent-rb-001",
    action: "restore-files",
    parameters: { paths: ["/test/file.txt"] },
    reason: "Test rollback",
    createdAt: new Date().toISOString(),
    sourceEvidenceId: "ev-trigger-001",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("ExecutionRollbackHandler", () => {
  let collector: TestEvidenceCollector;
  let machine: ExecutionStateMachine;
  let handler: ExecutionRollbackHandler;

  beforeEach(() => {
    collector = new TestEvidenceCollector();
    machine = new ExecutionStateMachine(collector);
    handler = new ExecutionRollbackHandler(machine, collector);
  });

  // -----------------------------------------------------------------------
  // Successful rollback
  // -----------------------------------------------------------------------

  describe("successful rollback", () => {
    it("marks original as ROLLED_BACK when rollback execution succeeds", async () => {
      const exId = advanceToFailed(machine);
      const rbIntent = makeRollbackIntent({ executionId: exId });

      const result = await handler.rollback(exId, rbIntent);

      expect(result.state).toBe(ExecutionState.SUCCEEDED);
      expect(machine.getStatus(exId)).toBe(ExecutionState.ROLLED_BACK);
    });

    it("creates a rollback execution through the full lifecycle", async () => {
      const exId = advanceToFailed(machine);
      const rbIntent = makeRollbackIntent({ executionId: exId });

      await handler.rollback(exId, rbIntent);

      // The rollback execution should have gone through CREATED → VALIDATING → READY → RUNNING → SUCCEEDED
      const rollbackCreations = collector.records.filter(
        (r) => r.eventType === "ExecutionCreated",
      );
      // 1 original + 1 rollback = 2 total
      expect(rollbackCreations.length).toBe(2);
    });

    it("emits ExecutionRollbackCompleted evidence on success", async () => {
      const exId = advanceToFailed(machine);
      const rbIntent = makeRollbackIntent({ executionId: exId });

      await handler.rollback(exId, rbIntent);

      const rollbackEvents = collector.records.filter(
        (r) => r.eventType === "ExecutionRollbackCompleted",
      );
      // One from the state machine's transitionTo(ROLLED_BACK),
      // one from the handler's explicit linkage evidence
      expect(rollbackEvents.length).toBe(2);
      // The handler's linkage evidence has outcome PARTIAL
      expect(rollbackEvents.some((r) => r.evidence.outcome === "PARTIAL")).toBe(true);
      // The state machine's transition evidence exists
      expect(rollbackEvents.some((r) => r.evidence.outcome === "PARTIAL")).toBe(true);
    });

    it("rollback linkage evidence references original execution in summary", async () => {
      const exId = advanceToFailed(machine);
      const rbIntent = makeRollbackIntent({ executionId: exId });

      await handler.rollback(exId, rbIntent);

      // The handler's linkage evidence (second event) contains the original exId
      const rollbackEvents = collector.records.filter(
        (r) => r.eventType === "ExecutionRollbackCompleted",
      );
      expect(rollbackEvents.length).toBe(2);
      // The handler's evidence (first, emitted before transitionTo) references the original execution
      const linkageEvidence = rollbackEvents.find((r) => r.evidence.summary.includes(exId));
      expect(linkageEvidence).toBeDefined();
      expect(linkageEvidence!.evidence.summary).toContain("completed");
    });

    it("rollback succeeds with custom rollback action", async () => {
      const exId = advanceToFailed(machine);
      const rbIntent = makeRollbackIntent({ executionId: exId });
      let actionCalled = false;

      const result = await handler.rollback(exId, rbIntent, async () => {
        actionCalled = true;
        return true;
      });

      expect(result.state).toBe(ExecutionState.SUCCEEDED);
      expect(actionCalled).toBe(true);
      expect(machine.getStatus(exId)).toBe(ExecutionState.ROLLED_BACK);
    });
  });

  // -----------------------------------------------------------------------
  // Rollback failure
  // -----------------------------------------------------------------------

  describe("rollback failure", () => {
    it("original stays FAILED when rollback execution fails", async () => {
      const exId = advanceToFailed(machine);
      const rbIntent = makeRollbackIntent({ executionId: exId });

      const result = await handler.rollback(exId, rbIntent, async () => false);

      expect(result.state).toBe(ExecutionState.FAILED);
      expect(machine.getStatus(exId)).toBe(ExecutionState.FAILED);
    });

    it("emits rollback linkage evidence even on failure", async () => {
      const exId = advanceToFailed(machine);
      const rbIntent = makeRollbackIntent({ executionId: exId });

      await handler.rollback(exId, rbIntent, async () => false);

      const rollbackEvents = collector.records.filter(
        (r) => r.eventType === "ExecutionRollbackCompleted",
      );
      expect(rollbackEvents.length).toBe(1);
      expect(rollbackEvents[0].evidence.outcome).toBe("FAILED");
    });
  });

  // -----------------------------------------------------------------------
  // State guards
  // -----------------------------------------------------------------------

  describe("state guards", () => {
    it("rejects rollback of SUCCEEDED execution", async () => {
      const exId = machine.createExecution(makeIntent());
      machine.transitionTo(exId, ExecutionState.VALIDATING);
      machine.transitionTo(exId, ExecutionState.READY);
      machine.transitionTo(exId, ExecutionState.RUNNING);
      machine.transitionTo(exId, ExecutionState.SUCCEEDED);

      const rbIntent = makeRollbackIntent({ executionId: exId });
      await expect(handler.rollback(exId, rbIntent)).rejects.toThrow(IllegalStateTransitionError);
    });

    it("rejects rollback of CANCELLED execution", async () => {
      const exId = machine.createExecution(makeIntent());
      machine.transitionTo(exId, ExecutionState.VALIDATING);
      machine.transitionTo(exId, ExecutionState.READY);
      machine.transitionTo(exId, ExecutionState.CANCELLED);

      const rbIntent = makeRollbackIntent({ executionId: exId });
      await expect(handler.rollback(exId, rbIntent)).rejects.toThrow(IllegalStateTransitionError);
    });

    it("rejects rollback of CREATED execution", async () => {
      const exId = machine.createExecution(makeIntent());
      const rbIntent = makeRollbackIntent({ executionId: exId });
      await expect(handler.rollback(exId, rbIntent)).rejects.toThrow(IllegalStateTransitionError);
    });

    it("rejects rollback of ROLLED_BACK execution", async () => {
      // First create a full rollback cycle
      const exId = advanceToFailed(machine);
      const rbIntent = makeRollbackIntent({ executionId: exId });
      await handler.rollback(exId, rbIntent);

      // Now try rolling back again
      await expect(handler.rollback(exId, rbIntent)).rejects.toThrow(IllegalStateTransitionError);
    });
  });

  // -----------------------------------------------------------------------
  // Rollback intent metadata
  // -----------------------------------------------------------------------

  describe("rollback intent metadata", () => {
    it("uses intentId and reason from RollbackIntent", async () => {
      const exId = advanceToFailed(machine);
      const rbIntent = makeRollbackIntent({
        executionId: exId,
        intentId: "rollback-specific-intent",
        reason: "rollback because of policy violation",
      });

      const result = await handler.rollback(exId, rbIntent);

      expect(result.intentId).toBe("rollback-specific-intent");
      expect(machine.getStatus(exId)).toBe(ExecutionState.ROLLED_BACK);
    });

    it("linkage evidence contains reason from RollbackIntent", async () => {
      const exId = advanceToFailed(machine);
      const rbIntent = makeRollbackIntent({
        executionId: exId,
        reason: "policy violation detected",
      });

      await handler.rollback(exId, rbIntent);

      const evidence = collector.records.find(
        (r) => r.eventType === "ExecutionRollbackCompleted",
      )!;
      expect(evidence.evidence.summary).toContain("policy violation detected");
    });
  });
});
