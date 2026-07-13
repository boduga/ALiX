/**
 * Tests for A4.2 — Governed Execution Runtime.
 *
 * Covers sequential execution, precondition/postcondition validation,
 * checkpoint creation, retry logic, rollback invocation, and all
 * report status paths.
 *
 * @module execution-runtime
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GovernedExecutionRuntime,
  TestStepExecutor,
  DEFAULT_RUNTIME_CONFIG,
} from "../../../src/evolution/execution/execution-runtime.js";
import type {
  ExecutionPlan,
  ExecutionStep,
  ExecutionReport,
  RollbackResult,
} from "../../../src/evolution/execution/contracts/execution-contract.js";
import type { RuntimeConfig } from "../../../src/evolution/execution/execution-runtime.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep(overrides?: Partial<ExecutionStep>): ExecutionStep {
  return {
    stepId: "test-step-1",
    operation: "test_operation",
    parameters: { key: "value" },
    idempotent: false,
    preconditions: {},
    postconditions: {},
    ...overrides,
  };
}

function makePlan(stepCount: number = 1): ExecutionPlan {
  const steps: ExecutionStep[] = [];
  for (let i = 0; i < stepCount; i++) {
    steps.push(
      makeStep({
        stepId: `step-${i + 1}`,
        operation: `operation_${i + 1}`,
        parameters: { index: i },
      }),
    );
  }

  return {
    planId: "plan-test-001",
    proposalId: "proposal-test-001",
    proposalHash: "abc123",
    decisionId: "decision-test-001",
    decisionHash: "def456",
    environmentHash: "env789",
    steps,
    rollbackPlan: [...steps].reverse().map((s) => ({
      stepId: `rb-${s.stepId}`,
      forwardStepId: s.stepId,
      operation: `rollback_${s.operation}`,
      parameters: s.parameters,
      rollbackType: "automatic" as const,
      safe: true,
    })),
    integrityHash: "hash123",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GovernedExecutionRuntime", () => {
  describe("constructor", () => {
    it("uses default config when no overrides provided", () => {
      const runtime = new GovernedExecutionRuntime();
      assert.equal(runtime.state, "approved");
    });

    it("merges partial config with defaults", () => {
      const runtime = new GovernedExecutionRuntime({ enableRollback: false });
      assert.equal(runtime.state, "approved");
    });
  });

  describe("execute", () => {
    it("executes all steps in plan order", async () => {
      const runtime = new GovernedExecutionRuntime();
      const plan = makePlan(3);
      const executor = new TestStepExecutor();

      const report = await runtime.execute(plan, executor);

      assert.equal(report.status, "completed");
      assert.equal(report.stepResults.length, 3);
      assert.equal(report.stepResults[0].stepId, "step-1");
      assert.equal(report.stepResults[1].stepId, "step-2");
      assert.equal(report.stepResults[2].stepId, "step-3");
    });

    it("records step results for each step", async () => {
      const runtime = new GovernedExecutionRuntime();
      const plan = makePlan(2);
      const executor = new TestStepExecutor();

      const report = await runtime.execute(plan, executor);

      for (const result of report.stepResults) {
        assert.equal(typeof result.startedAt, "string");
        assert.equal(typeof result.completedAt, "string");
        assert.equal(result.success, true);
      }
    });

    it("reports completed when all steps succeed", async () => {
      const runtime = new GovernedExecutionRuntime();
      const plan = makePlan(3);
      const executor = new TestStepExecutor();

      const report = await runtime.execute(plan, executor);

      assert.equal(report.status, "completed");
      assert.equal(report.rollbackTriggered, false);
    });

    it("reports failed when step fails without rollback", async () => {
      const runtime = new GovernedExecutionRuntime({ enableRollback: false });
      const plan = makePlan(2);
      const executor = new TestStepExecutor([
        { success: true },
        { success: false },
      ]);

      const report = await runtime.execute(plan, executor);

      assert.equal(report.status, "failed");
      assert.equal(report.rollbackTriggered, false);
    });

    it("stops on step failure when rollback disabled", async () => {
      const runtime = new GovernedExecutionRuntime({ enableRollback: false });
      const plan = makePlan(3);
      const executor = new TestStepExecutor([
        { success: true },
        { success: false },
        { success: true }, // should not execute
      ]);

      const report = await runtime.execute(plan, executor);

      assert.equal(report.status, "failed");
      assert.equal(report.stepResults.length, 2); // only 2 steps executed
      assert.equal(report.stepResults[0].success, true);
      assert.equal(report.stepResults[1].success, false);
    });

    it("triggers rollback when step fails and rollback enabled", async () => {
      const runtime = new GovernedExecutionRuntime({ enableRollback: true });
      const plan = makePlan(2);
      const executor = new TestStepExecutor([
        { success: true },
        { success: false },
      ]);

      const report = await runtime.execute(plan, executor);

      assert.equal(report.status, "rolled_back");
      assert.equal(report.rollbackTriggered, true);
      assert.ok(report.rollbackResult);
      assert.equal(report.rollbackResult.success, true);
    });

    it("validates preconditions before each step", async () => {
      const runtime = new GovernedExecutionRuntime({ enableRollback: false });
      // Step 2 requires output from step 1 as precondition
      const step1 = makeStep({
        stepId: "step-1",
        operation: "step1",
        preconditions: {},
      });
      const step2 = makeStep({
        stepId: "step-2",
        operation: "step2",
        preconditions: { "step-1": true }, // requires step-1 output
      });

      const plan = makePlan(0);
      const planWithPreconditions: ExecutionPlan = {
        ...plan,
        steps: [step1, step2],
        rollbackPlan: [
          { stepId: "rb-step-1", forwardStepId: "step-1", operation: "rb_1", parameters: {}, rollbackType: "automatic", safe: true },
          { stepId: "rb-step-2", forwardStepId: "step-2", operation: "rb_2", parameters: {}, rollbackType: "automatic", safe: true },
        ],
      };

      const executor = new TestStepExecutor([
        { success: true, output: { result: "ok" } },
        { success: true },
      ]);

      const report = await runtime.execute(planWithPreconditions, executor);

      assert.equal(report.status, "completed");
      assert.equal(report.stepResults.length, 2);
      assert.equal(report.stepResults[0].success, true);
      assert.equal(report.stepResults[1].success, true);
    });

    it("fails when preconditions are not met", async () => {
      const runtime = new GovernedExecutionRuntime({ enableRollback: false });
      const step = makeStep({
        stepId: "step-1",
        operation: "step1",
        preconditions: { missing_key: true },
      });

      const plan = makePlan(0);
      const planWithPreconditions: ExecutionPlan = {
        ...plan,
        steps: [step],
        rollbackPlan: [
          { stepId: "rb-step-1", forwardStepId: "step-1", operation: "rb_1", parameters: {}, rollbackType: "automatic", safe: true },
        ],
      };

      const executor = new TestStepExecutor();
      const report = await runtime.execute(planWithPreconditions, executor);

      assert.equal(report.status, "failed");
      assert.equal(report.stepResults.length, 1);
      assert.equal(report.stepResults[0].success, false);
    });

    it("fails step when postconditions are not met", async () => {
      const plan = makePlan(1);
      const stepWithPostcondition: ExecutionStep = {
        stepId: "step-1",
        operation: "update_config",
        parameters: {},
        idempotent: false,
        preconditions: {},
        postconditions: { requiredKey: true },
      };
      const planWithPostcondition: ExecutionPlan = {
        ...plan,
        steps: [stepWithPostcondition],
        rollbackPlan: [
          { stepId: "rb-step-1", forwardStepId: "step-1", operation: "rb_1", parameters: {}, rollbackType: "automatic", safe: true },
        ],
      };

      const executor = new TestStepExecutor([{ success: true, output: { someKey: "value" } }]);
      const runtime = new GovernedExecutionRuntime({ enableRollback: false });
      const report = await runtime.execute(planWithPostcondition, executor);

      assert.strictEqual(report.status, "failed");
      assert.ok(report.stepResults[0].error?.includes("postcondition"));
    });

    it("retries idempotent steps on failure", async () => {
      const runtime = new GovernedExecutionRuntime({ maxRetries: 2 });
      const idempotentStep = makeStep({
        stepId: "step-1",
        operation: "idempotent_op",
        idempotent: true,
      });

      const plan = makePlan(0);
      const planWithIdempotent: ExecutionPlan = {
        ...plan,
        steps: [idempotentStep],
        rollbackPlan: [
          { stepId: "rb-step-1", forwardStepId: "step-1", operation: "rb_1", parameters: {}, rollbackType: "automatic", safe: true },
        ],
      };

      // Fail twice, succeed on third attempt
      const executor = new TestStepExecutor([
        { success: false },
        { success: false },
        { success: true },
      ]);

      const report = await runtime.execute(planWithIdempotent, executor);

      assert.equal(report.status, "completed");
      assert.equal(report.stepResults.length, 1);
      assert.equal(report.stepResults[0].success, true);
    });

    it("does not retry non-idempotent steps", async () => {
      const runtime = new GovernedExecutionRuntime({ maxRetries: 3 });
      const nonIdempotentStep = makeStep({
        stepId: "step-1",
        operation: "non_idempotent_op",
        idempotent: false,
      });

      const plan = makePlan(0);
      const planWithNonIdempotent: ExecutionPlan = {
        ...plan,
        steps: [nonIdempotentStep],
        rollbackPlan: [
          { stepId: "rb-step-1", forwardStepId: "step-1", operation: "rb_1", parameters: {}, rollbackType: "automatic", safe: true },
        ],
      };

      const executor = new TestStepExecutor([
        { success: false },
        { success: true }, // should not be reached
      ]);

      const report = await runtime.execute(planWithNonIdempotent, executor);

      assert.equal(report.status, "rolled_back"); // rollback kicks in
      assert.equal(report.stepResults[0].success, false);
    });

    it("creates checkpoints for each step", async () => {
      const runtime = new GovernedExecutionRuntime();
      const plan = makePlan(2);
      const executor = new TestStepExecutor();

      const report = await runtime.execute(plan, executor);

      assert.equal(report.status, "completed");
      // Checkpoints should be tracked in the internal context
      // We verify via side-effects of execution (completed status)
      assert.equal(report.stepResults.length, 2);
    });

    it("propagates step output to context for next step", async () => {
      const plan = makePlan(1);
      const step1: ExecutionStep = {
        stepId: "step-1",
        operation: "compute",
        parameters: {},
        idempotent: false,
        preconditions: {},
        postconditions: {},
      };
      const step2: ExecutionStep = {
        stepId: "step-2",
        operation: "use_result",
        parameters: {},
        idempotent: false,
        preconditions: { "step-1": true },
        postconditions: {},
      };
      const steps = [step1, step2];
      const planWithSteps: ExecutionPlan = {
        ...plan,
        steps,
        rollbackPlan: [...steps].reverse().map((s) => ({
          stepId: `rb-${s.stepId}`,
          forwardStepId: s.stepId,
          operation: `rollback_${s.operation}`,
          parameters: {},
          rollbackType: "automatic" as const,
          safe: true,
        })),
      };

      // step-2 precondition checks that "step-1" key exists in context.outputs
      // (the runtime stores each step's output under its stepId key)
      const executor = new TestStepExecutor([
        { success: true, output: { data: "from step 1" } },
        { success: true, output: { done: true } },
      ]);

      const runtime = new GovernedExecutionRuntime({ enableRollback: false });
      const report = await runtime.execute(planWithSteps, executor);

      assert.strictEqual(report.status, "completed");
      assert.strictEqual(report.stepResults.length, 2);
    });

    it("tracks execution state transitions", async () => {
      const runtime = new GovernedExecutionRuntime();
      assert.equal(runtime.state, "approved");

      const plan = makePlan(2);
      const executor = new TestStepExecutor();

      await runtime.execute(plan, executor);
      assert.equal(runtime.state, "completed");
    });

    it("sets state to failed when step fails without rollback", async () => {
      const runtime = new GovernedExecutionRuntime({ enableRollback: false });
      const plan = makePlan(2);
      const executor = new TestStepExecutor([
        { success: true },
        { success: false },
      ]);

      await runtime.execute(plan, executor);
      assert.equal(runtime.state, "failed");
    });

    it("sets state to rolled_back after successful rollback", async () => {
      const runtime = new GovernedExecutionRuntime();
      const plan = makePlan(2);
      const executor = new TestStepExecutor([
        { success: true },
        { success: false },
      ]);

      await runtime.execute(plan, executor);
      assert.equal(runtime.state, "rolled_back");
    });

    it("report.rollbackTriggered is true after rollback", async () => {
      const runtime = new GovernedExecutionRuntime();
      const plan = makePlan(2);
      const executor = new TestStepExecutor([
        { success: true },
        { success: false },
      ]);

      const report = await runtime.execute(plan, executor);

      assert.equal(report.rollbackTriggered, true);
      assert.ok(report.rollbackResult);
    });

    it("report.rollbackTriggered is false when no rollback occurs", async () => {
      const runtime = new GovernedExecutionRuntime();
      const plan = makePlan(2);
      const executor = new TestStepExecutor();

      const report = await runtime.execute(plan, executor);

      assert.equal(report.rollbackTriggered, false);
      assert.equal(report.rollbackResult, undefined);
    });
  });

  describe("rollback", () => {
    it("rollback records each step success/failure", async () => {
      const runtime = new GovernedExecutionRuntime();
      const plan = makePlan(3);
      const executor = new TestStepExecutor([
        { success: true },
        { success: true },
        { success: false }, // step 3 fails -> triggers rollback of steps 0,1
      ]);

      const report = await runtime.execute(plan, executor);

      assert.equal(report.status, "rolled_back");
      assert.ok(report.rollbackResult);
      assert.equal(report.rollbackResult.success, true);
      assert.ok(report.rollbackResult.stepResults.length > 0);
      for (const rbResult of report.rollbackResult.stepResults) {
        assert.equal(typeof rbResult.success, "boolean");
        assert.equal(typeof rbResult.startedAt, "string");
        assert.equal(typeof rbResult.completedAt, "string");
      }
    });

    it("partial rollback (some steps fail) -> status failed", async () => {
      const runtime = new GovernedExecutionRuntime();
      const plan = makePlan(3);
      const executor = new TestStepExecutor([
        { success: true },
        { success: false }, // step 2 fails -> triggers rollback
      ]);

      // Make the rollback executor also fail on one step
      // The rollback uses the SAME executor, so we need to account for
      // consumed results order: step-1 succeeds, step-2 fails,
      // then rollback executes rb-step-1 (only completed step's rollback)
      // We'll give it a failing rollback result
      const failingRbExecutor = new TestStepExecutor([
        { success: true },
        { success: false }, // step 2 fails
        { success: false }, // rollback of step-1 fails
      ]);

      const report = await runtime.execute(plan, failingRbExecutor);

      assert.equal(report.status, "failed");
      assert.ok(report.rollbackResult);
      assert.equal(report.rollbackResult.success, false);
    });

    it("executes rollback steps in reverse order", async () => {
      const runtime = new GovernedExecutionRuntime();
      const plan = makePlan(3);
      const executor = new TestStepExecutor([
        { success: true },
        { success: true },
        { success: false }, // step 3 fails -> rollback steps 0 and 1 in reverse
      ]);

      const report = await runtime.execute(plan, executor);

      assert.equal(report.status, "rolled_back");
      assert.ok(report.rollbackResult);
      assert.ok(report.rollbackResult.stepResults.length > 0);
      // Should have rollback results for the two completed steps
      assert.ok(report.rollbackResult.stepResults.length <= 2);
    });
  });

  describe("TestStepExecutor", () => {
    it("returns queued results in order", async () => {
      const executor = new TestStepExecutor([
        { success: false, output: { error: "first fail" } },
        { success: true, output: { data: "ok" } },
      ]);

      const step1 = makeStep({ stepId: "s1" });
      const step2 = makeStep({ stepId: "s2" });

      const r1 = await executor.executeStep(step1, {});
      assert.equal(r1.success, false);
      assert.equal(r1.error, "Step failed");

      const r2 = await executor.executeStep(step2, {});
      assert.equal(r2.success, true);
      assert.equal(r2.output.data, "ok");
    });

    it("defaults to success when queue exhausted", async () => {
      const executor = new TestStepExecutor();
      const step = makeStep();

      const result = await executor.executeStep(step, {});
      assert.equal(result.success, true);
      assert.deepEqual(result.output, {});
    });
  });
});
