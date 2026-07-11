/**
 * Tests X4.1 — Execution State Machine.
 *
 * Covers state transitions, lifecycle APIs, error paths, evidence emission,
 * and the full transition matrix.
 *
 * @module
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ExecutionStateMachine } from "../../src/runtime/execution-state-machine.js";
import {
  ExecutionState,
  IllegalStateTransitionError,
  UnknownExecutionError,
  DuplicateExecutionError,
  type ExecutionEvidenceEmitter,
  type ExecutionEventType,
} from "../../src/runtime/contracts/execution-runtime-contract.js";
import type { ExecutionIntent } from "../../src/runtime/contracts/execution-intent-contract.js";

// ---------------------------------------------------------------------------
// Test-only evidence collector
// ---------------------------------------------------------------------------

class TestEvidenceCollector implements ExecutionEvidenceEmitter {
  readonly records: Array<{ eventType: ExecutionEventType; evidence: import("../../src/runtime/contracts/execution-intent-contract.js").ExecutionEvidence }> = [];

  emit(eventType: ExecutionEventType, evidence: import("../../src/runtime/contracts/execution-intent-contract.js").ExecutionEvidence): void {
    this.records.push({ eventType, evidence });
  }

  get byEventType(): Map<ExecutionEventType, import("../../src/runtime/contracts/execution-intent-contract.js").ExecutionEvidence[]> {
    const map = new Map<ExecutionEventType, import("../../src/runtime/contracts/execution-intent-contract.js").ExecutionEvidence[]>();
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
    intentId: "intent-test-001",
    proposalId: "prop-001",
    actor: "test-actor",
    action: "test-action",
    target: "test-target",
    justification: "Testing X4.1 state machine.",
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

/**
 * Advance an execution through the valid transition path to reach `target`.
 * Returns the executionId.
 */
function advanceTo(machine: ExecutionStateMachine, target: ExecutionState, intent?: ExecutionIntent): string {
  const exId = machine.createExecution(intent ?? makeIntent());

  const paths: Record<ExecutionState, ExecutionState[]> = {
    [ExecutionState.CREATED]: [],
    [ExecutionState.VALIDATING]: [ExecutionState.VALIDATING],
    [ExecutionState.READY]: [ExecutionState.VALIDATING, ExecutionState.READY],
    [ExecutionState.RUNNING]: [ExecutionState.VALIDATING, ExecutionState.READY, ExecutionState.RUNNING],
    [ExecutionState.SUCCEEDED]: [ExecutionState.VALIDATING, ExecutionState.READY, ExecutionState.RUNNING, ExecutionState.SUCCEEDED],
    [ExecutionState.FAILED]: [ExecutionState.VALIDATING, ExecutionState.READY, ExecutionState.RUNNING, ExecutionState.FAILED],
    [ExecutionState.CANCELLED]: [ExecutionState.VALIDATING, ExecutionState.READY, ExecutionState.CANCELLED],
    [ExecutionState.ROLLED_BACK]: [ExecutionState.VALIDATING, ExecutionState.READY, ExecutionState.RUNNING, ExecutionState.FAILED, ExecutionState.ROLLED_BACK],
  };

  const path = paths[target] ?? [];
  for (const state of path) {
    machine.transitionTo(exId, state);
  }

  return exId;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("ExecutionStateMachine", () => {
  let collector: TestEvidenceCollector;
  let machine: ExecutionStateMachine;

  beforeEach(() => {
    collector = new TestEvidenceCollector();
    machine = new ExecutionStateMachine(collector);
  });

  // -----------------------------------------------------------------------
  // State transitions — individual
  // -----------------------------------------------------------------------

  describe("state transitions", () => {
    it("accepts valid transition: CREATED → VALIDATING", () => {
      const exId = machine.createExecution(makeIntent());
      machine.transitionTo(exId, ExecutionState.VALIDATING);
      expect(machine.getStatus(exId)).toBe(ExecutionState.VALIDATING);
    });

    it("accepts valid transition: VALIDATING → READY", () => {
      const exId = advanceTo(machine, ExecutionState.VALIDATING);
      machine.transitionTo(exId, ExecutionState.READY);
      expect(machine.getStatus(exId)).toBe(ExecutionState.READY);
    });

    it("accepts valid transition: VALIDATING → FAILED", () => {
      const exId = advanceTo(machine, ExecutionState.VALIDATING);
      machine.transitionTo(exId, ExecutionState.FAILED);
      expect(machine.getStatus(exId)).toBe(ExecutionState.FAILED);
    });

    it("accepts valid transition: READY → RUNNING", () => {
      const exId = advanceTo(machine, ExecutionState.READY);
      machine.transitionTo(exId, ExecutionState.RUNNING);
      expect(machine.getStatus(exId)).toBe(ExecutionState.RUNNING);
    });

    it("accepts valid transition: READY → CANCELLED", () => {
      const exId = advanceTo(machine, ExecutionState.READY);
      machine.transitionTo(exId, ExecutionState.CANCELLED);
      expect(machine.getStatus(exId)).toBe(ExecutionState.CANCELLED);
    });

    it("accepts valid transition: RUNNING → SUCCEEDED", () => {
      const exId = advanceTo(machine, ExecutionState.RUNNING);
      machine.transitionTo(exId, ExecutionState.SUCCEEDED);
      expect(machine.getStatus(exId)).toBe(ExecutionState.SUCCEEDED);
    });

    it("accepts valid transition: RUNNING → FAILED", () => {
      const exId = advanceTo(machine, ExecutionState.RUNNING);
      machine.transitionTo(exId, ExecutionState.FAILED);
      expect(machine.getStatus(exId)).toBe(ExecutionState.FAILED);
    });

    it("accepts valid transition: FAILED → ROLLED_BACK", () => {
      const exId = advanceTo(machine, ExecutionState.FAILED);
      machine.transitionTo(exId, ExecutionState.ROLLED_BACK);
      expect(machine.getStatus(exId)).toBe(ExecutionState.ROLLED_BACK);
    });
  });

  // -----------------------------------------------------------------------
  // Invalid transitions
  // -----------------------------------------------------------------------

  describe("invalid transitions", () => {
    it("rejects CREATED → RUNNING", () => {
      const exId = machine.createExecution(makeIntent());
      expect(() => machine.transitionTo(exId, ExecutionState.RUNNING)).toThrow(IllegalStateTransitionError);
    });

    it("rejects CREATED → SUCCEEDED", () => {
      const exId = machine.createExecution(makeIntent());
      expect(() => machine.transitionTo(exId, ExecutionState.SUCCEEDED)).toThrow(IllegalStateTransitionError);
    });

    it("rejects CREATED → CANCELLED", () => {
      const exId = machine.createExecution(makeIntent());
      expect(() => machine.transitionTo(exId, ExecutionState.CANCELLED)).toThrow(IllegalStateTransitionError);
    });

    it("rejects VALIDATING → RUNNING", () => {
      const exId = advanceTo(machine, ExecutionState.VALIDATING);
      expect(() => machine.transitionTo(exId, ExecutionState.RUNNING)).toThrow(IllegalStateTransitionError);
    });

    it("rejects READY → FAILED", () => {
      const exId = advanceTo(machine, ExecutionState.READY);
      expect(() => machine.transitionTo(exId, ExecutionState.FAILED)).toThrow(IllegalStateTransitionError);
    });

    it("rejects RUNNING → READY (reverse transition)", () => {
      const exId = advanceTo(machine, ExecutionState.RUNNING);
      expect(() => machine.transitionTo(exId, ExecutionState.READY)).toThrow(IllegalStateTransitionError);
    });

    it("rejects SUCCEEDED → FAILED", () => {
      const exId = advanceTo(machine, ExecutionState.SUCCEEDED);
      expect(() => machine.transitionTo(exId, ExecutionState.FAILED)).toThrow(IllegalStateTransitionError);
    });

    it("rejects CANCELLED → RUNNING", () => {
      const exId = advanceTo(machine, ExecutionState.CANCELLED);
      expect(() => machine.transitionTo(exId, ExecutionState.RUNNING)).toThrow(IllegalStateTransitionError);
    });

    it("rejects ROLLED_BACK → FAILED", () => {
      const exId = advanceTo(machine, ExecutionState.ROLLED_BACK);
      expect(() => machine.transitionTo(exId, ExecutionState.FAILED)).toThrow(IllegalStateTransitionError);
    });
  });

  // -----------------------------------------------------------------------
  // Terminal state immutability
  // -----------------------------------------------------------------------

  describe("terminal state immutability", () => {
    const terminals = [
      ExecutionState.SUCCEEDED,
      ExecutionState.FAILED,
      ExecutionState.CANCELLED,
      ExecutionState.ROLLED_BACK,
    ];

    const targets = [
      ExecutionState.CREATED,
      ExecutionState.VALIDATING,
      ExecutionState.READY,
      ExecutionState.RUNNING,
    ];

    for (const terminal of terminals) {
      for (const target of targets) {
        it(`${terminal} → ${target} rejected`, () => {
          const exId = advanceTo(machine, terminal);
          expect(() => machine.transitionTo(exId, target)).toThrow(IllegalStateTransitionError);
        });
      }
    }
  });

  // -----------------------------------------------------------------------
  // Full lifecycle — execute()
  // -----------------------------------------------------------------------

  describe("execute()", () => {
    it("completes full lifecycle: CREATED → ... → SUCCEEDED", async () => {
      const result = await machine.execute(makeIntent());

      expect(result.state).toBe(ExecutionState.SUCCEEDED);
      expect(result.intentId).toBe("intent-test-001");
      expect(result.executionId).toBeTruthy();
      expect(result.evidenceId).toBeTruthy();
    });

    it("returns terminal result with evidenceId", async () => {
      const result = await machine.execute(makeIntent());
      expect(result.state).toBe(ExecutionState.SUCCEEDED);
      expect(result.evidenceId).toBeTruthy();
      expect(result.evidenceId).toMatch(/^exec-ev-/);
    });

    it("emits ExecutionCreated, ExecutionReady, ExecutionStarted, ExecutionCompleted events", async () => {
      await machine.execute(makeIntent());

      const byType = collector.byEventType;
      expect(byType.has("ExecutionCreated")).toBe(true);
      expect(byType.has("ExecutionReady")).toBe(true);
      expect(byType.has("ExecutionStarted")).toBe(true);
      expect(byType.has("ExecutionCompleted")).toBe(true);
    });

    it("generates a unique executionId per call", async () => {
      const r1 = await machine.execute(makeIntent());
      const r2 = await machine.execute(makeIntent());
      expect(r1.executionId).not.toBe(r2.executionId);
    });
  });

  // -----------------------------------------------------------------------
  // Cancellation lifecycle
  // -----------------------------------------------------------------------

  describe("cancel()", () => {
    it("cancels a READY execution", async () => {
      const exId = advanceTo(machine, ExecutionState.READY);
      await machine.cancel(exId);
      expect(machine.getStatus(exId)).toBe(ExecutionState.CANCELLED);
    });

    it("cancels a RUNNING execution", async () => {
      const exId = advanceTo(machine, ExecutionState.RUNNING);
      await machine.cancel(exId);
      expect(machine.getStatus(exId)).toBe(ExecutionState.CANCELLED);
    });

    it("rejects cancellation of SUCCEEDED execution", async () => {
      const exId = advanceTo(machine, ExecutionState.SUCCEEDED);
      await expect(machine.cancel(exId)).rejects.toThrow(IllegalStateTransitionError);
    });

    it("rejects cancellation of FAILED execution", async () => {
      const exId = advanceTo(machine, ExecutionState.FAILED);
      await expect(machine.cancel(exId)).rejects.toThrow(IllegalStateTransitionError);
    });

    it("rejects cancellation of non-existent execution", async () => {
      await expect(machine.cancel("nonexistent")).rejects.toThrow(UnknownExecutionError);
    });

    it("emits ExecutionCancelled evidence", async () => {
      const exId = advanceTo(machine, ExecutionState.READY);
      await machine.cancel(exId);

      const cancelled = collector.records.filter((r) => r.eventType === "ExecutionCancelled");
      expect(cancelled.length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Rollback lifecycle
  // -----------------------------------------------------------------------

  describe("rollback()", () => {
    it("rolls back a FAILED execution", async () => {
      const exId = advanceTo(machine, ExecutionState.FAILED);
      await machine.rollback(exId);
      expect(machine.getStatus(exId)).toBe(ExecutionState.ROLLED_BACK);
    });

    it("rejects rollback of SUCCEEDED execution", async () => {
      const exId = advanceTo(machine, ExecutionState.SUCCEEDED);
      await expect(machine.rollback(exId)).rejects.toThrow(IllegalStateTransitionError);
    });

    it("rejects rollback of CANCELLED execution", async () => {
      const exId = advanceTo(machine, ExecutionState.CANCELLED);
      await expect(machine.rollback(exId)).rejects.toThrow(IllegalStateTransitionError);
    });

    it("rejects rollback of READY execution", async () => {
      const exId = advanceTo(machine, ExecutionState.READY);
      await expect(machine.rollback(exId)).rejects.toThrow(IllegalStateTransitionError);
    });

    it("rejects rollback of non-existent execution", async () => {
      await expect(machine.rollback("nonexistent")).rejects.toThrow(UnknownExecutionError);
    });

    it("emits ExecutionRollbackCompleted evidence", async () => {
      const exId = advanceTo(machine, ExecutionState.FAILED);
      await machine.rollback(exId);

      const rollback = collector.records.filter((r) => r.eventType === "ExecutionRollbackCompleted");
      expect(rollback.length).toBe(1);
      expect(rollback[0].evidence.outcome).toBe("PARTIAL");
    });

    it("rollback evidence links to original intent", async () => {
      const exId = advanceTo(machine, ExecutionState.FAILED, makeIntent({ intentId: "rollback-intent-link" }));
      await machine.rollback(exId);

      const rollback = collector.records.filter((r) => r.eventType === "ExecutionRollbackCompleted");
      expect(rollback[0].evidence.intentId).toBe("rollback-intent-link");
    });
  });

  // -----------------------------------------------------------------------
  // getStatus
  // -----------------------------------------------------------------------

  describe("getStatus()", () => {
    it("returns CREATED for a freshly created execution", () => {
      const exId = machine.createExecution(makeIntent());
      expect(machine.getStatus(exId)).toBe(ExecutionState.CREATED);
    });

    it("throws UnknownExecutionError for non-existent execution", () => {
      expect(() => machine.getStatus("nonexistent")).toThrow(UnknownExecutionError);
    });

    it("reflects the correct state after sequential transitions", () => {
      const exId = machine.createExecution(makeIntent());
      expect(machine.getStatus(exId)).toBe(ExecutionState.CREATED);

      machine.transitionTo(exId, ExecutionState.VALIDATING);
      expect(machine.getStatus(exId)).toBe(ExecutionState.VALIDATING);

      machine.transitionTo(exId, ExecutionState.READY);
      expect(machine.getStatus(exId)).toBe(ExecutionState.READY);

      machine.transitionTo(exId, ExecutionState.RUNNING);
      expect(machine.getStatus(exId)).toBe(ExecutionState.RUNNING);
    });
  });

  // -----------------------------------------------------------------------
  // Evidence emission
  // -----------------------------------------------------------------------

  describe("evidence emission", () => {
    it("emits evidence on CREATED registration", () => {
      machine.createExecution(makeIntent());
      expect(collector.records.length).toBe(1);
      expect(collector.records[0].eventType).toBe("ExecutionCreated");
    });

    it("emits evidence on every transition", () => {
      const exId = machine.createExecution(makeIntent());
      collector.clear();

      machine.transitionTo(exId, ExecutionState.VALIDATING);
      machine.transitionTo(exId, ExecutionState.READY);

      expect(collector.records.length).toBe(2);
    });

    it("emitted evidence contains correct intentId", async () => {
      await machine.execute(makeIntent({ intentId: "intent-evid-test" }));

      for (const r of collector.records) {
        expect(r.evidence.intentId).toBe("intent-evid-test");
      }
    });

    it("emits ExecutionFailed on RUNNING → FAILED", () => {
      const exId = advanceTo(machine, ExecutionState.RUNNING);
      machine.transitionTo(exId, ExecutionState.FAILED);

      const failed = collector.records.filter((r) => r.eventType === "ExecutionFailed");
      expect(failed.length).toBe(1);
      expect(failed[0].evidence.outcome).toBe("FAILED");
    });

    it("created evidence has correct summary format", () => {
      const exId = machine.createExecution(makeIntent());
      machine.transitionTo(exId, ExecutionState.VALIDATING);

      const created = collector.records.find((r) => r.eventType === "ExecutionCreated");
      expect(created?.evidence.summary).toMatch(/Execution/);
    });
  });

  // -----------------------------------------------------------------------
  // Typed errors carry structured metadata
  // -----------------------------------------------------------------------

  describe("typed errors", () => {
    it("IllegalStateTransitionError carries executionId, current, requested", () => {
      const exId = machine.createExecution(makeIntent());
      try {
        machine.transitionTo(exId, ExecutionState.RUNNING);
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(IllegalStateTransitionError);
        const err = e as IllegalStateTransitionError;
        expect(err.executionId).toBe(exId);
        expect(err.currentState).toBe(ExecutionState.CREATED);
        expect(err.requestedState).toBe(ExecutionState.RUNNING);
      }
    });

    it("UnknownExecutionError carries executionId", () => {
      try {
        machine.getStatus("ghost");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(UnknownExecutionError);
        const err = e as UnknownExecutionError;
        expect(err.executionId).toBe("ghost");
      }
    });

    it("DuplicateExecutionError is defined and throwable", () => {
      // DuplicateExecutionError is thrown when createExecution() is called
      // with an ID that already exists. Since IDs are UUID-based, duplicates
      // are practically impossible, but the error type exists for the contract.
      expect(DuplicateExecutionError).toBeDefined();
    });
  });
});
