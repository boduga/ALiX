// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A4.2 — Governed Execution Runtime.
 *
 * Sequential step executor with checkpoint recording, precondition/postcondition
 * validation, fail-safe stop, and rollback trigger. The runtime receives an
 * ExecutionPlan and an injected StepExecutor, then drives execution in order.
 *
 * @module execution-runtime
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../security/audit/canonical-json.js";
import type {
  ExecutionPlan,
  ExecutionStep,
  ExecutionStepResult,
  ExecutionReport,
  ExecutionContext,
  ExecutionCheckpoint,
  RollbackResult,
  RollbackStep,
} from "./contracts/execution-contract.js";
import type { ExecutionState } from "./contracts/execution-lifecycle.js";

// ---------------------------------------------------------------------------
// RuntimeConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for the GovernedExecutionRuntime.
 */
export interface RuntimeConfig {
  /** Enable automatic rollback on step failure. */
  enableRollback: boolean;
  /** Maximum retries for transient idempotent step failures. */
  maxRetries: number;
}

/**
 * Default runtime configuration:
 * - Rollback enabled
 * - Max 1 retry per idempotent step
 */
export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  enableRollback: true,
  maxRetries: 1,
};

// ---------------------------------------------------------------------------
// StepExecutor
// ---------------------------------------------------------------------------

/**
 * Abstract step executor injected into the runtime.
 *
 * The runtime calls executeStep for each step in the plan. The executor
 * implementation determines how steps are actually performed — the runtime
 * is agnostic to execution mechanism.
 */
export interface StepExecutor {
  /** Execute a single step with the given input context. */
  executeStep(
    step: ExecutionStep,
    context: Record<string, unknown>,
  ): Promise<{
    success: boolean;
    output: Record<string, unknown>;
    error?: string;
  }>;
}

// ---------------------------------------------------------------------------
// GovernedExecutionRuntime
// ---------------------------------------------------------------------------

/**
 * Governed execution runtime that drives sequential step execution with
 * checkpoint recording, precondition/postcondition validation, fail-safe
 * stop, and rollback support.
 *
 * State transitions:
 *   approved -> executing -> completed
 *                    |           |
 *                    v           v
 *                 rolling_back -> rolled_back
 *                    |              |
 *                    v              v
 *                  failed        failed
 */
export class GovernedExecutionRuntime {
  private readonly config: RuntimeConfig;
  private context: ExecutionContext;

  /**
   * Create a new runtime instance.
   *
   * @param config - Optional partial RuntimeConfig (defaults used for omitted fields).
   */
  constructor(config?: Partial<RuntimeConfig>) {
    this.config = { ...DEFAULT_RUNTIME_CONFIG, ...config };
    this.context = {
      executionId: `exec-${Date.now()}`,
      state: "approved",
      checkpoints: [],
      outputs: {},
    };
  }

  /**
   * Current execution state.
   */
  get state(): ExecutionState {
    return this.context.state;
  }

  /**
   * Execute all steps of a plan sequentially.
   *
   * For each step:
   *   1. Validate preconditions exist in context
   *   2. Execute the step via the injected executor (retry idempotent on transient failure)
   *   3. Validate postconditions exist in output
   *   4. Update context.outputs with step output
   *   5. Create checkpoint with post-execution hash
   *   6. Record result with success/failure and timing
   *   7. On failure: trigger rollback (if enabled), return report
   *
   * @param plan - The execution plan to execute.
   * @param executor - The step executor that performs each step.
   * @returns ExecutionReport with final status and step results.
   */
  async execute(plan: ExecutionPlan, executor: StepExecutor): Promise<ExecutionReport> {
    const startedAt = new Date().toISOString();
    this.context = { ...this.context, state: "executing" as const };
    const stepResults: ExecutionStepResult[] = [];

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const stepStartedAt = new Date().toISOString();
      let success = false;
      let output: Record<string, unknown> = {};
      let error: string | undefined;

      // Validate preconditions
      const preconditionError = this.validatePreconditions(step, this.context.outputs);
      if (preconditionError) {
        stepResults.push(this.buildFailedResult(step, preconditionError, stepStartedAt));
        return this.finalizeReport(plan.planId, startedAt, stepResults, false);
      }

      // Execute step (with retry for idempotent)
      const maxAttempts = step.idempotent ? 1 + this.config.maxRetries : 1;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const result = await executor.executeStep(step, { ...this.context.outputs });
        if (result.success) {
          success = true;
          output = result.output ?? {};
          break;
        }
        error = result.error;
        if (attempt < maxAttempts - 1) continue; // retry
      }

      if (!success) {
        const retryCompletedAt = new Date().toISOString();
        stepResults.push({
          stepId: step.stepId, success: false, startedAt: stepStartedAt, completedAt: retryCompletedAt,
          output: {}, error: error ?? "Step failed",
        });
        if (this.config.enableRollback) {
          return this.handleRollbackFailure(plan, i, executor, stepResults, startedAt);
        }
        return this.finalizeReport(plan.planId, startedAt, stepResults, false);
      }

      // Validate postconditions
      const postconditionError = this.validatePostconditions(step, output);
      if (postconditionError) {
        stepResults.push(this.buildFailedResult(step, postconditionError, stepStartedAt));
        if (this.config.enableRollback) {
          return this.handleRollbackFailure(plan, i, executor, stepResults, startedAt);
        }
        return this.finalizeReport(plan.planId, startedAt, stepResults, false);
      }

      // Update context with step output
      this.context.outputs[step.stepId] = output;

      // Create checkpoint AFTER successful execution
      const checkpoint: ExecutionCheckpoint = {
        stepId: step.stepId,
        inputHash: createHash("sha256").update(canonicalStringify({ step, outputs: this.context.outputs })).digest("hex"),
        outputHash: createHash("sha256").update(canonicalStringify(this.context.outputs)).digest("hex"),
        environmentHash: plan.environmentHash,
        timestamp: new Date().toISOString(),
      };
      this.context = { ...this.context, checkpoints: [...this.context.checkpoints, checkpoint] };

      const stepCompletedAt = new Date().toISOString();
      stepResults.push({
        stepId: step.stepId, success: true,
        startedAt: stepStartedAt, completedAt: stepCompletedAt,
        output,
      });
    }

    this.context = { ...this.context, state: "completed" as const };
    return {
      reportId: `rpt-${plan.planId}`,
      planId: plan.planId,
      executionId: this.context.executionId,
      status: "completed",
      stepResults,
      startedAt, completedAt: new Date().toISOString(),
      rollbackTriggered: false,
    };
  }

  /**
   * Execute rollback steps in reverse order of completed forward steps.
   *
   * For each completed forward step up to failedStepIndex, executes the
   * corresponding rollback step in reverse order (last completed first).
   *
   * @param plan - The execution plan with rollback plan.
   * @param failedStepIndex - Index of the step that failed (rollback only steps before it).
   * @param executor - The step executor.
   * @returns RollbackResult with per-step results.
   */
  async rollback(
    plan: ExecutionPlan,
    failedStepIndex: number,
    executor: StepExecutor,
  ): Promise<RollbackResult> {
    const startedAt = new Date().toISOString();
    const rollbackStepResults: ExecutionStepResult[] = [];

    // Find completed forward steps (all steps before the failed step)
    // This correctly handles the reversed rollbackPlan — we match by forwardStepId
    // instead of using index-based slicing which breaks when rollbackPlan is reversed.
    const completedForwardSteps = plan.steps.slice(0, failedStepIndex);
    const completedStepIds = new Set(completedForwardSteps.map((s) => s.stepId));

    // Select rollback steps for completed forward steps only.
    // rollbackPlan is in reverse-execution order (built as [...steps].reverse().map(...)),
    // so forward iteration over the filtered result gives the correct reverse-execution order
    // (last completed step first).
    const rollbackSteps = plan.rollbackPlan.filter((rb) => completedStepIds.has(rb.forwardStepId));

    // Execute rollback steps in order (plan is already reversed, so forward iteration = correct reverse order)
    for (const rbStep of rollbackSteps) {
      const rbStartedAt = new Date().toISOString();

      if (!rbStep.safe) {
        const rbCompletedAt = new Date().toISOString();
        rollbackStepResults.push({
          stepId: rbStep.stepId,
          success: false,
          output: {},
          startedAt: rbStartedAt,
          completedAt: rbCompletedAt,
        });

        const completedAt = new Date().toISOString();
        this.context = { ...this.context, state: "failed" };

        return {
          success: false,
          stepResults: rollbackStepResults,
          startedAt,
          completedAt,
          reason: `Unsafe rollback step ${rbStep.stepId} cannot be automatically executed`,
        };
      }

      const result = await executor.executeStep(
        {
          stepId: rbStep.stepId,
          operation: rbStep.operation,
          parameters: rbStep.parameters,
          idempotent: true,
          preconditions: {},
          postconditions: {},
        },
        this.context.outputs,
      );

      const rbCompletedAt = new Date().toISOString();

      rollbackStepResults.push({
        stepId: rbStep.stepId,
        success: result.success,
        output: result.output ?? {},
        startedAt: rbStartedAt,
        completedAt: rbCompletedAt,
      });

      if (!result.success) {
        const completedAt = new Date().toISOString();
        this.context = { ...this.context, state: "failed" };

        return {
          success: false,
          stepResults: rollbackStepResults,
          startedAt,
          completedAt,
          reason: `Rollback step ${rbStep.stepId} failed: ${result.error ?? "Unknown error"}`,
        };
      }
    }

    const completedAt = new Date().toISOString();

    return {
      success: true,
      stepResults: rollbackStepResults,
      startedAt,
      completedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Validate that all precondition keys exist in the current context outputs.
   * Returns true if all preconditions are satisfied.
   */
  private validatePreconditions(step: ExecutionStep, context: Record<string, unknown>): string | null {
    for (const key of Object.keys(step.preconditions)) {
      if (!(key in context)) {
        return `Precondition not met: ${key}`;
      }
    }
    return null;
  }

  /**
   * Validate that all postcondition keys exist in the step output.
   * Returns true if all postconditions are satisfied.
   */
  private validatePostconditions(step: ExecutionStep, output: Record<string, unknown>): string | null {
    for (const key of Object.keys(step.postconditions)) {
      if (!(key in output)) {
        return `postcondition not met: ${key}`;
      }
    }
    return null;
  }

  /**
   * Create an execution checkpoint for the given step.
   *
   * Computes inputHash from the step configuration and all accumulated outputs,
   * and outputHash from all accumulated outputs for integrity tracking.
   * Both hashes reflect post-execution state.
   */
  private createCheckpoint(
    step: ExecutionStep,
    outputs: Record<string, unknown>,
    envHash: string,
  ): ExecutionCheckpoint {
    return {
      stepId: step.stepId,
      inputHash: createHash("sha256")
        .update(canonicalStringify({ step, outputs }))
        .digest("hex"),
      outputHash: createHash("sha256")
        .update(canonicalStringify(outputs))
        .digest("hex"),
      environmentHash: envHash,
      timestamp: new Date().toISOString(),
    };
  }

  private buildFailedResult(step: ExecutionStep, error: string, startedAt: string): ExecutionStepResult {
    return {
      stepId: step.stepId, success: false, startedAt,
      completedAt: new Date().toISOString(),
      output: {}, error,
    };
  }

  /**
   * Handle rollback after a step failure — sets state, executes rollback,
   * constructs and returns the final ExecutionReport.
   *
   * Extracted to eliminate duplicate rollback blocks (one for step execution
   * failure, one for postcondition failure).
   */
  private async handleRollbackFailure(
    plan: ExecutionPlan,
    failedStepIndex: number,
    executor: StepExecutor,
    stepResults: ExecutionStepResult[],
    startedAt: string,
  ): Promise<ExecutionReport> {
    this.context = { ...this.context, state: "rolling_back" as const };
    const rollbackResult = await this.rollback(plan, failedStepIndex, executor);
    const status: "rolled_back" | "failed" = rollbackResult.success ? "rolled_back" : "failed";
    this.context = { ...this.context, state: status };
    return {
      reportId: `rpt-${plan.planId}`,
      planId: plan.planId,
      executionId: this.context.executionId,
      status,
      stepResults,
      startedAt,
      completedAt: new Date().toISOString(),
      rollbackTriggered: true,
      rollbackResult,
    };
  }

  private finalizeReport(planId: string, startedAt: string, stepResults: ExecutionStepResult[], success: boolean) {
    this.context = { ...this.context, state: success ? ("completed" as const) : ("failed" as const) };
    return {
      reportId: `rpt-${planId}`,
      planId,
      executionId: this.context.executionId,
      status: success ? ("completed" as const) : ("failed" as const),
      stepResults,
      startedAt,
      completedAt: new Date().toISOString(),
      rollbackTriggered: false,
    };
  }
}

// ---------------------------------------------------------------------------
// TestStepExecutor
// ---------------------------------------------------------------------------

/**
 * A test double for StepExecutor useful in tests.
 *
 * Pre-loads a queue of results that are returned in order for each call to
 * executeStep. When the queue is exhausted, defaults to success with empty output.
 */
export class TestStepExecutor implements StepExecutor {
  private stepResults: Array<{
    success: boolean;
    output: Record<string, unknown>;
  }>;

  constructor(
    results?: Array<{
      success: boolean;
      output?: Record<string, unknown>;
    }>,
  ) {
    this.stepResults = results
      ? results.map((r) => ({
          success: r.success,
          output: r.output ?? {},
        }))
      : [];
  }

  async executeStep(
    _step: ExecutionStep,
    _context: Record<string, unknown>,
  ): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    const result = this.stepResults.shift() ?? { success: true, output: {} };
    return {
      success: result.success,
      output: result.output ?? {},
      error: result.success ? undefined : "Step failed",
    };
  }
}
