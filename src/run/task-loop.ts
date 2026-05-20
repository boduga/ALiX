/**
 * Task loop module — extracted from run.ts
 *
 * Contains the main iteration loop that:
 * - Sends requests to the model provider
 * - Handles tool calls
 * - Runs verification checks
 * - Manages the repair loop
 */

import type { ModelAdapter, NormalizedMessage, NormalizedRequest, ToolCall, TokenUsage, ToolDef } from "../providers/types.js";
import type { DeferredToolEntry } from "../mcp/tool-deferral.js";
import type { EventLog } from "../events/event-log.js";
import type { MemoryStore } from "../utils/memory/store.js";
import type { ScopeTracker } from "../autonomy/scope-tracker.js";
import type { TaskStateMachine } from "../autonomy/state-machine.js";
import type { MutationSessionState, RunResult } from "../run.js";
import { recordMutationInSessionState, extractMutationPaths } from "../run.js";
import { buildModelUsageEventPayload } from "../run.js";
import { DEFAULT_FACTORY_CONFIG } from "../skills/dispatcher.js";
import { buildRiskReport, mapFilesToTests } from "../verifier/index.js";
import { shouldRunVerification, discoverVerification, runVerification, type VerificationCheck, type VerificationResult } from "../verifier/verifier.js";
import { streamToResponse } from "./helpers.js";
import { saveDecisionsToMemory } from "./helpers.js";
import {
  handleToolCall,
  handleMcpToolSearch,
  handleScopeExpansion,
  buildScopeDenialMessage,
  buildScopeRejectionSummary,
  type EventHandlerDeps,
} from "./event-handlers.js";

export interface TaskLoopDeps {
  config: {
    model: {
      provider: string;
      name: string;
      streaming: boolean;
    };
    permissions: {
      sessionMode?: "auto" | "ask" | "bypass";
    };
    skills?: {
      factory?: typeof DEFAULT_FACTORY_CONFIG;
    };
  };
  provider: ModelAdapter;
  providerTools: ToolDef[];
  mcpToolIndex: DeferredToolEntry[];
  messages: NormalizedMessage[];
  sessionState: MutationSessionState;
  stateMachine: TaskStateMachine;
  scope: ScopeTracker;
  session: { sessionId: string; actor: "system" };
  log: EventLog;
  executor: import("../tools/executor.js").ToolExecutor;
  mcpDiscovery: import("../mcp/tool-discovery.js").ToolDiscovery;
  selectedTools: { name: string; execName: string }[];
  hooks: {
    pre_task?: { command: string; reason: string }[];
    post_task?: { command: string; reason: string }[];
  };
  maxIterations: number;
  MAX_CONTEXT_TOKENS: number;
  encoding: "cl100k_base" | "o200k_base" | "char4";
  task: string;
  taskType: string;
  memoryStore: MemoryStore;
  sessionId: string;
  sessionDir: string;
  onStream?: (chunk: { type: "text" | "tool_call"; text?: string; toolCall?: ToolCall }) => void;
}

/**
 * Execute the main task loop.
 * This runs the model, handles tool calls, and manages verification.
 */
export async function runTaskLoop(deps: TaskLoopDeps): Promise<RunResult> {
  const {
    config,
    provider,
    providerTools,
    mcpToolIndex,
    sessionState,
    stateMachine,
    scope,
    session,
    log,
    executor,
    mcpDiscovery,
    selectedTools,
    hooks,
    maxIterations,
    MAX_CONTEXT_TOKENS,
    encoding,
    task,
    taskType,
    memoryStore,
    sessionId,
    sessionDir,
    onStream,
  } = deps;

  // Use a mutable variable for messages since we need to reassign during truncation
  let messages = deps.messages;

  let repairCount = 0;
  const maxRepairs = 3;

  for (let i = 0; i < maxIterations; i++) {
    stateMachine.tick(0);

    // Truncate messages if token budget exceeded before streaming/completion
    const msgTokens = messages.reduce(
      (sum, m) => sum + estimateMessageTokens(m, encoding),
      0
    );
    if (msgTokens > MAX_CONTEXT_TOKENS / 2) {
      const { truncateToTokenBudget } = await import("../utils/tokens.js");
      const { kept, dropped } = truncateToTokenBudget(messages, MAX_CONTEXT_TOKENS / 2, encoding);
      if (dropped.length > 0) {
        // Remove all [State] messages before truncation, then re-inject one rolling summary
        messages = messages.filter(m => !String(m.content).startsWith("[Session Digest]"));

        // Build digest from session log — authoritative source of truth
        const logDir = log.path.replace(/\/events\.jsonl$/, "");
        const digest = await buildSessionDigest(logDir);
        if (digest) {
          messages.push({ role: "user", content: digest });
        } else {
          // Fallback to rolling sessionState summary when log isn't available
          const summary = buildStateSummary(sessionState);
          if (summary) messages.push({ role: "user", content: summary });
        }

        messages = [...(kept as NormalizedMessage[])];
        await log.append({ ...session, actor: "system", type: "context.truncated", payload: {
          droppedCount: dropped.length,
          provider: config.model.provider,
          maxTokens: MAX_CONTEXT_TOKENS,
          encoding
        }});
      }
    }

    // Run pre_task hooks at the start of each iteration
    const { runHook } = await import("../hooks/runner.js");
    for (const hook of hooks.pre_task ?? []) {
      await log.append({ ...session, actor: "system", type: "hook.pre_task", payload: { command: hook.command, reason: hook.reason } });
      const result = await runHook(hook, deps.config.model.provider === "test" ? "." : deps.sessionId); // cwd placeholder
      await log.append({ ...session, actor: "system", type: "hook.pre_task", payload: { command: hook.command, passed: result.passed, output: result.output.slice(0, 500) } });
    }

    let text = "";
    let toolCalls: ToolCall[] = [];
    let usage: TokenUsage | undefined;

    const systemPrompt = buildSystemPrompt(encoding, messages);

    if (config.model.streaming && provider.stream) {
      const result = await streamToResponse(provider, {
        systemPrompt,
        messages,
        tools: [...providerTools, ...mcpToolIndex]
      }, { onStream });
      text = result.text;
      toolCalls = result.toolCalls;
      usage = result.usage;
    } else {
      const resp = await provider.complete({
        systemPrompt,
        messages,
        tools: [...providerTools, ...mcpToolIndex]
      });
      text = resp.text ?? "";
      toolCalls = resp.toolCalls ?? [];
      usage = resp.usage;
    }

    if (text.length > 0) {
      await log.append({ ...session, actor: "agent", type: "agent.message", payload: { text } });
    }

    if (usage) {
      await log.append({ ...session, actor: "agent", type: "model.usage", payload: buildModelUsageEventPayload(config.model.provider, config.model.name, usage) });
    }

    if (toolCalls.length === 0) {
      // No tools called — check if model signals completion
      const modelSaysDone = /done|complete|finished|resolved/i.test(text);

      // Run post_task hooks
      for (const hook of hooks.post_task ?? []) {
        await log.append({ ...session, actor: "system", type: "hook.post_task", payload: { command: hook.command, reason: hook.reason } });
        const result = await runHook(hook, ".");
        await log.append({ ...session, actor: "system", type: "hook.post_task", payload: { command: hook.command, passed: result.passed, output: result.output.slice(0, 500) } });
      }

      // Policy check: skip verification in ask mode unless scope is approved
      const scopeApprovedNoTools = !sessionState.pendingScopeExpansion;
      const { skipReason: skipReasonNoTools } = shouldRunVerification(config.permissions.sessionMode ?? "ask", scopeApprovedNoTools);

      if (skipReasonNoTools) {
        await log.append({ ...session, actor: "verifier", type: "verification.skipped", payload: { reason: skipReasonNoTools } });
      }

      // Get verification checks
      const checks = await discoverVerification(".");

      // For docs tasks, skip verification
      if (taskType === "docs" || checks.length === 0) {
        if (modelSaysDone) {
          await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "completed", summary: text } });
          return { sessionId, summary: text, streamed: config.model.streaming };
        }
        // Model didn't signal done, continue
      } else if (!skipReasonNoTools) {
        // Run verification
        const verResults: Array<{ check: VerificationCheck; result: VerificationResult }> = [];
        for (const check of checks) {
          await log.append({ ...session, actor: "verifier", type: "verification.check_started", payload: { command: check.command, reason: check.reason } });
          const verResult = await runVerification(".", check);
          await log.append({ ...session, actor: "verifier", type: "verification.check_finished", payload: { command: check.command, status: verResult.status } });
          verResults.push({ check, result: verResult });
        }

        const allPassed = verResults.every((vr) => vr.result.status === "passed");

        if (allPassed && modelSaysDone) {
          // Success — verification passed and model signals done
          await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "completed", summary: text } });
          return { sessionId, summary: text, streamed: config.model.streaming };
        }

        // Repair loop — verification failed or model didn't signal done
        const failures = verResults.filter((vr) => vr.result.status === "failed");
        const failureText = failures.length > 0
          ? failures.map((f) => `${f.check.command} failed:\n${f.result.output ?? ""}`).join("\n\n")
          : "No tool calls and model did not signal completion.";

        repairCount++;
        if (repairCount > maxRepairs) {
          await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_repairs", summary: `Repair limit reached after ${maxRepairs} attempts` } });
          const sessionEvents = await log.readAll();
          await saveDecisionsToMemory(sessionEvents, memoryStore);
          const { skillFactory } = await import("../skills/dispatcher.js");
          void skillFactory.process({
            sessionId,
            sessionDir,
            summary: `Repair limit reached: ${failureText}`,
            filesCreated: [...sessionState.created],
            filesChanged: [...sessionState.changed],
            config: config.skills?.factory ?? DEFAULT_FACTORY_CONFIG,
          });
          return { sessionId, summary: `Repair limit reached: ${failureText}`, streamed: config.model.streaming };
        }

        const repairPrompt = `\n\n[Verification Result] ${failureText}\n\nRepair the issues above and confirm completion when done.`;
        messages.push({ role: "user", content: repairPrompt });
      }
    } else {
      // Track failed tool names per iteration to prevent spinning
      const failedTools: string[] = [];
      const fatalToolErrors: string[] = [];

      // Prepare event handler dependencies (created once per iteration)
      const eventHandlerDeps: EventHandlerDeps = {
        executor,
        mcpManager: deps.executor as unknown as import("../mcp/manager.js").McpManager,
        mcpDiscovery,
        scope,
        session,
        sessionState,
        log,
        selectedTools,
        mcpToolIndex,
        config,
      };

      // Handle each tool call (model names like alix_file_read → executor names like file.read)
      for (const toolCall of toolCalls) {
        // Handle MCP tool search first
        const mcpSearchResult = await handleMcpToolSearch(toolCall, eventHandlerDeps);
        if (mcpSearchResult.handled && mcpSearchResult.message) {
          messages.push(mcpSearchResult.message);
          continue;
        }

        // Handle scope expansion check
        const scopeResult = await handleScopeExpansion(toolCall, eventHandlerDeps);
        if (scopeResult.handled) {
          if (scopeResult.continue === false) {
            if (scopeResult.denied) {
              const execName = deps.executor?.constructor?.name ?? toolCall.name;
              // Check if we have paths to report denial for
              const pathsToCheck = extractMutationPaths(execName, toolCall.args);
              const deniedPaths = pathsToCheck.filter((path) => scope.checkMutation(path) === "denied");
              if (deniedPaths.length > 0) {
                messages.push(buildScopeDenialMessage(toolCall.id, deniedPaths));
              } else if (process.stdin.isTTY) {
                // Scope was manually denied by user in TTY mode
                messages.push({ role: "user", content: `<tool_result id="${toolCall.id}">\nError: Scope expansion denied. Do NOT attempt to modify these files again.\n</tool_result>` });
              } else {
                // Non-TTY mode - scope was denied, return early
                const summary = buildScopeRejectionSummary(pathsToCheck);
                await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "rejected_scope_expansion", summary } });
                return { sessionId, summary, streamed: config.model.streaming, reason: "rejected_scope_expansion" };
              }
            }
            continue;
          }
          // continue: scope was auto-approved or user approved, fall through to execute
        }

        // Handle tool execution
        const toolResult = await handleToolCall(toolCall, eventHandlerDeps, failedTools, fatalToolErrors);

        if (toolResult.completed) {
          await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "completed", summary: text } });
          const sessionEvents = await log.readAll();
          await saveDecisionsToMemory(sessionEvents, memoryStore);
          return { sessionId, summary: text, streamed: config.model.streaming, reason: "completed" as const };
        }

        if (toolResult.message) {
          messages.push(toolResult.message);
        }
      }

      // Track all file mutations in sessionState
      for (const toolCall of toolCalls) {
        const execName = deps.selectedTools?.find(t => t.name === toolCall.name)?.execName ?? toolCall.name;
        recordMutationInSessionState(sessionState, execName, toolCall.args);
      }
      sessionState.fatalErrors.push(...fatalToolErrors);
      for (const failed of failedTools) {
        if (!fatalToolErrors.includes(failed)) {
          sessionState.fatalErrors.push(failed);
        }
      }

      // After tool calls, run verification every iteration (if policy allows)
      const scopeApproved = !sessionState.pendingScopeExpansion;
      const { skipReason } = shouldRunVerification(config.permissions.sessionMode ?? "ask", scopeApproved);

      if (skipReason) {
        await log.append({ ...session, actor: "verifier", type: "verification.skipped", payload: { reason: skipReason } });
      } else {
        const endChecks = await discoverVerification(".");
        // Supplement with targeted test checks based on changed files
        const changedFiles = [...sessionState.created, ...sessionState.changed];
        if (changedFiles.length > 0) {
          const mappedChecks = mapFilesToTests(".", changedFiles);
          // Deduplicate — avoid running the same command twice
          const existingCmds = new Set(endChecks.map(c => c.command));
          for (const mc of mappedChecks) {
            if (!existingCmds.has(mc.command)) {
              endChecks.push(mc);
            }
          }
        }
        if (endChecks.length > 0 && taskType !== "docs") {
          const endResults: Array<{ check: VerificationCheck; result: VerificationResult }> = [];
          for (const endCheck of endChecks) {
            await log.append({ ...session, actor: "verifier", type: "verification.check_started", payload: { command: endCheck.command, reason: endCheck.reason } });
            const verResult = await runVerification(".", endCheck);
            await log.append({ ...session, actor: "verifier", type: "verification.check_finished", payload: { command: endCheck.command, status: verResult.status } });
            endResults.push({ check: endCheck, result: verResult });
          }

          const riskReport = buildRiskReport(endChecks, endResults);

          const failedChecks = endResults.filter((r) => r.result.status === "failed");
          if (failedChecks.length > 0) {
            repairCount++;
            stateMachine.recordRepair();
            if (repairCount > maxRepairs) {
              await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_repairs", summary: `Repair limit reached after ${maxRepairs} attempts` } });
              const { skillFactory } = await import("../skills/dispatcher.js");
              void skillFactory.process({
                sessionId,
                sessionDir,
                summary: "Repair limit reached",
                filesCreated: [...sessionState.created],
                filesChanged: [...sessionState.changed],
                config: config.skills?.factory ?? DEFAULT_FACTORY_CONFIG,
              });
              return { sessionId, summary: "Repair limit reached", streamed: config.model.streaming };
            }
            const failureText = failedChecks
              .map((f) => `${f.check.command} failed:\n${f.result.output ?? ""}`)
              .join("\n\n");

            const fullPrompt = riskReport
              ? `${failureText}\n\nResidual risk (not verified):\n${riskReport}`
              : failureText;

            const repairPrompt = `\n\n[Verification Failed] ${fullPrompt}\n\nFix the issues and try again.`;
            messages.push({ role: "user", content: repairPrompt });
          }
        }
      }
    }
  }

  // Max iterations reached
  await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_iterations", summary: "Agent reached maximum iterations" } });
  const sessionEvents = await log.readAll();
  await saveDecisionsToMemory(sessionEvents, memoryStore);
  const { skillFactory } = await import("../skills/dispatcher.js");
  void skillFactory.process({
    sessionId,
    sessionDir,
    summary: "Agent reached maximum iterations",
    filesCreated: [...sessionState.created],
    filesChanged: [...sessionState.changed],
    config: config.skills?.factory ?? DEFAULT_FACTORY_CONFIG,
  });
  return { sessionId, summary: "Agent reached maximum iterations", streamed: config.model.streaming };
}

// Helper functions used by the task loop

function estimateMessageTokens(m: NormalizedMessage, encoding: "cl100k_base" | "o200k_base" | "char4"): number {
  const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
  if (encoding === "char4") return Math.ceil(content.length / 4);
  // Rough approximation for token encodings
  return Math.ceil(content.length / 4);
}

async function buildSessionDigest(logDir: string): Promise<string | null> {
  try {
    const { buildSessionDigest: build } = await import("../utils/session-digest.js");
    return await build(logDir);
  } catch {
    return null;
  }
}

function buildStateSummary(state: MutationSessionState): string {
  const parts: string[] = [];
  if (state.created.size) parts.push(`Created: ${[...state.created].join(", ")}`);
  if (state.changed.size) parts.push(`Changed: ${[...state.changed].join(", ")}`);
  if (state.deleted.size) parts.push(`Deleted: ${[...state.deleted].join(", ")}`);
  if (state.fatalErrors.length) parts.push(`FATAL: ${state.fatalErrors.join("; ")}`);
  return parts.length ? `[Session Digest] ${parts.join(". ")}.` : "";
}

function buildSystemPrompt(encoding: "cl100k_base" | "o200k_base" | "char4", messages: NormalizedMessage[]): string {
  // This is a placeholder - the actual system prompt is built in run.ts before calling the loop
  return "You are ALiX, an AI coding agent.";
}