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
   *   1. Create a checkpoint with input hash (context + step params)
   *   2. Validate preconditions exist in context
   *   3. Execute the step via the injected executor
   *   4. Validate postconditions exist in output
   *   5. Record result with success/failure and timing
   *   6. Retry idempotent steps on transient failure up to maxRetries
   *   7. On success: update context.outputs, push checkpoint
   *   8. On failure: trigger rollback (if enabled), return report
   *
   * @param plan - The execution plan to execute.
   * @param executor - The step executor that performs each step.
   * @returns ExecutionReport with final status and step results.
   */
  async execute(
    plan: ExecutionPlan,
    executor: StepExecutor,
  ): Promise<ExecutionReport> {
    const startedAt = new Date().toISOString();
    const stepResults: ExecutionStepResult[] = [];
    let rollbackTriggered = false;
    let rollbackResult: RollbackResult | undefined;
    let finalStatus: "completed" | "failed" | "rolled_back" = "completed";

    // Transition to executing
    this.context = { ...this.context, state: "executing" };

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const stepStartedAt = new Date().toISOString();

      // 1. Create checkpoint
      const checkpoint = this.createCheckpoint(step, {
        ...this.context.outputs,
        ...step.parameters,
      });

      // 2. Validate preconditions
      if (!this.validatePreconditions(step)) {
        const stepCompletedAt = new Date().toISOString();
        stepResults.push({
          stepId: step.stepId,
          success: false,
          output: {},
          startedAt: stepStartedAt,
          completedAt: stepCompletedAt,
        });

        finalStatus = "failed";
        break;
      }

      // 3 & 6. Execute step with retry for idempotent steps
      let lastError: string | undefined;
      let output: Record<string, unknown> = {};
      let success = false;

      const maxAttempts = step.idempotent ? 1 + this.config.maxRetries : 1;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const result = await executor.executeStep(step, {
          ...this.context.outputs,
          ...step.parameters,
        });

        if (result.success) {
          success = true;
          output = result.output ?? {};
          break;
        }

        lastError = result.error;

        // If not idempotent, don't retry
        if (!step.idempotent) {
          break;
        }
      }

      const stepCompletedAt = new Date().toISOString();

      if (success) {
        // 4. Validate postconditions
        if (!this.validatePostconditions(step, output)) {
          stepResults.push({
            stepId: step.stepId,
            success: false,
            output,
            startedAt: stepStartedAt,
            completedAt: stepCompletedAt,
          });

          finalStatus = "failed";
          break;
        }

        // 5. Record successful result
        stepResults.push({
          stepId: step.stepId,
          success: true,
          output,
          startedAt: stepStartedAt,
          completedAt: stepCompletedAt,
        });

        // 7. Update context with output and push checkpoint
        this.context = {
          ...this.context,
          outputs: { ...this.context.outputs, [step.stepId]: output },
          checkpoints: [...this.context.checkpoints, checkpoint],
        };
      } else {
        // 5. Record failure result
        stepResults.push({
          stepId: step.stepId,
          success: false,
          output,
          startedAt: stepStartedAt,
          completedAt: stepCompletedAt,
        });

        // 8. Handle failure
        if (this.config.enableRollback) {
          this.context = { ...this.context, state: "rolling_back" };
          rollbackTriggered = true;

          rollbackResult = await this.rollback(plan, i, executor);

          if (rollbackResult.success) {
            finalStatus = "rolled_back";
          } else {
            finalStatus = "failed";
          }
        } else {
          finalStatus = "failed";
        }

        break;
      }
    }

    // All steps completed successfully
    if (finalStatus === "completed") {
      this.context = { ...this.context, state: "completed" };
    } else if (finalStatus === "rolled_back") {
      this.context = { ...this.context, state: "rolled_back" };
    } else {
      this.context = { ...this.context, state: "failed" };
    }

    const completedAt = new Date().toISOString();

    return {
      reportId: `report-${this.context.executionId}`,
      planId: plan.planId,
      executionId: this.context.executionId,
      status: finalStatus,
      stepResults,
      startedAt,
      completedAt,
      rollbackTriggered,
      rollbackResult,
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
    const completedSteps = plan.rollbackPlan.slice(0, failedStepIndex);

    // Execute rollback steps in reverse order
    for (let i = completedSteps.length - 1; i >= 0; i--) {
      const rbStep = completedSteps[i];
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
  private validatePreconditions(step: ExecutionStep): boolean {
    const preconditionKeys = Object.keys(step.preconditions);
    if (preconditionKeys.length === 0) return true;

    return preconditionKeys.every((key) => key in this.context.outputs);
  }

  /**
   * Validate that all postcondition keys exist in the step output.
   * Returns true if all postconditions are satisfied.
   */
  private validatePostconditions(
    step: ExecutionStep,
    output: Record<string, unknown>,
  ): boolean {
    const postconditionKeys = Object.keys(step.postconditions);
    if (postconditionKeys.length === 0) return true;

    return postconditionKeys.every((key) => key in output);
  }

  /**
   * Create an execution checkpoint for the given step.
   *
   * Hashes the combined input context (current outputs + step parameters)
   * and the current outputs for integrity tracking.
   */
  private createCheckpoint(
    step: ExecutionStep,
    inputContext: Record<string, unknown>,
  ): ExecutionCheckpoint {
    const inputHash = createHash("sha256")
      .update(canonicalStringify(inputContext))
      .digest("hex");
    const outputHash = createHash("sha256")
      .update(canonicalStringify(this.context.outputs))
      .digest("hex");
    return {
      stepId: step.stepId,
      inputHash,
      outputHash,
      environmentHash: "",
      timestamp: new Date().toISOString(),
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
