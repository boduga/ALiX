/**
 * Task loop module — extracted from run.ts
 *
 * Contains the main iteration loop that:
 * - Sends requests to the model provider
 * - Handles tool calls
 * - Runs verification checks
 * - Manages the repair loop
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelAdapter, NormalizedMessage, NormalizedRequest, ToolCall, TokenUsage, ToolDef } from "../providers/types.js";
import type { DeferredToolEntry } from "../mcp/tool-deferral.js";
import type { EventLog } from "../events/event-log.js";
import type { MemoryStore } from "../utils/memory/store.js";
import type { ExecutionContext } from "../observability/execution-context.js";
import type { ScopeTracker } from "../autonomy/scope-tracker.js";
import type { TaskStateMachine } from "../autonomy/state-machine.js";
import type { TaskType } from "../task-classifier.js";
import type { MutationSessionState, RunResult } from "../run.js";
import { recordMutationInSessionState, extractMutationPaths } from "../run.js";
import { buildModelUsageEventPayload } from "../run.js";
import { DEFAULT_FACTORY_CONFIG } from "../skills/dispatcher.js";
import { buildRiskReport, mapFilesToTests } from "../verifier/index.js";
import { shouldRunVerification, discoverVerification, runVerification, type VerificationCheck, type VerificationResult } from "../verifier/verifier.js";
import { EnhancedVerifier } from "../verifier/enhanced-verifier.js";
import { streamToResponse } from "./helpers.js";
import { saveDecisionsToMemory } from "./helpers.js";
import { saveSessionState } from "../session/index.js";
import { buildRefinePrompt, selectStrategy } from "../orchestrator/refine-strategies.js";
import {
  handleToolCall,
  handleMcpToolSearch,
  handleScopeExpansion,
  buildScopeDenialMessage,
  buildScopeRejectionSummary,
  type EventHandlerDeps,
} from "./event-handlers.js";

function extractErrors(output: string): string[] {
  const errors: string[] = [];
  const patterns = [
/TypeError:\s*(.+)/gi,
/Error:\s*(.+)/gi,
/SyntaxError:\s*(.+)/gi,
/ReferenceError:\s*(.+)/gi,
/AssertionError:\s*(.+)/gi,
/(?:FAIL|FAILURE|ERROR):\s*(.+)/gi,
/Failed:\s*(.+)/gi,
  ];

  for (const pattern of patterns) {
let match;
while ((match = pattern.exec(output)) !== null) {
  errors.push(match[1]?.trim() ?? match[0]);
}
  }

  return [...new Set(errors)];
}

async function getHistoricalSuggestions(
  enhancedVerifier: EnhancedVerifier,
  failures: Array<{ result: { output?: string } }>,
  sessionState: { changed: Set<string> },
  session: { actor: string; sessionId: string },
  log: EventLog
): Promise<string[]> {
  const failedErrors = failures.flatMap(f => extractErrors(f.result.output ?? ""));
  const failedFiles = [...sessionState.changed];

  const suggestions = await enhancedVerifier.suggestFixes({
errors: failedErrors,
files: failedFiles,
  });

  if (suggestions.length > 0) {
await log.append({ ...session, actor: "system", type: "embedder.suggestions_found", payload: { count: suggestions.length } });
return suggestions.map(s => `  - [${(s.confidence * 100).toFixed(0)}%] ${s.resolution}`);
  }

  return [];
}

const RESEARCH_LIMITS = {
  quick: { maxIterations: 3, maxSearchCalls: 3 },
  deep: { maxIterations: 15, maxSearchCalls: 10 },
} as const;

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
  mcpDiscovery: import("../mcp/tool-discovery.js").ToolDiscovery | null;
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
  depth: "quick" | "deep";
  readOnly?: boolean;
  shellTask?: boolean;
  embedderDbPath?: string;
  memoryStore: MemoryStore;
  sessionId: string;
  sessionDir: string;
  systemPrompt: string;
  onStream?: (chunk: { type: "text" | "tool_call"; text?: string; toolCall?: ToolCall }) => void;
  hookRunner?: import("../extensions/hook-runner.js").HookRunner;
  context?: ExecutionContext;
  /** When true (default), tool outputs are streamed to stdout. */
  verbose?: boolean;
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
depth,
memoryStore,
sessionId,
sessionDir,
systemPrompt,
onStream,
  } = deps;

  // Initialize EnhancedVerifier for historical failure matching
  const embedderDbPath = deps.embedderDbPath ?? join(homedir(), ".alix", "failures.db");
  let enhancedVerifier: EnhancedVerifier | null = null;

  try {
enhancedVerifier = new EnhancedVerifier({
  cwd: ".",
  embedderDb: embedderDbPath,
});
await enhancedVerifier.init();
await log.append({ ...session, actor: "system", type: "embedder.initialized", payload: { dbPath: embedderDbPath } });
  } catch (err) {
await log.append({ ...session, actor: "system", type: "embedder.init_failed", payload: { error: String(err) } });
  }

  try {
// Track search calls for research tasks
let searchCalls = 0;

// Use a mutable variable for messages since we need to reassign during truncation
let messages = deps.messages;

let repairCount = 0;
const maxRepairs = 3;

// Track last saved message count for incremental persistence
let lastSavedMessages = 0;

// Get the McpManager from executor (executor holds a reference)
const mcpManager = executor as unknown as import("../mcp/manager.js").McpManager;

for (let i = 0; i < maxIterations; i++) {
stateMachine.tick(0);

// Track if any mutations occurred in this iteration
const hasMutations = sessionState.created.size > 0 || sessionState.changed.size > 0 || sessionState.deleted.size > 0;

// Truncate messages if token budget exceeded before streaming/completion
const msgTokens = messages.reduce(
  (sum, m) => sum + estimateMessageTokens(m),
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
  const result = await runHook(hook, deps.sessionId);
  await log.append({ ...session, actor: "system", type: "hook.pre_task", payload: { command: hook.command, passed: result.passed, output: result.output.slice(0, 500) } });
}

let text = "";
let toolCalls: ToolCall[] = [];
let usage: TokenUsage | undefined;

if (config.model.streaming && provider.stream) {
  const result = await streamToResponse(provider, {
    systemPrompt,
    messages,
    tools: [...providerTools, ...mcpToolIndex],
    context: deps.context,
  }, { onStream });
  text = result.text;
  toolCalls = result.toolCalls;
  usage = result.usage;
} else {
  const resp = await provider.complete({
    systemPrompt,
    messages,
    tools: [...providerTools, ...mcpToolIndex],
    context: deps.context,
  });
  text = resp.text ?? "";
  toolCalls = resp.toolCalls ?? [];
  usage = resp.usage;
}

if (text.length > 0) {
  await log.append({ ...session, actor: "agent", type: "agent.message", payload: { text } });
}

// Emit model call metric for every call regardless of usage data
await log.append({
  ...session, actor: "system", type: "m09.metric",
  payload: { name: "model_calls_total", type: "counter", value: 1, labels: { provider: config.model.provider }, timestamp: new Date().toISOString() },
});

if (usage) {
  await log.append({ ...session, actor: "agent", type: "model.usage", payload: buildModelUsageEventPayload(config.model.provider, config.model.name, usage) });
}

// Emit reasoning trail
if (text && text.length > 0) {
  await log.append({
    ...session,
    actor: "agent",
    type: "agent.reasoning",
    payload: {
      text: text.slice(0, 500),
      toolCalls: toolCalls.map(tc => tc.name),
      iteration: i,
    },
  });
}

// Emit decision for tool selection
if (toolCalls.length > 0) {
  await log.append({
    ...session, actor: "agent", type: "agent.decision",
    payload: { kind: "tool_selection", iteration: i,
      description: `Called ${toolCalls.map(t => t.name).join(", ")}`,
      outcome: "executed",
    },
  });
}

if (toolCalls.length === 0) {
  // No tools called — check if model signals completion
  const modelSaysDone = /done|complete|finished|resolved/i.test(text);

  // Run post_task hooks
  for (const hook of hooks.post_task ?? []) {
    await log.append({ ...session, actor: "system", type: "hook.post_task", payload: { command: hook.command, reason: hook.reason } });
    const result = await runHook(hook, deps.sessionId);
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

  // For docs and research tasks, skip verification
  // Also skip if no file mutations occurred (nothing to verify)
  if (taskType === "docs" || taskType === "research" || !hasMutations || checks.length === 0) {
    // Check research-specific limits
    if (taskType === "research") {
      const limits = RESEARCH_LIMITS[depth];
      if (searchCalls >= limits.maxSearchCalls) {
        await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_search_calls", summary: `Research reached limit of ${searchCalls} search calls` } });
        await evaluatePattern(log, session, sessionDir, taskType);
        return { sessionId, summary: text || "Research completed (max search calls)", streamed: config.model.streaming };
      }
      if (i >= limits.maxIterations) {
        await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_iterations", summary: `Research reached limit of ${limits.maxIterations} iterations` } });
        await evaluatePattern(log, session, sessionDir, taskType);
        return { sessionId, summary: text || "Research completed (max iterations)", streamed: config.model.streaming };
      }
    }
    if (modelSaysDone) {
      await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "completed", summary: text } });
      await evaluatePattern(log, session, sessionDir, taskType);
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
      await evaluatePattern(log, session, sessionDir, taskType);
      return { sessionId, summary: `Repair limit reached: ${failureText}`, streamed: config.model.streaming };
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
} else {
  // Track failed tool names per iteration to prevent spinning
  const failedTools: string[] = [];
  const fatalToolErrors: string[] = [];

  // Prepare event handler dependencies (created once per iteration)
  const eventHandlerDeps: EventHandlerDeps = {
    executor,
    mcpManager,
    mcpDiscovery,
    scope,
    session,
    sessionState,
    log,
    selectedTools,
    mcpToolIndex,
    config,
    verbose: deps.verbose ?? true, // Stream tool outputs to stdout
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
          // Emit decision for scope expansion denial
          await log.append({
            ...session, actor: "agent", type: "agent.decision",
            payload: { kind: "scope_expansion", iteration: i,
              description: `Scope expansion denied for file changes`,
              outcome: "rejected",
            },
          });
          const execName = selectedTools.find(t => t.name === toolCall.name)?.execName ?? toolCall.name;
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

    // Run registered hooks before tool execution
    if (deps.hookRunner) {
      const execName = selectedTools.find(t => t.name === toolCall.name)?.execName ?? toolCall.name;
      const hr = await deps.hookRunner.execute("on_pre_tool", { type: "tool_call", data: { toolName: execName, args: toolCall.args } });
      if (hr.handled) await log.append({ ...session, actor: "system", type: "hook.executed", payload: { hookName: "on_pre_tool", toolName: execName } });
    }

    // Handle tool execution
    const toolResult = await handleToolCall(toolCall, eventHandlerDeps, failedTools, fatalToolErrors);

    // Run registered hooks after tool execution
    if (deps.hookRunner) {
      const execName = selectedTools.find(t => t.name === toolCall.name)?.execName ?? toolCall.name;
      const hr = await deps.hookRunner.execute("on_post_tool", { type: "tool_result", data: { toolName: execName, args: toolCall.args, result: toolResult } });
      if (hr.handled) await log.append({ ...session, actor: "system", type: "hook.executed", payload: { hookName: "on_post_tool", toolName: execName } });
    }

    // Fire on_tool_error hook when tool fails
    if (deps.hookRunner && toolResult.error) {
      const execName = selectedTools.find(t => t.name === toolCall.name)?.execName ?? toolCall.name;
      const hr = await deps.hookRunner.execute("on_tool_error", {
        type: "tool_error",
        data: {
          toolName: execName,
          args: toolCall.args,
          error: toolResult.error.message,
          retryable: toolResult.error.retryable,
        },
      });
      if (hr.handled) {
        await log.append({
          ...session,
          actor: "system",
          type: "hook.executed",
          payload: { hookName: "on_tool_error", toolName: execName, handled: true },
        });
        // Inject repair hint into the message the model will see
        if (hr.reason && toolResult.message?.content) {
          const content = toolResult.message.content;
          if (typeof content === "string") {
            toolResult.message.content = content.replace(
              "</tool_result>",
              `\n<tool_repair_hint>\n${hr.reason}\n</tool_repair_hint>\n</tool_result>`
            );
          }
        }
      }
    }

    if (toolResult.completed) {
      await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "completed", summary: text } });
      const sessionEvents = await log.readAll();
      await saveDecisionsToMemory(sessionEvents, memoryStore);
      await evaluatePattern(log, session, sessionDir, taskType);
      return { sessionId, summary: text, streamed: config.model.streaming, reason: "completed" as const };
    }

    if (toolResult.message) {
      messages.push(toolResult.message);
    }

    // Auto-complete for shell tasks and read-only mode after a successful tool call
    if ((deps.shellTask || deps.readOnly) && !toolResult.completed && !toolResult.continue) {
      // Extract clean output from tool result message (strip XML tags)
      const raw = typeof toolResult.message?.content === "string" ? toolResult.message.content : "";
      const output = raw.replace(/<[^>]+>/g, "").trim();
      await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "completed", summary: output || text } });
      const sessionEvents = await log.readAll();
      await saveDecisionsToMemory(sessionEvents, memoryStore);
      await evaluatePattern(log, session, sessionDir, taskType);
      return { sessionId, summary: output || text, streamed: config.model.streaming };
    }

    // Track search calls for research tasks (any tool call counts as research activity)
    if (taskType === "research") {
      searchCalls++;
    }
  }

  // Track all file mutations in sessionState
  for (const toolCall of toolCalls) {
    const execName = selectedTools.find(t => t.name === toolCall.name)?.execName ?? toolCall.name;
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
    const changedFiles = [...sessionState.created, ...sessionState.changed];
    if (changedFiles.length > 0 && taskType !== "docs" && taskType !== "research" && hasMutations) {
      // Use TestPlanner for smart verification selection
      const { createTestPlan } = await import("../verifier/test-planner.js");

      const plan = await createTestPlan(".", changedFiles);

      await log.append({ ...session, actor: "verifier", type: "verification.plan_created", payload: {
        strategy: plan.strategy,
        totalCost: plan.totalCost,
        checkCount: plan.checks.length,
        verifiedFiles: plan.verifiedFiles,
        unverifiedFiles: plan.unverifiedFiles,
      }});

      const endResults: Array<{ check: VerificationCheck; result: VerificationResult }> = [];

      // Run checks in cost order
      for (const endCheck of plan.checks) {
        await log.append({ ...session, actor: "verifier", type: "verification.check_started", payload: { command: endCheck.command, reason: endCheck.reason } });
        const verResult = await runVerification(".", endCheck);
        await log.append({ ...session, actor: "verifier", type: "verification.check_finished", payload: { command: endCheck.command, status: verResult.status } });
        endResults.push({ check: endCheck, result: verResult });
      }

      const riskReport = buildRiskReport(plan.checks, endResults);

      const failedChecks = endResults.filter((r) => r.result.status === "failed");
      if (failedChecks.length > 0) {
        repairCount++;
        // Emit decision for repair
        await log.append({
          ...session, actor: "agent", type: "agent.decision",
          payload: { kind: "repair", iteration: i,
            description: `Entering repair loop (attempt ${repairCount}/${maxRepairs})`,
            outcome: "executed",
          },
        });
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
          await evaluatePattern(log, session, sessionDir, taskType);
          return { sessionId, summary: "Repair limit reached", streamed: config.model.streaming };
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
}

  // Persist session state at the end of each iteration for crash resilience
  try {
    await saveSessionState(
      sessionDir,
      {
        messages,
        scope: scope.toJSON(),
        stateMachine: stateMachine.toJSON(),
      }
    );
    lastSavedMessages = messages.length;
  } catch (saveErr) {
    // Non-fatal — session state is best-effort
    await log.append({ ...session, actor: "system", type: "session.state_persist_failed", payload: { error: String(saveErr) } });
  }
  }

  // Max iterations reached
  await log.append({
...session, actor: "agent", type: "agent.decision",
payload: { kind: "completion", iteration: maxIterations,
  description: `Reached maximum iterations (${maxIterations})`,
  outcome: "accepted",
},
  });
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
  await evaluatePattern(log, session, sessionDir, taskType);
  return {
    sessionId,
    summary: "Agent reached maximum iterations",
    streamed: config.model.streaming,
    reason: "max_iterations",
  };
  } finally {
// Cleanup EnhancedVerifier
if (enhancedVerifier) {
  try {
    await enhancedVerifier.close();
  } catch (err) {
    await log.append({ ...session, actor: "system", type: "embedder.close_failed", payload: { error: String(err) } });
  }
}
  }
}

// Helper functions used by the task loop

/**
 * Estimates token count for a message using character-based approximation.
 * For production use, replace with tiktoken or similar library.
 */
function estimateMessageTokens(m: NormalizedMessage): number {
  const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
  return Math.ceil(content.length / 4);
}

/**
 * Builds a session digest from the event log directory.
 * Returns null if digest generation fails.
 */
async function buildSessionDigest(logDir: string): Promise<string | null> {
  try {
const { buildSessionDigest: build } = await import("../utils/session-digest.js");
return await build(logDir);
  } catch {
return null;
  }
}

/**
 * Builds a summary string of files created, changed, and deleted in this session.
 */
function buildStateSummary(state: MutationSessionState): string {
  const parts: string[] = [];
  if (state.created.size) parts.push(`Created: ${[...state.created].join(", ")}`);
  if (state.changed.size) parts.push(`Changed: ${[...state.changed].join(", ")}`);
  if (state.deleted.size) parts.push(`Deleted: ${[...state.deleted].join(", ")}`);
  if (state.fatalErrors.length) parts.push(`FATAL: ${state.fatalErrors.join("; ")}`);
  return parts.length ? `[Session Digest] ${parts.join(". ")}.` : "";
}

/**
 * Evaluates the pattern for the completed task and records the outcome.
 * Uses the pattern registry to track which context selection strategies work best.
 */
async function evaluatePattern(
  log: EventLog,
  session: { sessionId: string; actor: "system" },
  sessionDir: string,
  taskType: string
): Promise<void> {
  try {
const { extractSessionOutcome } = await import("../context/session-outcome.js");
const { PatternRegistry } = await import("../context/pattern-registry.js");

const patternsDir = join(sessionDir, "..", ".alix", "patterns");
const registry = new PatternRegistry(patternsDir);

const outcome = await extractSessionOutcome(sessionDir);
await registry.recordOutcome(taskType as TaskType, {
  success: outcome.success,
  iterations: outcome.iterations,
  totalTokens: outcome.totalTokens,
});

await log.append({
  sessionId: session.sessionId,
  actor: "system",
  type: "context.pattern_evaluated",
  payload: {
    taskType,
    success: outcome.success,
    iterations: outcome.iterations,
    tokenUsage: outcome.totalTokens,
  },
});
  } catch {
// Pattern evaluation is best-effort - don't fail the task loop
  }
}