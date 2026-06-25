/**
 * P10.4a — StepRunner (per-behavior step execution).
 *
 * Classifies each step by behavior class and executes accordingly:
 *   read-only → execute + evidence, mark completed
 *   investigation → record intent, mark waiting_for_bridge
 *   mutation → record intent, mark waiting_for_bridge
 *
 * P10.4b will add the mutation bridge (step → AdaptationProposal).
 * A future P9.6 phase will add the investigation bridge.
 *
 * The StepRunner interface is forward-compatible with a future split into
 * ReadOnlyRunner / InvestigationRunner / MutationRunner.
 *
 * @module
 */

import type { ExecutionStep } from "./planning-engine.js";
import type { EvidenceEventWriter } from "../workflow/evidence-writer.js";
import type { StepRunnerResult, GeneratedArtifactRef } from "./executive-plan-types.js";
import { behaviorFor } from "./step-behavior.js";

export class StepRunner {
  constructor(private readonly writer: EvidenceEventWriter) {}

  /**
   * Execute a single step according to its behavior class.
   * Caller (ExecutionEngine) generates executionId and passes it in.
   * planId is the real plan identifier (NOT step.objectiveId).
   */
  async execute(planId: string, step: ExecutionStep, executionId: string): Promise<StepRunnerResult> {
    const behavior = behaviorFor(step.action);

    switch (behavior) {
      case "read-only":
        return this.executeReadOnly(planId, step, executionId);

      case "investigation":
        return this.recordIntent(planId, step, executionId, "investigation");

      case "mutation":
        return this.recordIntent(planId, step, executionId, "mutation");

      default: {
        const _exhaustive: never = behavior;
        throw new Error(`Unknown step behavior: ${_exhaustive}`);
      }
    }
  }

  private async executeReadOnly(
    planId: string,
    step: ExecutionStep,
    executionId: string,
  ): Promise<StepRunnerResult> {
    const startMs = Date.now();
    const evidenceIds: string[] = [];

    // P10.4a: "execute" is thin — it records intent + emits evidence.
    const durationMs = Date.now() - startMs; // single measurement for evidence + result
    const result = await this.writer.recordExecutiveStepExecuted({
      planId, // NOT step.objectiveId — planId is the real correlation key
      stepId: step.id,
      action: step.action,
      durationMs,
      summary: `Advisory execution of ${step.action} for ${step.targetSubsystem}`,
      executionId,
    });
    if (result?.id) evidenceIds.push(result.id);
    return {
      outcome: "executed",
      durationMs,
      summary: `Read-only step ${step.id} (${step.action})`,
      generatedArtifacts: [],
      evidenceIds,
      warnings: [],
      retryable: false,
      newStepStatus: "completed",
    };
  }

  private async recordIntent(
    planId: string,
    step: ExecutionStep,
    executionId: string,
    behaviorClass: string,
  ): Promise<StepRunnerResult> {
    const startMs = Date.now();
    const evidenceIds: string[] = [];

    const result = await this.writer.recordExecutiveStepIntentRecorded({
      planId, // NOT step.objectiveId
      stepId: step.id,
      action: step.action,
      behaviorClass,
      executionId,
    });
    if (result?.id) evidenceIds.push(result.id);

    const durationMs = Date.now() - startMs;
    return {
      outcome: "intent_recorded",
      durationMs,
      summary: `${behaviorClass} step ${step.id} (${step.action}) — waiting for bridge`,
      generatedArtifacts: [],
      evidenceIds,
      warnings: [`Step ${step.id} classified as "${behaviorClass}" — no dispatch in P10.4a`],
      retryable: false,
      newStepStatus: "waiting_for_bridge",
    };
  }
}
