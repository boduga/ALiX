import type { TaskLoopDeps } from './main.js';
import type { RunResult } from '../../run.js';
import type { EnhancedVerifier } from '../../verifier/enhanced-verifier.js';
import type { ContextRotThreshold } from '../../config/calibration-store.js';
import type { createContextPressureTracker } from '../context-pressure.js';
import type { resolveModelConfig } from '../../config/model-resolver.js';
import type { runHook } from '../../hooks/runner.js';
import { shouldRunVerification, discoverVerification, requiresRepositoryVerification, runVerification, type VerificationCheck, type VerificationResult } from '../../verifier/verifier.js';
import { buildRefinePrompt, selectStrategy } from '../../orchestrator/refine-strategies.js';
import { DEFAULT_FACTORY_CONFIG } from '../../skills/dispatcher.js';
import { evaluatePattern } from './context-helpers.js';
import { gatePendingAgentAction } from './pending-action-phase.js';
import { CLAIM_TOOL_NAMES, COORDINATION_EVIDENCE_GAP, SHORT_SYNTHESIS_THRESHOLD, type SuccessfulToolEvidence, VERIFICATION_EVIDENCE_GAP, buildSynthesisReprompt, buildUnconfirmedDonePrompt, claimsArtifactWritten, durableCompletionSummary, findUnsubstantiatedClaims, hasExecutedActionTool, isToolResultEcho, lastToolResultShowsClientError, latestToolFailure, missingEvidenceSummary, objectiveEvidenceGaps, objectiveEvidenceRequirements } from './predicates.js';
import { RESEARCH_LIMITS, completeSession, getHistoricalSuggestions, maybeEmitRotRisk } from './session-lifecycle.js';

export interface CompletionState {
  repairCount: number;
  unconfirmedDoneAttempts: number;
  noToolNudges: number;
  synthesisRequested: boolean;
  emptySynthesisRetryRequested: boolean;
}
export type CompletionContext = Pick<TaskLoopDeps, 'config' | 'hooks' | 'log' | 'session' | 'maxIterations' | 'contextBudget' | 'taskType' | 'depth' | 'memoryStore' | 'sessionId' | 'sessionDir' | 'sessionState' | 'task' | 'providerTools'> & {
  deps: TaskLoopDeps;
  state: CompletionState;
  evidenceTask: string;
  evidenceTaskType: string;
  successfulToolEvidence: SuccessfulToolEvidence[];
  hasMutations: boolean;
  model: ReturnType<typeof resolveModelConfig>;
  contextRotThreshold: ContextRotThreshold | undefined;
  contextPressure: ReturnType<typeof createContextPressureTracker>;
  lastInvocationId: string;
  lastAgentProse: string | undefined;
  usedTools: Set<string>;
  messages: TaskLoopDeps['messages'];
  text: string;
  i: number;
  explicitDoneCalled: boolean;
  enhancedVerifier: EnhancedVerifier | null;
  coordinationUnverified: boolean;
  searchCalls: number;
  hookRunEnv: Record<string, string>;
  maxRepairs: number;
  runHook: typeof runHook;
  NO_TOOL_NUDGE_LIMIT: number;
  MAX_UNCONFIRMED_DONE_ATTEMPTS: number;
};

/** Content of the most recent `<tool_result …>` message, if any. */
function lastToolResultContent(
  messages: ReadonlyArray<{ content?: unknown }>,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i]?.content;
    if (typeof content === "string" && content.includes("<tool_result")) return content;
  }
  return undefined;
}

/** Pull a run id out of a `coordination.run` tool result (structured first). */
function parseCoordinationRunId(output: string | undefined): string | undefined {
  const match = /Coordination run:\s*(\S+)/.exec(output ?? "");
  return match?.[1];
}

/**
 * Is the coordination run this call started actually verified?
 *
 * Requires all four facts, from the run's own record and durable evidence:
 * execution terminal, aggregate generated, outcome known, verification
 * evidence present. A successful `coordination.run` invocation proves none of
 * them (cohort `t3d-2026-09-28-c`: 7 runs closed `completed`, only 3 carried an
 * aggregate). Unresolvable identity or an unreadable run returns false — the
 * gate fails closed.
 */
export async function coordinationRunIsVerified(
  toolResult: unknown,
  cwd: string,
  sessionId: string,
): Promise<boolean> {
  const result = (toolResult ?? {}) as { coordinationRunId?: string; output?: string };
  const runId = result.coordinationRunId
    ?? parseCoordinationRunId(typeof result.output === "string" ? result.output : undefined);
  if (!runId) return false;
  try {
    const { CoordinationStore } = await import("../../kernel/coordination-store.js");
    const { deriveCoordinationCompletion, matchesAttachedAggregateEvent } =
      await import("../../kernel/coordination-types.js");
    const { computeAggregationSourceFingerprint } =
      await import("../../kernel/coordination-aggregation-fingerprint.js");
    const { readRunSessionEvents } = await import("../../kernel/coordination-view.js");
    const run = await new CoordinationStore(cwd).load(runId);
    if (!run) return false;
    const completion = deriveCoordinationCompletion(run, {
      currentFingerprint: computeAggregationSourceFingerprint(run),
      aggregateEventMatches: matchesAttachedAggregateEvent(run, await readRunSessionEvents(cwd, sessionId)),
    });
    return completion.execution === "completed"
      && completion.aggregation === "generated"
      && completion.outcome !== "unknown"
      && completion.verification === "verified";
  } catch {
    return false;
  }
}


/** Completion/repair policy; iteration counters are returned through the shared state. */
export async function runNoToolsCompletion(ctx: CompletionContext): Promise<RunResult | "continue" | undefined> {
  ctx.deps.cancellationToken?.throwIfCancelled();
  const { deps, config, hooks, log, session, maxIterations, contextBudget, evidenceTask, evidenceTaskType, successfulToolEvidence, taskType, hasMutations, depth, memoryStore, sessionId, sessionDir, model, contextRotThreshold, contextPressure, lastInvocationId, lastAgentProse, usedTools, messages, text, i, explicitDoneCalled, sessionState, enhancedVerifier, task, coordinationUnverified, searchCalls, hookRunEnv, maxRepairs, runHook, providerTools, NO_TOOL_NUDGE_LIMIT, MAX_UNCONFIRMED_DONE_ATTEMPTS } = ctx;
  let { repairCount, unconfirmedDoneAttempts, noToolNudges, synthesisRequested, emptySynthesisRetryRequested } = ctx.state;
  try {
  // Check before research limits, verification and prose completion alike.
  const pending = await gatePendingAgentAction({ text, iteration: i, maxIterations,
    attempts: unconfirmedDoneAttempts, maxAttempts: MAX_UNCONFIRMED_DONE_ATTEMPTS, messages, log, session });
  if (pending) {
    unconfirmedDoneAttempts = pending.attempts;
    if (pending.retry) return "continue";
    return await completeSession(session, log, memoryStore, sessionDir, taskType,
      sessionId, pending.summary, model.streaming ?? false, "session.ended",
      "completed_unverified", contextPressure.snapshot(), { threshold: contextRotThreshold, contextBudget, lastInvocationId });
  }
  // No tools called — check if model signals completion. A model that has
  // never invoked a tool and has already been nudged once is treated as done
  // on a text-only reply: forcing tool use on a model that keeps refusing
  // just spins identical context until max_iterations.
  const nudgedOut = noToolNudges >= NO_TOOL_NUDGE_LIMIT && usedTools.size === 0;
  const modelSaysDone =
    explicitDoneCalled ||
    nudgedOut ||
    (synthesisRequested && text.trim().length > 0) ||
    /done|complete|finished|resolved/i.test(text);

  // If the model emitted text but no tool calls and didn't signal done,
  // re-prompt once to nudge it into taking action. This handles the
  // common case where the model produces a verbal plan in its first
  // turn instead of immediately invoking tools, or where the tool call
  // JSON was truncated/invalid. Nudging is bounded to one attempt — a
  // subsequent text-only reply is accepted (see `nudgedOut` above).
  if (!modelSaysDone && noToolNudges < NO_TOOL_NUDGE_LIMIT && i < maxIterations - 1) {
    // If the text looks like a tool-call attempt but nothing parsed, the model
    // likely invented a foreign tool name (e.g. exec_command). List the real
    // names + format so it self-corrects instead of silently dropping the call.
    const sawToolMarkers = /<\s*(tool_calls?|invoke|function_calls)\b|<\s*invoke\s+name=/i.test(text);
    const validNames = providerTools.map((t) => t.name).join(", ");
    messages.push({
      role: "user",
      content: sawToolMarkers
        ? `No valid tool call was parsed from your last response. The only tools available are: ${validNames}. ` +
          `Invoke exactly one by name — e.g. <alix_shell_run><command>ls -la</command></alix_shell_run> — ` +
          `and wait for the result before continuing. Do not invent tool names.`
        : "No tool calls were detected in your last response. To proceed, you must invoke a tool using the proper tool-use format. " +
          "For multi-step tasks, invoke ONE tool at a time and wait for the result before continuing. " +
          "Use the `alix_done` tool when the task is complete.",
    });
    noToolNudges++;
    return "continue";
  }

  // Run post_task hooks
  for (const hook of hooks.post_task ?? []) {
    await log.append({ ...session, actor: "system", type: "hook.post_task", payload: { command: hook.command, reason: hook.reason } });
    const result = await runHook(hook, deps.sessionId, { ...hookRunEnv, ALIX_RUN_STATUS: "success" });
    await log.append({ ...session, actor: "system", type: "hook.post_task", payload: { command: hook.command, passed: result.passed, output: result.output.slice(0, 500) } });
  }

  // Policy check: skip verification in ask mode unless scope is approved
  const scopeApprovedNoTools = !sessionState.pendingScopeExpansion;
  const { skipReason: skipReasonNoTools } = shouldRunVerification(config.permissions.sessionMode ?? "ask", scopeApprovedNoTools);

  if (skipReasonNoTools) {
    await log.append({ ...session, actor: "verifier", type: "verification.skipped", payload: { reason: skipReasonNoTools } });
  }

  const changedFilesForVerification = [...sessionState.created, ...sessionState.changed];
  const explicitVerificationRequired = objectiveEvidenceRequirements(evidenceTask, evidenceTaskType).verification;
  const explicitVerificationMissing = objectiveEvidenceGaps(evidenceTask, evidenceTaskType, successfulToolEvidence)
    .includes(VERIFICATION_EVIDENCE_GAP);
  const checks = requiresRepositoryVerification(
    changedFilesForVerification,
    explicitVerificationRequired && explicitVerificationMissing,
  )
    ? await discoverVerification(".")
    : [];

  // For docs and research tasks, skip verification
  // Also skip if no file mutations occurred (nothing to verify)
  if ((taskType === "docs" && !explicitVerificationRequired) || taskType === "research" || !hasMutations || checks.length === 0) {
    // Check research-specific limits
    if (taskType === "research") {
      const limits = RESEARCH_LIMITS[depth];
      if (searchCalls >= limits.maxSearchCalls) {
        await maybeEmitRotRisk({ log, session, threshold: contextRotThreshold, contextPressure: contextPressure.snapshot(), contextBudget, lastInvocationId });
        await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_search_calls", summary: `Research reached limit of ${searchCalls} search calls`, ...(contextPressure ? { contextPressure: contextPressure.snapshot() } : {}) } });
        await evaluatePattern(log, session, sessionDir, taskType);
        return { sessionId, summary: text || "Research completed (max search calls)", streamed: model.streaming, ...(coordinationUnverified ? { reason: "completed_unverified" as const } : {}), contextPressure: contextPressure.snapshot(), ...(lastAgentProse !== undefined ? { lastAgentProse } : {}) };
      }
      if (i >= limits.maxIterations) {
        await maybeEmitRotRisk({ log, session, threshold: contextRotThreshold, contextPressure: contextPressure.snapshot(), contextBudget, lastInvocationId });
        await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_iterations", summary: `Research reached limit of ${limits.maxIterations} iterations`, ...(contextPressure ? { contextPressure: contextPressure.snapshot() } : {}) } });
        await evaluatePattern(log, session, sessionDir, taskType);
        return { sessionId, summary: text || "Research completed (max iterations)", streamed: model.streaming, ...(coordinationUnverified ? { reason: "completed_unverified" as const } : {}), contextPressure: contextPressure.snapshot(), ...(lastAgentProse !== undefined ? { lastAgentProse } : {}) };
      }
    }
    if (modelSaysDone) {
      // If the agent ran tool calls but never produced a final synthesis
      // (i.e. text is just the opening intro and toolCalls were issued
      // earlier), force one more iteration to get a real final answer.
      // Without this, the user sees the agent's first line of text
      // labeled as the "summary" even though no work was finalized.
      const ranToolCalls = hasExecutedActionTool(usedTools);
      if (ranToolCalls && text.trim().length === 0 && !synthesisRequested && i < maxIterations - 1) {
        synthesisRequested = true;
        messages.push({
          role: "user",
          content:
            "You called tools but didn't produce a final synthesis. " +
            "Write a concise summary of what you did, what you found, and the outcome.",
        });
        return "continue";
      }

      // Prose containing "done"/"complete" is NOT a trustworthy completion
      // signal by itself — it's exactly what a model emits when it narrates
      // finishing steps it never actually executed. It's only safe to trust
      // outright when no tools were ever invoked this session (nothing to
      // hallucinate about, since ranToolCalls is false here). Otherwise,
      // require either a real `done` tool call or that every claim the
      // summary makes is backed by an actual tool call — bounded, so a
      // persistently non-compliant model still terminates, just labeled
      // honestly instead of silently accepted as "completed".
      const unsubstantiated = findUnsubstantiatedClaims(text, usedTools);
      // A "done" right after a tool result that looks like an HTTP/client
      // error, when nothing was written and the reply doesn't claim an
      // artifact, is the model ending on an error echo — not a completed
      // outcome. Treat it as untrustworthy so the model is pushed (bounded)
      // to retry/verify instead of silently accepting the error as the result.
      const errorEchoDone =
        ranToolCalls &&
        !explicitDoneCalled &&
        !claimsArtifactWritten(text, sessionState.changed) &&
        lastToolResultShowsClientError(messages);
      // A final answer that is the last tool result repeated back is not a
      // summary: it satisfies every other check while saying nothing about the
      // work, so it gets the same bounded reprompt as an error echo.
      const toolEchoDone =
        ranToolCalls &&
        !explicitDoneCalled &&
        isToolResultEcho(text, lastToolResultContent(messages));
      const evidenceGaps = objectiveEvidenceGaps(evidenceTask, evidenceTaskType, successfulToolEvidence, { coordinationUnverified });
      const trustworthy =
        (!ranToolCalls || explicitDoneCalled || (unsubstantiated.length === 0 && !errorEchoDone && !toolEchoDone)) &&
        evidenceGaps.length === 0;

      if (!trustworthy && unconfirmedDoneAttempts < MAX_UNCONFIRMED_DONE_ATTEMPTS && i < maxIterations - 1) {
        unconfirmedDoneAttempts++;
        await log.append({
          ...session, actor: "system", type: "completion.claim_rejected",
          payload: { unsubstantiatedClaims: unsubstantiated, objectiveEvidenceGaps: evidenceGaps, attempt: unconfirmedDoneAttempts, ...(errorEchoDone ? { reason: "client_error_echo" } : toolEchoDone ? { reason: "tool_result_echo" } : {}) },
        });

        // Future promises were already rejected by the shared phase gate.
        const content = buildUnconfirmedDonePrompt({
              unsubstantiated,
              evidenceGaps,
              errorEchoDone,
              toolEchoDone,
              attempt: unconfirmedDoneAttempts,
            });

        messages.push({ role: "user", content });
        return "continue";
      }

      const reason: RunResult["reason"] = trustworthy ? "completed" : "completed_unverified";
      await maybeEmitRotRisk({ log, session, threshold: contextRotThreshold, contextPressure: contextPressure.snapshot(), contextBudget, lastInvocationId });
      const failure = latestToolFailure(messages);
      const completionSummary = evidenceGaps.length > 0
        ? missingEvidenceSummary(evidenceGaps, text)
        : toolEchoDone
          ? `The turn ended by repeating a tool result instead of reporting the work: ${text.trim().slice(0, 200)}`
        : text.trim().length > 0
          ? durableCompletionSummary(text, sessionState.changed, failure)
        : failure
          ? `Task could not complete: ${failure}`
          : "Task completed, but the model provided no final synthesis.";
      await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: text.trim().length > 0 ? reason : "completed_unverified", summary: completionSummary, unsubstantiatedClaims: unsubstantiated, objectiveEvidenceGaps: evidenceGaps, ...(contextPressure ? { contextPressure: contextPressure.snapshot() } : {}) } });
      await evaluatePattern(log, session, sessionDir, taskType);
      return { sessionId, summary: completionSummary, streamed: model.streaming, reason: text.trim().length > 0 ? reason : "completed_unverified", contextPressure: contextPressure.snapshot(), ...(lastAgentProse !== undefined ? { lastAgentProse } : {}) };
    }
    // Model didn't signal done, continue
  } else if (!skipReasonNoTools) {
    // Run verification
    const verResults: Array<{ check: VerificationCheck; result: VerificationResult }> = [];
    for (const check of checks) {
      await log.append({ ...session, actor: "verifier", type: "verification.check_started", payload: { command: check.command, reason: check.reason } });
      const verResult = await runVerification(deps.cwd ?? process.cwd(), check);
      await log.append({ ...session, actor: "verifier", type: "verification.check_finished", payload: { command: check.command, status: verResult.status, isolated: verResult.isolated === true } });
      verResults.push({ check, result: verResult });
    }

    const allPassed = verResults.every((vr) => vr.result.status === "passed");

    if (allPassed && modelSaysDone) {
      if (coordinationUnverified) {
        // Verification passed, but the last coordination.run failed — the
        // completed-status contract still applies here: bounded retry, then
        // an honest completed_unverified terminal (never session.ended:completed).
        if (unconfirmedDoneAttempts < MAX_UNCONFIRMED_DONE_ATTEMPTS && i < maxIterations - 1) {
          unconfirmedDoneAttempts++;
          await log.append({
            ...session, actor: "system", type: "completion.claim_rejected",
            payload: { unsubstantiatedClaims: [], objectiveEvidenceGaps: [COORDINATION_EVIDENCE_GAP], attempt: unconfirmedDoneAttempts, source: "coordination_failed" },
          });
          messages.push({
            role: "user",
            content:
              `Your last \`coordination.run\` call failed, so the task cannot be marked complete despite passing verification. ` +
              `Retry \`alix_coordination_run\` with a corrected plan until it succeeds (or, if coordination is no longer needed, ` +
              `do not claim a coordination run succeeded), then confirm completion.`,
          });
          return "continue";
        }
        await maybeEmitRotRisk({ log, session, threshold: contextRotThreshold, contextPressure: contextPressure.snapshot(), contextBudget, lastInvocationId });
        const coordinationFailureSummary = `Task could not be verified as complete: ${COORDINATION_EVIDENCE_GAP} (the last coordination.run failed).`;
        await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "completed_unverified", summary: coordinationFailureSummary, objectiveEvidenceGaps: [COORDINATION_EVIDENCE_GAP], ...(contextPressure ? { contextPressure: contextPressure.snapshot() } : {}) } });
        await evaluatePattern(log, session, sessionDir, taskType);
        return { sessionId, summary: coordinationFailureSummary, streamed: model.streaming, reason: "completed_unverified", contextPressure: contextPressure.snapshot(), ...(lastAgentProse !== undefined ? { lastAgentProse } : {}) };
      }
      // Success — verification passed and model signals done
      await maybeEmitRotRisk({ log, session, threshold: contextRotThreshold, contextPressure: contextPressure.snapshot(), contextBudget, lastInvocationId });
      await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "completed", summary: text, ...(contextPressure ? { contextPressure: contextPressure.snapshot() } : {}) } });

      // Record successful resolution if we have files that were changed
      if (enhancedVerifier && sessionState.changed.size > 0) {
        try {
          await enhancedVerifier.recordFailure({
            task: task,
            errorSummary: "Verification passed",
            fileChanges: [...sessionState.changed],
            resolution: "Applied fix successfully",
          });
          await log.append({ ...session, actor: "system", type: "embedder.resolution_recorded", payload: { fileCount: sessionState.changed.size } });
        } catch (err) {
          await log.append({ ...session, actor: "system", type: "embedder.record_failed", payload: { error: String(err) } });
        }
      }

      await evaluatePattern(log, session, sessionDir, taskType);
      return { sessionId, summary: text, streamed: model.streaming, contextPressure: contextPressure.snapshot(), ...(lastAgentProse !== undefined ? { lastAgentProse } : {}) };
    }

    // Repair loop — verification failed or model didn't signal done
    const failures = verResults.filter((vr) => vr.result.status === "failed");
    const failureText = failures.length > 0
      ? failures.map((f) => `${f.check.command} failed:\n${f.result.output ?? ""}`).join("\n\n")
      : "No tool calls and model did not signal completion.";

    repairCount++;
    if (repairCount > maxRepairs) {
      const { skillFactory } = await import("../../skills/dispatcher.js");
      void skillFactory.process({
        sessionId,
        sessionDir,
        summary: `Repair limit reached: ${failureText}`,
        filesCreated: [...sessionState.created],
        filesChanged: [...sessionState.changed],
        config: config.skills?.factory ?? DEFAULT_FACTORY_CONFIG,
      });
      return await completeSession(session, log, memoryStore, sessionDir, taskType, sessionId, `Repair limit reached: ${failureText}`, model.streaming ?? false, "session.ended", "max_repairs", contextPressure.snapshot(), { threshold: contextRotThreshold, contextBudget, lastInvocationId });
    }

    // Use Fabric-style refine strategy
    const { prompt: refinedPrompt, strategy: usedStrategy } = await buildRefinePrompt(failureText, taskType, repairCount);
    await log.append({ ...session, actor: "system", type: "refine.strategy_applied", payload: { strategy: usedStrategy, repairCount, failureType: selectStrategy(failureText, taskType) } });

    // Get historical suggestions for similar failures
    const historicalSuggestions = enhancedVerifier
      ? await getHistoricalSuggestions(enhancedVerifier, failures, sessionState, session, log)
      : [];

    // Append historical suggestions if available
    let finalPrompt = refinedPrompt;
    if (historicalSuggestions.length > 0) {
      finalPrompt += "\n\n**Similar failures that were resolved:**\n" + historicalSuggestions.join("\n");
    }

    // Update the message with enhanced prompt
    messages.push({ role: "user", content: finalPrompt });
  }
  } finally {
    Object.assign(ctx.state, { repairCount, unconfirmedDoneAttempts, noToolNudges, synthesisRequested, emptySynthesisRetryRequested });
  }
}

/** Completion/repair policy; iteration counters are returned through the shared state. */
export async function runDeferredCompletion(ctx: CompletionContext & { trackCompleted: boolean; trackShellComplete: boolean; shellOutput: string }): Promise<RunResult | "continue" | undefined> {
  ctx.deps.cancellationToken?.throwIfCancelled();
  const { log, session, maxIterations, contextBudget, evidenceTask, evidenceTaskType, successfulToolEvidence, taskType, memoryStore, sessionId, sessionDir, model, contextRotThreshold, contextPressure, lastInvocationId, usedTools, messages, text, i, sessionState, coordinationUnverified, MAX_UNCONFIRMED_DONE_ATTEMPTS, trackCompleted, trackShellComplete, shellOutput } = ctx;
  let { repairCount, unconfirmedDoneAttempts, noToolNudges, synthesisRequested, emptySynthesisRetryRequested } = ctx.state;
  try {
  // ── Deferred completion/auto-complete checks ──────────────────
  // All tool calls in the batch have now executed. Process results
  // that were accumulated during the loop without early returns.
  if (trackCompleted || trackShellComplete) {
    const pending = await gatePendingAgentAction({ text, iteration: i, maxIterations,
      attempts: unconfirmedDoneAttempts, maxAttempts: MAX_UNCONFIRMED_DONE_ATTEMPTS, messages, log, session });
    if (pending) {
      unconfirmedDoneAttempts = pending.attempts;
      if (pending.retry) return "continue";
      return await completeSession(session, log, memoryStore, sessionDir, taskType,
        sessionId, pending.summary, model.streaming ?? false, "session.ended",
        "completed_unverified", contextPressure.snapshot(), { threshold: contextRotThreshold, contextBudget, lastInvocationId });
    }
  }
  if (trackCompleted) {
    // Model explicitly requested completion via a "done" tool or similar.
    // If tools were called but the model's text is short, re-prompt once
    // for a synthesis before closing the session.
    const completedAfterAction = hasExecutedActionTool(usedTools);
    const priorToolFailure = latestToolFailure(messages);
    if (
      completedAfterAction &&
      text.trim().length === 0 &&
      !priorToolFailure &&
      (!synthesisRequested || !emptySynthesisRetryRequested) &&
      i < maxIterations - 1
    ) {
      if (synthesisRequested) emptySynthesisRetryRequested = true;
      synthesisRequested = true;
      messages.push({
        role: "user",
        content:
          "Tools completed. Write a concise summary of what you did and what you found. Return prose only; do not call `alix_done` again.",
      });
      return "continue";
    }

    // Claim check: even when the real `done` tool was called, the model
    // may still have described actions it never executed in its text.
    // Same escalation as the no-tool-call branch (see findUnsubstantiatedClaims).
    const unsubstantiated = findUnsubstantiatedClaims(text, usedTools);
    const evidenceGaps = objectiveEvidenceGaps(evidenceTask, evidenceTaskType, successfulToolEvidence, { coordinationUnverified });
    // An explicit `alix_done` does not make an echoed tool result a summary.
    const echoedToolResult = isToolResultEcho(text, lastToolResultContent(messages));
    if (
      completedAfterAction &&
      echoedToolResult &&
      !priorToolFailure &&
      !synthesisRequested &&
      i < maxIterations - 1
    ) {
      synthesisRequested = true;
      await log.append({
        ...session, actor: "system", type: "completion.claim_rejected",
        payload: { unsubstantiatedClaims: [], objectiveEvidenceGaps: [], attempt: unconfirmedDoneAttempts, reason: "tool_result_echo", source: "trackCompleted" },
      });
      messages.push({
        role: "user",
        content:
          "Your reply repeated a tool result instead of answering. Write the actual completion summary — " +
          "what you did, what you verified, and the outcome — in prose, never the raw tool output.",
      });
      return "continue";
    }
    if ((unsubstantiated.length > 0 || evidenceGaps.length > 0) && unconfirmedDoneAttempts < MAX_UNCONFIRMED_DONE_ATTEMPTS && i < maxIterations - 1) {
      unconfirmedDoneAttempts++;
      await log.append({
        ...session, actor: "system", type: "completion.claim_rejected",
        payload: { unsubstantiatedClaims: unsubstantiated, objectiveEvidenceGaps: evidenceGaps, attempt: unconfirmedDoneAttempts, source: "trackCompleted" },
      });
      const missingToolLines = [...unsubstantiated, ...evidenceGaps]
        .map((c) => `  - ${CLAIM_TOOL_NAMES[c] ?? c}`)
        .join("\n");
      const content = unconfirmedDoneAttempts >= 2
        ? `You called the \`alix_done\` tool but your summary still claims work that was never executed:\n${missingToolLines}\n\n` +
          `Do NOT call \`alix_done\` until every one of these tools has returned a result.`
        : `You called \`alix_done\` but your summary claims work that was never done:\n${missingToolLines}\n\n` +
          `Call these tools now using their \`alix_\` names, or call \`alix_done\` again only once you have genuinely finished.`;
      messages.push({ role: "user", content });
      return "continue";
    }

    const missingSynthesis = completedAfterAction && text.trim().length === 0;
    const reason: RunResult["reason"] =
      unsubstantiated.length === 0 && evidenceGaps.length === 0 && !missingSynthesis && !echoedToolResult
        ? "completed"
        : "completed_unverified";
    const failure = priorToolFailure;
    const completionSummary = evidenceGaps.length > 0
      ? missingEvidenceSummary(evidenceGaps, text)
      : echoedToolResult
        ? `The turn ended by repeating a tool result instead of reporting the work: ${text.trim().slice(0, 200)}`
      : text.trim().length > 0
        ? durableCompletionSummary(text, sessionState.changed, failure)
      : missingSynthesis
        ? failure
          ? `Task could not complete: ${failure}`
          : "Task completed, but the model provided no final synthesis."
        : "Task complete.";
    return await completeSession(
      session, log, memoryStore, sessionDir,
      taskType, sessionId, completionSummary,
      model.streaming ?? false,
      "session.ended", reason,
      contextPressure.snapshot(),
      { threshold: contextRotThreshold, contextBudget, lastInvocationId },
    );
  }

  // If tools were called but the model never produced a real summary
  // (text is just the opening intro / tool calls), force one more
  // iteration so the model synthesizes the tool results into a
  // coherent response before returning. This check must come BEFORE
  // trackShellComplete so read-only tasks also get a synthesis pass.
  const hasToolMessages = messages.some((m) =>
    m.role === "user" && typeof m.content === "string" && m.content.startsWith("<tool_result"),
  );
  if (hasToolMessages && text.length < SHORT_SYNTHESIS_THRESHOLD && i < maxIterations - 1) {
    messages.push({
      role: "user",
      content: buildSynthesisReprompt(usedTools),
    });
    synthesisRequested = true;
    return "continue";
  }

  if (trackShellComplete) {
    return await completeSession(
      session, log, memoryStore, sessionDir,
      taskType, sessionId, shellOutput || text,
      model.streaming ?? false,
      "session.ended", coordinationUnverified ? "completed_unverified" : "completed",
      contextPressure.snapshot(),
      { threshold: contextRotThreshold, contextBudget, lastInvocationId },
    );
  }


  } finally {
    Object.assign(ctx.state, { repairCount, unconfirmedDoneAttempts, noToolNudges, synthesisRequested, emptySynthesisRetryRequested });
  }
}
