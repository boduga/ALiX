/**
 * End-of-iteration verification + repair phase — extracted from `runTaskLoop`
 * (#717 method decomposition). Behavior is unchanged from the inline block it
 * replaces. Returns an `earlyReturn` RunResult when the repair limit is reached,
 * otherwise the updated `repairCount` (the caller pushes the repair prompt into
 * `messages` via the shared `messages` array).
 */

import type { NormalizedMessage } from "../../../models/providers/types.js";
import type { EventLog } from "../../../runtime-state/events/event-log.js";
import type { MutationSessionState } from "../../../agents/agent/mutations.js";
import type { RunResult } from "../../../execution/run/run-contract.js";
import type { TaskStateMachine } from "../../../planning/autonomy/state-machine.js";
import type { EnhancedVerifier } from "../../verifier/enhanced-verifier.js";
import type { ContextBudget } from "../../../operations/config/context-budget.js";
import type { ContextRotThreshold } from "../../../operations/config/calibration-store.js";
import { objectiveEvidenceRequirements, objectiveEvidenceGaps, emitAgent, VERIFICATION_EVIDENCE_GAP, type SuccessfulToolEvidence } from "./predicates.js";
import { maybeEmitRotRisk, getHistoricalSuggestions } from "./session-lifecycle.js";
import { evaluatePattern } from "./context-helpers.js";
import { buildRiskReport } from "../../verifier/index.js";
import { shouldRunVerification, requiresRepositoryVerification, runVerification, type VerificationCheck, type VerificationResult } from "../../verifier/verifier.js";
import { DEFAULT_FACTORY_CONFIG } from "../../../capabilities/skills/dispatcher.js";
import type { createContextPressureTracker } from "../context-pressure.js";
import type { TaskLoopDeps } from "./main.js";

export interface IterationVerificationParams {
  iteration: number;
  sessionState: MutationSessionState;
  config: TaskLoopDeps["config"];
  log: EventLog;
  session: { sessionId: string; actor: "system" };
  evidenceTask: string;
  evidenceTaskType: string;
  successfulToolEvidence: SuccessfulToolEvidence[];
  taskType: string;
  hasMutations: boolean;
  stateMachine: TaskStateMachine;
  repairCount: number;
  maxRepairs: number;
  enhancedVerifier: EnhancedVerifier | null;
  messages: NormalizedMessage[];
  sessionId: string;
  sessionDir: string;
  streamed: boolean | undefined;
  contextRotThreshold: ContextRotThreshold | undefined;
  contextPressure: ReturnType<typeof createContextPressureTracker>;
  contextBudget: ContextBudget;
  lastInvocationId: string;
  /**
   * The agent's working directory — the root verification runs against. Must be
   * the real CWD: a post-change check that does not see the change is not a
   * verification.
   */
  cwd: string;
}

export async function runIterationVerification(p: IterationVerificationParams): Promise<{
  repairCount: number;
  earlyReturn?: RunResult;
}> {
  const {
    sessionState, config, log, session, evidenceTask, evidenceTaskType,
    successfulToolEvidence, taskType, hasMutations, stateMachine, maxRepairs,
    enhancedVerifier, messages, sessionId, sessionDir, streamed,
    contextRotThreshold, contextPressure, contextBudget, lastInvocationId, cwd,
  } = p;
  let repairCount = p.repairCount;
  const i = p.iteration;

  // After tool calls, run verification every iteration (if policy allows)
  const scopeApproved = !sessionState.pendingScopeExpansion;
  const { skipReason } = shouldRunVerification(config.permissions.sessionMode ?? "ask", scopeApproved);

  if (skipReason) {
    await log.append({ ...session, actor: "verifier", type: "verification.skipped", payload: { reason: skipReason } });
  } else {
    const changedFiles = [...sessionState.created, ...sessionState.changed];
    const explicitVerificationRequired = objectiveEvidenceRequirements(evidenceTask, evidenceTaskType).verification;
    const explicitVerificationMissing = objectiveEvidenceGaps(evidenceTask, evidenceTaskType, successfulToolEvidence)
      .includes(VERIFICATION_EVIDENCE_GAP);
    if (
      changedFiles.length > 0 &&
      requiresRepositoryVerification(changedFiles, explicitVerificationRequired && explicitVerificationMissing) &&
      (taskType !== "docs" || explicitVerificationRequired) &&
      taskType !== "research" &&
      hasMutations
    ) {
      // Use TestPlanner for smart verification selection
      const { createTestPlan } = await import("../../verifier/test-planner.js");

      const plan = await createTestPlan(".", changedFiles);

      await log.append({ ...session, actor: "verifier", type: "verification.plan_created", payload: {
        strategy: plan.strategy,
        totalCost: plan.totalCost,
        checkCount: plan.checks.length,
        verifiedFiles: plan.verifiedFiles,
        unverifiedFiles: plan.unverifiedFiles,
      }});

      const endResults: Array<{ check: VerificationCheck; result: VerificationResult }> = [];

      // Run checks in cost order. The root is the agent's CWD, not "." —
      // this verification must see the edits the agent just made.
      for (const endCheck of plan.checks) {
        await log.append({ ...session, actor: "verifier", type: "verification.check_started", payload: { command: endCheck.command, reason: endCheck.reason } });
        const verResult = await runVerification(cwd, endCheck);
        await log.append({ ...session, actor: "verifier", type: "verification.check_finished", payload: { command: endCheck.command, status: verResult.status, isolated: verResult.isolated === true } });
        endResults.push({ check: endCheck, result: verResult });
      }

      const riskReport = buildRiskReport(plan.checks, endResults);

      const failedChecks = endResults.filter((r) => r.result.status === "failed");
      if (failedChecks.length > 0) {
        repairCount++;
        // Emit decision for repair
        await emitAgent(log, session, "agent.decision", {
          kind: "repair", iteration: i,
          description: `Entering repair loop (attempt ${repairCount}/${maxRepairs})`,
          outcome: "executed",
        });
        stateMachine.recordRepair();
        if (repairCount > maxRepairs) {
          await maybeEmitRotRisk({ log, session, threshold: contextRotThreshold, contextPressure: contextPressure.snapshot(), contextBudget, lastInvocationId });
          await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_repairs", summary: `Repair limit reached after ${maxRepairs} attempts`, ...(contextPressure ? { contextPressure: contextPressure.snapshot() } : {}) } });
          const { skillFactory } = await import("../../../capabilities/skills/dispatcher.js");
          void skillFactory.process({
            sessionId,
            sessionDir,
            summary: "Repair limit reached",
            filesCreated: [...sessionState.created],
            filesChanged: [...sessionState.changed],
            config: config.skills?.factory ?? DEFAULT_FACTORY_CONFIG,
          });
          await evaluatePattern(log, session, sessionDir, taskType);
          return { repairCount, earlyReturn: { sessionId, summary: "Repair limit reached", streamed, contextPressure: contextPressure.snapshot() } };
        }
        const failureText = failedChecks
          .map((f) => `${f.check.command} failed:\n${f.result.output ?? ""}`)
          .join("\n\n");

        const fullPrompt = riskReport
          ? `${failureText}\n\nResidual risk (not verified):\n${riskReport}`
          : failureText;

        // Get historical suggestions for similar failures
        const historicalSuggestions = enhancedVerifier
          ? await getHistoricalSuggestions(enhancedVerifier, failedChecks, sessionState, session, log)
          : [];

        let repairPrompt = `\n\n[Verification Failed] ${fullPrompt}\n\nFix the issues and try again.`;
        if (historicalSuggestions.length > 0) {
          repairPrompt += "\n\n**Similar failures that were resolved:**\n" + historicalSuggestions.join("\n");
        }
        messages.push({ role: "user", content: repairPrompt });
      }
    }
  }

  return { repairCount };
}
