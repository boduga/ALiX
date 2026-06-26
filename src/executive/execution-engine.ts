/**
 * P10.4a — ExecutionEngine (scheduler, DAG-aware step runner).
 *
 * Responsibilities:
 *   - nextRunnableSteps: pure DAG query (dependsOn all completed → runnable)
 *   - startPlan: one-shot draft → approved → running transition
 *   - runStep: execute one step, update state atomically
 *   - runReadySteps: batch execution with recompute-after-every-step
 *
 * CONSTITUTIONAL INVARIANT: Only ExecutionEngine generates executionId.
 * All downstream code receives executionId as a parameter.
 *
 * @module
 */

import { randomUUID } from "node:crypto";
import { bridgeCreateRemediationProposal, EXECUTIVE_BRIDGE_VERSION } from "./executive-bridge.js";
import { reconcileApplyStep } from "./executive-apply-reconciler.js";
import type { PlanStore } from "./plan-store.js";
import type { ExecutionStateStore } from "./execution-state-store.js";
import type { StepRunner } from "./step-runner.js";
import type { EvidenceEventWriter } from "../workflow/evidence-writer.js";
import type { ProposalStore } from "../adaptation/proposal-store.js";
import type { PersistedExecutionPlan, PlanExecutionState } from "./executive-plan-types.js";
import type { ExecutiveStepExecutionResult, StepRuntimeStatus } from "./executive-plan-types.js";
import { validateStateStepIds } from "./executive-plan-types.js";
import type { OutcomeEvaluationHook } from "./automatic-outcome-hook.js";
import { createAutomaticOutcomeEvaluator } from "./automatic-outcome-hook.js";

function generateExecutionId(): string {
  return randomUUID();
}

export class ExecutionEngine {
  constructor(
    private readonly planStore: PlanStore,
    private readonly stateStore: ExecutionStateStore,
    private readonly runner: StepRunner,
    private readonly writer: EvidenceEventWriter,
    private readonly proposalStore?: ProposalStore, // P10.4b — optional backward compat
    private readonly outcomeHook: OutcomeEvaluationHook = createAutomaticOutcomeEvaluator(".alix/executive"),
  ) {}

  // -----------------------------------------------------------------------
  // Startup
  // -----------------------------------------------------------------------

  /**
   * Start a plan: draft → approved → running. One-shot (called once).
   * Verifies consistency: state.planId === plan.id.
   */
  startPlan(planId: string, by: string): PlanExecutionState {
    const plan = this.planStore.load(planId);
    const state = this.stateStore.load(planId);
    if (!state) throw new Error(`Execution state not found: ${planId}`);
    if (state.planId !== plan.id) {
      throw new Error(
        `Startup consistency: state.planId="${state.planId}" !== plan.id="${plan.id}"`,
      );
    }

    // Must be approved to start
    if (state.status !== "approved") {
      throw new Error(
        `Cannot start plan in status "${state.status}" — must be "approved"`,
      );
    }

    const executionId = generateExecutionId();
    const updated = this.stateStore.update(
      planId,
      { from: state.status, to: "running", executionId },
      s => {
        s.status = "running";
        s.timestamps.runningAt = new Date().toISOString();
        s.lastExecutionId = executionId;
        return s;
      },
    );

    const runnableCount = this.computeNextRunnableIds(plan, updated).length;
    this.writer.recordExecutivePlanStarted({
      planId,
      runnableStepCount: runnableCount,
      executionId,
    }).catch(() => {});

    return updated;
  }

  // -----------------------------------------------------------------------
  // DAG query
  // -----------------------------------------------------------------------

  /**
   * Returns step IDs whose dependsOn are all completed AND status === "pending".
   * Pure DAG query — no side effects.
   */
  nextRunnableSteps(planId: string): string[] {
    const plan = this.planStore.load(planId);
    const state = this.stateStore.load(planId);
    if (!state) throw new Error(`Execution state not found: ${planId}`);
    validateStateStepIds(plan, state);
    return this.computeNextRunnableIds(plan, state);
  }

  private computeNextRunnableIds(
    plan: PersistedExecutionPlan,
    state: PlanExecutionState,
  ): string[] {
    return plan.steps
      .filter(step => {
        const runtime = state.stepStates[step.id];
        if (!runtime || runtime.status !== "pending") return false;
        // All dependsOn must be completed
        return step.dependsOn.every(depId => {
          const depState = state.stepStates[depId];
          return depState?.status === "completed" || depState?.status === "waiting_for_bridge";
        });
      })
      .map(s => s.id);
  }

  // -----------------------------------------------------------------------
  // Core execution path (shared by runStep and runReadySteps)
  // -----------------------------------------------------------------------

  /**
   * Execute one step: mark in_progress -> runner.execute -> persist result ->
   * check completion. Single canonical implementation that both runStep() and
   * runReadySteps() delegate to. executionId is caller-provided:
   * runStep() generates its own, runReadySteps() passes the shared batch ID.
   */
  private async executeStepInternal(
    planId: string,
    stepId: string,
    executionId: string,
  ): Promise<ExecutiveStepExecutionResult> {
    const plan = this.planStore.load(planId);
    const step = plan.steps.find(s => s.id === stepId);
    if (!step) throw new Error(`Step ${stepId} not found in plan ${planId}`);

    const state = this.stateStore.load(planId);
    if (!state) throw new Error(`Execution state not found: ${planId}`);

    // Mark in_progress
    this.stateStore.update(
      planId,
      { from: state.status, to: state.status, executionId },
      s => {
        if (s.stepStates[stepId]) {
          s.stepStates[stepId].status = "in_progress";
          s.stepStates[stepId].startedAt = new Date().toISOString();
          s.stepStates[stepId].lastExecutionId = executionId;
        }
        return s;
      },
    );

    // Execute via StepRunner (planId + executionId passed, never generated here)
    const result = await this.runner.execute(planId, step, executionId);

    // ─── P10.4b executive bridge dispatch ─────────────────────────────────
    // Bridge `create_remediation_proposal` steps into existing P5/P9
    // proposal lifecycle. Idempotent: silent no-op if generatedArtifacts
    // already contains { type: "proposal" } ref. Status stays
    // "waiting_for_bridge" — human completes proposal via existing
    // alix adaptation lifecycle.
    if (step.action === "create_remediation_proposal" && this.proposalStore) {
      const stepState = this.stateStore.load(planId)?.stepStates[stepId];
      const existingRef = stepState?.generatedArtifacts.find(
        a => a.type === "proposal",
      );
      if (!existingRef) {
        const proposalId = `proposal-${randomUUID()}`;
        const now = new Date().toISOString();
        try {
          const bridgeResult = await bridgeCreateRemediationProposal(
            plan, step, proposalId, now,
            (proposal) => this.proposalStore!.save(proposal),
          );
          this.stateStore.update(
            planId,
            { from: state.status, to: state.status, executionId },
            s => {
              if (s.stepStates[stepId]) {
                s.stepStates[stepId].generatedArtifacts.push(bridgeResult.artifactRef);
              }
              return s;
            },
          );
          await this.writer.recordExecutiveStepBridgedToProposal({
            planId: plan.id,
            stepId: step.id,
            proposalId: bridgeResult.proposal.id,
            bridgeVersion: EXECUTIVE_BRIDGE_VERSION,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          this.stateStore.update(
            planId,
            { from: state.status, to: state.status, executionId },
            s => {
              if (s.stepStates[stepId]) {
                s.stepStates[stepId].warnings.push(`executive bridge failed: ${msg}`);
              }
              return s;
            },
          );
          await this.writer.recordExecutiveStepBridgeFailed({
            planId: plan.id,
            stepId: step.id,
            error: msg,
          });
        }
      }
    }

    // ─── P10.4c executive apply reconciler ──────────────────────────────────
    // Reconcile `apply_remediation` steps by observing the linked proposal's
    // lifecycle status. If the proposal is "applied", mark the step completed.
    // Otherwise stay "waiting_for_bridge". Do NOT clear prior warnings.
    if (step.action === "apply_remediation" && this.proposalStore) {
      const proposals = await this.proposalStore.list();
      const reconcileResult = reconcileApplyStep(plan, step, proposals);
      if (reconcileResult.stepCompleted) {
        result.newStepStatus = "completed";
        result.summary = `Proposal ${reconcileResult.matchedProposalId} was applied`;
        // Append reconciler note; do NOT clear prior warnings (they may contain
        // useful history from previous run attempts).
        await this.writer.recordExecutiveStepAppliedRemediation({
          planId: plan.id,
          stepId: step.id,
          proposalId: reconcileResult.matchedProposalId!,
        });
      }
    }

    // Mark terminal based on runner result
    const finalState = this.stateStore.update(
      planId,
      { from: state.status, to: state.status, executionId },
      s => {
        if (s.stepStates[stepId]) {
          s.stepStates[stepId].status = result.newStepStatus;
          s.stepStates[stepId].completedAt = new Date().toISOString();
          s.stepStates[stepId].durationMs = result.durationMs;
          s.stepStates[stepId].evidenceIds = result.evidenceIds;
          s.stepStates[stepId].summary = result.summary;
          // P10.4b — accumulate warnings so the bridge failure warning
          // (set earlier in this invocation when the bridge throws) is
          // preserved alongside any runner warnings. Matches the
          // generatedArtifacts accumulation pattern above.
          s.stepStates[stepId].warnings = [...s.stepStates[stepId].warnings, ...result.warnings];
          s.stepStates[stepId].lastExecutionId = executionId;
        }
        return s;
      },
    );

    // Check if all steps are terminal -> plan completed
    await this.maybeCompletePlan(plan, finalState, executionId);

    return {
      stepId,
      status: result.newStepStatus,
      durationMs: result.durationMs,
      evidenceIds: result.evidenceIds,
      executionId,
    };
  }

  // -----------------------------------------------------------------------
  // Single-step execution (entry point)
  // -----------------------------------------------------------------------

  /**
   * Run one step. Throws if not runnable.
   * One executionId per invocation (the constitutional invariant).
   */
  async runStep(planId: string, stepId: string): Promise<ExecutiveStepExecutionResult> {
    const state = this.stateStore.load(planId);
    if (!state) throw new Error(`Execution state not found: ${planId}`);
    if (state.status !== "running") {
      throw new Error(`Cannot run steps in plan with status "${state.status}" — must be "running"`);
    }

    const runnable = this.nextRunnableSteps(planId);
    if (!runnable.includes(stepId)) {
      throw new Error(`Step ${stepId} is not runnable (dependencies incomplete or not pending)`);
    }

    const executionId = generateExecutionId();
    return this.executeStepInternal(planId, stepId, executionId);
  }

  // -----------------------------------------------------------------------
  // Batch execution (entry point)
  // -----------------------------------------------------------------------

  /**
   * Run all currently runnable steps sequentially.
   *
   * CONSTITUTIONAL INVARIANT: ONE executionId shared by EVERY step in the
   * batch. All state updates and evidence events share the same correlation
   * context.
   *
   * Scheduling policy:
   *   1. nextRunnableSteps() - initial DAG query
   *   2. Sort by stepNumber ascending
   *   3. Execute ONE step at a time (via executeStepInternal)
   *   4. Persist state after every step (atomic write)
   *   5. AFTER each step: RECOMPUTE nextRunnableSteps()
   *   6. Continue until no runnable steps remain
   *   7. Return array of results
   *
   * NOTE: Each outer-loop iteration reloads plan + state from disk so the
   * DAG query always sees the latest committed state. This is intentional.
   */
  async runReadySteps(planId: string): Promise<ExecutiveStepExecutionResult[]> {
    const state = this.stateStore.load(planId);
    if (!state) throw new Error(`Execution state not found: ${planId}`);
    if (state.status !== "running") {
      throw new Error(`Cannot run steps in plan with status "${state.status}" — must be "running"`);
    }

    const executionId = generateExecutionId();
    const results: ExecutiveStepExecutionResult[] = [];

    let runnable = this.nextRunnableSteps(planId);
    while (runnable.length > 0) {
      // NOTE: Plan is reloaded per outer iteration (not inside the inner loop)
      // because plans are immutable — loading once here is safe even though
      // the state changes after every executed step. A future "optimizer" that
      // tries to cache the plan across iterations would be correct but
      // unnecessary; immutability guarantees no staleness.
      const plan = this.planStore.load(planId);
      const sortedSteps = runnable
        .map(id => ({ id, step: plan.steps.find(s => s.id === id)! }))
        .filter(x => x.step)
        .sort((a, b) => a.step.stepNumber - b.step.stepNumber);

      for (const { id } of sortedSteps) {
        // Recheck runnable (state may have changed since last iteration)
        const state2 = this.stateStore.load(planId);
        if (!state2) throw new Error(`Execution state vanished for plan ${planId} during runReadySteps`);
        const currentRunnable = this.computeNextRunnableIds(plan, state2);
        if (!currentRunnable.includes(id)) continue;

        // Uses the SAME executionId as the batch
        const result = await this.executeStepInternal(planId, id, executionId);
        results.push(result);
      }

      runnable = this.nextRunnableSteps(planId);
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private async maybeCompletePlan(
    plan: PersistedExecutionPlan,
    state: PlanExecutionState,
    executionId: string,
  ): Promise<void> {
    const allDone = plan.steps.every(s => {
      const r = state.stepStates[s.id];
      return r?.status === "completed" || r?.status === "waiting_for_bridge";
    });
    if (allDone && state.status === "running") {
      const updatedState = this.stateStore.update(
        plan.id,
        { from: "running", to: "completed", executionId },
        s => {
          s.status = "completed";
          s.timestamps.completedAt = new Date().toISOString();
          return s;
        },
      );
      const totalDurationMs = plan.steps.reduce((sum, s) => {
        const stepState = state.stepStates[s.id];
        return sum + (stepState?.durationMs ?? 0);
      }, 0);
      this.writer.recordExecutivePlanCompleted({
        planId: plan.id,
        totalDurationMs,
        executionId,
      }).catch(() => {});

      // P10.5c — automatic outcome evaluation hook (best-effort, awaited).
      // Fires AFTER durable completion + completion evidence. Pass the
      // post-completion state so the hook has access to the terminal
      // timestamp. The hook itself never throws upward (it swallows its
      // own errors), but we wrap with try/catch as paranoia so plan
      // completion is never blocked even if a misbehaving stub violates
      // the interface contract.
      try {
        await this.outcomeHook.run(plan, updatedState);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(
          `[execution-engine] Outcome evaluation hook threw — swallowing to preserve plan completion: ${msg}`,
        );
      }
    }
  }
}
