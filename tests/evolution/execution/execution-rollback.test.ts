/**
 * Tests for A4.4 — Rollback & Recovery.
 *
 * Covers rollback reverse order, partial rollback, rollback failure,
 * no rollback configuration, unrecoverable state, skipped unexecuted steps,
 * and rollback evidence captured.
 *
 * @module execution-rollback
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GovernedExecutionRuntime,
  TestStepExecutor,
} from "../../../src/evolution/execution/execution-runtime.js";
import {
  createExecutionPlan,
} from "../../../src/evolution/execution/execution-planner.js";
import type {
  ExecutionPlan,
  ExecutionStep,
  RollbackStep,
  ExecutionEnvironment,
} from "../../../src/evolution/execution/contracts/execution-contract.js";
import type { EvolutionProposal } from "../../../src/evolution/contracts/evolution-contract.js";
import type { GovernanceDecision } from "../../../src/evolution/governance/contracts/decision-contract.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProposal(overrides?: Partial<EvolutionProposal>): EvolutionProposal {
  return {
    proposalId: "prop-test-001",
    evolutionId: "evol-test-001",
    title: "Test proposal",
    description: "A proposal for testing",
    change: "Change the thing",
    beforeHash: null,
    afterHash: null,
    createdAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

function makeDecision(overrides?: Partial<GovernanceDecision>): GovernanceDecision {
  return {
    decisionId: "govd-001",
    proposalId: "prop-test-001",
    evolutionId: "evo-001",
    kind: "APPROVE",
    confidence: 0.95,
    reasoning: "Approved for testing",
    risks: [],
    evidenceId: "ev-001",
    recommendationAvailable: false,
    followedRecommendation: false,
    policySnapshot: {
      policyName: "default",
      minApproveConfidence: 0.8,
      minMonitorConfidence: 0.5,
      rejectConfidenceThreshold: 0.3,
      maxAllowedRegressions: 0,
      escalateBehavior: "request_evidence",
      failClosedOnExpiredEvidence: true,
      minReproducibilityLevel: 2,
    },
    targetState: "APPROVED",
    decidedAt: "2026-07-12T00:00:00.000Z",
    decidedBy: "operator",
    integrityHash: "test-hash",
    ...overrides,
  };
}

function makeEnvironment(overrides?: Partial<ExecutionEnvironment>): ExecutionEnvironment {
  return {
    environmentId: "env-001",
    environmentHash: "abc123def456",
    runtimeVersion: "1.0.0",
    agentConfiguration: { mode: "test" },
    baselineMetrics: { cpu: 0.5 },
    capabilityFingerprint: "cap-v1",
    ...overrides,
  };
}

function makePlan(stepCount: number = 2, overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  const steps: ExecutionStep[] = [];
  for (let i = 0; i < stepCount; i++) {
    steps.push({
      stepId: `step-${i + 1}`,
      operation: `op_${String.fromCharCode(97 + i)}`,
      parameters: {},
      idempotent: false,
      preconditions: {},
      postconditions: {},
    });
  }

  return {
    planId: "plan-test-001",
    proposalId: "prop-test-001",
    proposalHash: "abc",
    decisionId: "govd-test-001",
    decisionHash: "def",
    environmentHash: "env-hash",
    steps,
    rollbackPlan: [...steps].reverse().map((s) => ({
      stepId: `rb-${s.stepId}`,
      forwardStepId: s.stepId,
      operation: `undo:${s.operation}`,
      parameters: {},
      rollbackType: "automatic" as const,
      safe: true,
    })),
    integrityHash: "integ-test",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Rollback & Recovery", () => {
  // ---------------------------------------------------------------------------
  // 1. Rollback reverse order (planner)
  // ---------------------------------------------------------------------------

  describe("planner rollback order", () => {
    it("stores rollbackPlan in reverse order of forward steps", () => {
      const proposal = makeProposal();
      // Add changes array at runtime for resolveSteps to pick up
      (proposal as unknown as Record<string, unknown>).changes = [
        { operation: "op_a", parameters: {}, idempotent: false, preconditions: {}, postconditions: {} },
        { operation: "op_b", parameters: {}, idempotent: false, preconditions: {}, postconditions: {} },
        { operation: "op_c", parameters: {}, idempotent: false, preconditions: {}, postconditions: {} },
      ];

      const decision = makeDecision();
      const env = makeEnvironment();

      const plan = createExecutionPlan(proposal, decision, env, {
        createRollback: (step: ExecutionStep): RollbackStep => ({
          stepId: `rb-${step.stepId}`,
          forwardStepId: step.stepId,
          operation: `rollback_${step.operation}`,
          parameters: {},
          rollbackType: "automatic" as const,
          safe: true,
        }),
      });

      // Forward steps are in original order: op_a, op_b, op_c
      assert.equal(plan.steps.length, 3);
      assert.equal(plan.steps[0].operation, "op_a");
      assert.equal(plan.steps[1].operation, "op_b");
      assert.equal(plan.steps[2].operation, "op_c");

      // Rollback plan is in reverse order: step_c first, step_a last
      assert.equal(plan.rollbackPlan.length, 3);
      assert.equal(plan.rollbackPlan[0].forwardStepId, plan.steps[2].stepId);
      assert.equal(plan.rollbackPlan[1].forwardStepId, plan.steps[1].stepId);
      assert.equal(plan.rollbackPlan[2].forwardStepId, plan.steps[0].stepId);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Partial rollback
  // ---------------------------------------------------------------------------

  describe("partial rollback", () => {
    it("step 2 of 3 fails, step 1 rolls back, status is rolled_back", async () => {
      const runtime = new GovernedExecutionRuntime({ enableRollback: true });
      const plan = makePlan(3);
      // Forward: step-1 succeeds, step-2 fails
      // Rollback: rb-step-1 (only completed step) succeeds
      const executor = new TestStepExecutor([
        { success: true, output: {} },
        { success: false, output: {} },
        { success: true, output: {} },
      ]);

      const report = await runtime.execute(plan, executor);

      // Report status is rolled_back (partial recovery succeeded)
      assert.equal(report.status, "rolled_back");
      assert.equal(report.rollbackTriggered, true);
      assert.ok(report.rollbackResult);
      assert.equal(report.rollbackResult.success, true);

      // Forward step 1 succeeded
      assert.equal(report.stepResults[0].success, true);
      assert.equal(report.stepResults[0].stepId, "step-1");

      // Forward step 2 failed
      assert.equal(report.stepResults[1].success, false);
      assert.equal(report.stepResults[1].stepId, "step-2");

      // Only 2 forward step results (step 3 never started)
      assert.equal(report.stepResults.length, 2);

      // Rollback for step 1 was attempted
      assert.ok(report.rollbackResult.stepResults.length >= 1);
      assert.equal(report.rollbackResult.stepResults[0].stepId, "rb-step-1");
      assert.equal(report.rollbackResult.stepResults[0].success, true);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Rollback failure
  // ---------------------------------------------------------------------------

  describe("rollback failure", () => {
    it("rollback step fails, report status is failed (not rolled_back)", async () => {
      const runtime = new GovernedExecutionRuntime({ enableRollback: true });
      const plan = makePlan(3);
      // Forward: step-1 succeeds, step-2 fails
      // Rollback: rb-step-1 fails
      const executor = new TestStepExecutor([
        { success: true, output: {} },
        { success: false, output: {} },
        { success: false, output: {} },
      ]);

      const report = await runtime.execute(plan, executor);

      // Status is "failed" because recovery was incomplete
      assert.equal(report.status, "failed");

      // Rollback was triggered but its result indicates failure
      assert.equal(report.rollbackTriggered, true);
      assert.ok(report.rollbackResult);
      assert.equal(report.rollbackResult.success, false);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. No rollback configuration
  // ---------------------------------------------------------------------------

  describe("no rollback config", () => {
    it("step fails without rollback, rollbackTriggered is false", async () => {
      const runtime = new GovernedExecutionRuntime({ enableRollback: false });
      const plan = makePlan(3);
      const executor = new TestStepExecutor([
        { success: true, output: {} },
        { success: false, output: {} },
      ]);

      const report = await runtime.execute(plan, executor);

      // Status is failed
      assert.equal(report.status, "failed");

      // No rollback was triggered
      assert.equal(report.rollbackTriggered, false);
      assert.equal(report.rollbackResult, undefined);

      // Step 1 succeeded, step 2 failed
      assert.equal(report.stepResults[0].success, true);
      assert.equal(report.stepResults[1].success, false);
      assert.equal(report.stepResults.length, 2);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Unrecoverable state (same as test 3, with additional detail checks)
  // ---------------------------------------------------------------------------

  describe("unrecoverable state", () => {
    it("rollback step failure is captured with failure details in the report", async () => {
      const runtime = new GovernedExecutionRuntime({ enableRollback: true });
      const plan = makePlan(3);
      const executor = new TestStepExecutor([
        { success: true, output: {} },
        { success: false, output: {} },
        { success: false, output: {} },
      ]);

      const report = await runtime.execute(plan, executor);

      // Status is "failed" — recovery was incomplete
      assert.equal(report.status, "failed");

      // Rollback was triggered but failed
      assert.equal(report.rollbackTriggered, true);
      assert.ok(report.rollbackResult);
      assert.equal(report.rollbackResult.success, false);

      // Verify rollback result captures the failure accurately
      assert.ok(report.rollbackResult.stepResults.length > 0);
      assert.equal(report.rollbackResult.stepResults[0].success, false);
      assert.equal(report.rollbackResult.stepResults[0].stepId, "rb-step-1");

      // Report the reason for rollback failure
      assert.ok(report.rollbackResult.reason);
      assert.match(report.rollbackResult.reason!, /failed/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Skipped unexecuted steps
  // ---------------------------------------------------------------------------

  describe("skipped unexecuted steps", () => {
    it("step 2 of 3 fails, rollback only executes for step 1 (not step 3)", async () => {
      const runtime = new GovernedExecutionRuntime({ enableRollback: true });
      const plan = makePlan(3);
      const executor = new TestStepExecutor([
        { success: true, output: {} },
        { success: false, output: {} },
        { success: true, output: {} },
      ]);

      const report = await runtime.execute(plan, executor);

      // Only 2 forward step results — step 3 was never attempted
      assert.equal(report.stepResults.length, 2);

      // Only 1 rollback step result — rb-step-3 (for unexecuted step 3) is NOT included
      assert.ok(report.rollbackResult);
      assert.equal(report.rollbackResult.stepResults.length, 1);
      assert.equal(report.rollbackResult.stepResults[0].stepId, "rb-step-1");

      // Step 3 forward result does not exist
      assert.equal(report.stepResults.find((s) => s.stepId === "step-3"), undefined);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Rollback evidence captured
  // ---------------------------------------------------------------------------

  describe("rollback evidence captured", () => {
    it("records each attempted rollback step with its success/failure status", async () => {
      const runtime = new GovernedExecutionRuntime({ enableRollback: true });
      const plan = makePlan(3);
      // Forward: step-1 succeeds, step-2 succeeds, step-3 fails
      // Rollback: rb-step-2 (reverse order, first) succeeds, rb-step-1 succeeds
      const executor = new TestStepExecutor([
        { success: true, output: {} },
        { success: true, output: {} },
        { success: false, output: {} },
        { success: true, output: {} },
        { success: true, output: {} },
      ]);

      const report = await runtime.execute(plan, executor);

      assert.equal(report.status, "rolled_back");
      assert.ok(report.rollbackResult);
      assert.equal(report.rollbackResult.success, true);

      // Rollback result records all attempted steps
      const rbResults = report.rollbackResult.stepResults;
      assert.equal(rbResults.length, 2);

      // Rollback steps are executed in reverse order of forward steps
      // step-2 was completed last, so its rollback executes first
      assert.equal(rbResults[0].stepId, "rb-step-2");
      assert.equal(rbResults[0].success, true);
      assert.equal(rbResults[1].stepId, "rb-step-1");
      assert.equal(rbResults[1].success, true);

      // Each rollback step result has timing information
      for (const rbResult of rbResults) {
        assert.equal(typeof rbResult.startedAt, "string");
        assert.equal(typeof rbResult.completedAt, "string");
        assert.ok(rbResult.startedAt <= rbResult.completedAt);
      }
    });
  });
});
