/**
 * Event handlers for the task runner.
 *
 * Extracted from run.ts to handle:
 * - Tool call responses
 * - Approval requests (scope expansion)
 * - Verification results
 */

import { TOOL_NAME_MAP } from "../agents/tool-name-map.js";
import type { NormalizedMessage, ToolCall } from "../providers/types.js";
import type { ScopeTracker } from "../autonomy/scope-tracker.js";
import type { MutationSessionState } from "../run.js";
import { extractMutationPaths } from "../run.js";
import { buildErrorMessage } from "../run.js";
import { ToolDiscovery } from "../mcp/tool-discovery.js";
import { ToolExecutor } from "../tools/executor.js";
import { McpManager } from "../mcp/manager.js";
import { promptUser } from "./helpers.js";
import type { EventLog } from "../events/event-log.js";
import type { VerificationCheck, VerificationResult } from "../verifier/verifier.js";
import { buildRiskReport } from "../verifier/index.js";
import type { DeferredToolEntry } from "../mcp/tool-deferral.js";

export type EventHandlerDeps = {
  executor: ToolExecutor;
  mcpManager: McpManager | null;
  mcpDiscovery: ToolDiscovery | null;
  scope: ScopeTracker;
  session: { sessionId: string; actor: "system" };
  sessionState: MutationSessionState;
  log: EventLog;
  selectedTools: { name: string; execName: string }[];
  mcpToolIndex: DeferredToolEntry[];
  config: { permissions: { sessionMode?: "auto" | "ask" | "bypass" } };
};

/**
 * Handle MCP tool search requests
 */
export async function handleMcpToolSearch(
  toolCall: ToolCall,
  deps: EventHandlerDeps
): Promise<{ handled: boolean; message?: NormalizedMessage }> {
  if (toolCall.name !== "alix_mcp_search_tools" && !TOOL_NAME_MAP[toolCall.name]?.startsWith("mcp.")) {
    return { handled: false };
  }

  const execName = TOOL_NAME_MAP[toolCall.name] ?? toolCall.name;
  if (execName !== "mcp_search_tools") {
    return { handled: false };
  }

  const query = (toolCall.args.query as string) ?? "";
  if (!deps.mcpDiscovery) {
    return { handled: true, message: { role: "assistant", content: "MCP tools are not configured." } };
  }
  const result = await deps.mcpDiscovery.search(query);
  const matchedTools =
    result.kind === "success" && result.output
      ? result.output.split("\n").filter((l) => l.startsWith("  - ")).map((l) => l.slice(5, l.indexOf(":")))
      : [];
  await deps.log.append({
    sessionId: deps.session.sessionId,
    actor: "system",
    type: "mcp.tool_discovered",
    payload: { query, matchedTools },
  });
  const output = result.kind === "success" ? result.output ?? "" : result.message;

  return {
    handled: true,
    message: { role: "user", content: `[Tool Result]\n${output}` },
  };
}

/**
 * Handle scope expansion requests for files outside initial scope
 */
export async function handleScopeExpansion(
  toolCall: ToolCall,
  deps: EventHandlerDeps
): Promise<{ handled: boolean; continue?: boolean; denied?: boolean }> {
  const execName = TOOL_NAME_MAP[toolCall.name] ?? toolCall.name;
  const isMutation =
    execName === "file.create" ||
    execName === "file.write" ||
    execName === "file.delete" ||
    execName === "patch.apply";

  if (!isMutation) {
    return { handled: false };
  }

  const pathsToCheck = extractMutationPaths(execName, toolCall.args);
  const deniedPaths = pathsToCheck.filter((path: string) => deps.scope.checkMutation(path) === "denied");

  if (deniedPaths.length > 0) {
    await deps.log.append({
      ...deps.session,
      actor: "policy",
      type: "autonomy.scope_denied",
      payload: { paths: deniedPaths, toolCallId: toolCall.id, toolName: execName },
    });
    return {
      handled: true,
      continue: false,
      denied: true,
    };
  }

  const expansionPaths = pathsToCheck.filter((path: string) => deps.scope.checkMutation(path) === "scope_expansion");

  if (expansionPaths.length === 0) {
    return { handled: false };
  }

  // Track that scope expansion is pending
  deps.sessionState.pendingScopeExpansion = true;
  await deps.log.append({
    ...deps.session,
    actor: "policy",
    type: "autonomy.scope_expansion",
    payload: { paths: expansionPaths, toolCallId: toolCall.id, toolName: execName },
  });

  // In auto/bypass mode, auto-approve scope expansion immediately
  if (deps.config.permissions.sessionMode === "auto" || deps.config.permissions.sessionMode === "bypass") {
    for (const path of expansionPaths) {
      deps.scope.approveScope(path);
    }
    deps.sessionState.pendingScopeExpansion = false;
    await deps.log.append({
      ...deps.session,
      actor: "policy",
      type: "autonomy.scope_auto_approved",
      payload: { paths: expansionPaths, mode: deps.config.permissions.sessionMode },
    });
    return { handled: true, continue: true };
  }

  if (process.stdin.isTTY) {
    const answer = await promptUser(
      `Scope expansion: ${expansionPaths.map((path: string) => `"${path}"`).join(", ")} outside the initial scope. Type "approve" to allow or "deny" to block: `
    );
    await deps.log.append({
      ...deps.session,
      actor: "user",
      type: "autonomy.scope_approval",
      payload: { answer, paths: expansionPaths },
    });

    if (answer.toLowerCase() === "approve") {
      for (const path of expansionPaths) {
        deps.scope.approveScope(path);
      }
      deps.sessionState.pendingScopeExpansion = false;
      await deps.log.append({
        ...deps.session,
        actor: "policy",
        type: "autonomy.scope_approved",
        payload: { paths: expansionPaths },
      });
      return { handled: true, continue: true };
    } else {
      for (const path of expansionPaths) {
        deps.scope.denyScope(path);
      }
      await deps.log.append({
        ...deps.session,
        actor: "policy",
        type: "autonomy.scope_denied",
        payload: { paths: expansionPaths },
      });
      return { handled: true, continue: false, denied: true };
    }
  }

  // Non-TTY ask mode cannot prompt. Persist denial and fail fast.
  for (const path of expansionPaths) {
    deps.scope.setPending(path);
    deps.scope.denyScope(path);
  }
  await deps.log.append({
    ...deps.session,
    actor: "policy",
    type: "autonomy.scope_skipped",
    payload: { reason: "non_tty_session", paths: expansionPaths },
  });
  await deps.log.append({
    ...deps.session,
    actor: "policy",
    type: "autonomy.scope_denied",
    payload: { paths: expansionPaths },
  });

  return { handled: true, continue: false, denied: true };
}

/**
 * Build scope denial message for tool result
 */
export function buildScopeDenialMessage(toolCallId: string, deniedPaths: string[]): NormalizedMessage {
  return {
    role: "user",
    content: `<tool_result id="${toolCallId}">\nError: These files were denied by the user: ${deniedPaths.join(", ")}. Do NOT attempt to modify them again.\n</tool_result>`,
  };
}

/**
 * Build scope rejection summary for session
 */
export function buildScopeRejectionSummary(expansionPaths: string[]): string {
  return `Scope expansion rejected in non-TTY ask mode for: ${expansionPaths.join(", ")}`;
}

/**
 * Handle a single tool call execution and return result
 */
export async function handleToolCall(
  toolCall: ToolCall,
  deps: EventHandlerDeps,
  failedTools: string[],
  fatalToolErrors: string[]
): Promise<{
  message?: NormalizedMessage;
  continue?: boolean;
  completed?: boolean;
  summary?: string;
}> {
  const execName = TOOL_NAME_MAP[toolCall.name] ?? toolCall.name;

  const execResult = await deps.executor.execute({ toolCallId: toolCall.id, name: execName, args: toolCall.args });

  // Track MCP tool provenance
  if (execResult.kind === "success" && execName.startsWith("mcp.")) {
    const mcpName = toolCall.name;
    await deps.log.append({
      sessionId: deps.session.sessionId,
      actor: "system",
      type: "mcp.tool_used",
      payload: {
        toolName: mcpName,
        execName,
        sessionToolsTotal: deps.mcpToolIndex.length,
        sessionToolsSelected: deps.selectedTools.length,
      },
    });
  }

  if (execResult.kind === "error") {
    failedTools.push(execName);
    if ((execResult as { retryable?: boolean }).retryable === false) {
      fatalToolErrors.push(execName);
    }
  }

  const resultContent =
    execResult.kind === "success"
      ? (execResult.output ?? execResult.content ?? "")
      : buildErrorMessage(execResult as { kind: "error"; message: string; retryable?: boolean; hint?: string });

  if (execResult.kind === "success" && (execResult as { completed?: boolean }).completed) {
    return {
      continue: true,
      completed: true,
    };
  }

  return {
    message: { role: "user", content: `<tool_result id="${toolCall.id}">\n${resultContent}\n</tool_result>` },
  };
}

/**
 * Handle verification results after tool calls
 */
export async function handleVerificationResults(
  endChecks: VerificationCheck[],
  endResults: Array<{ check: VerificationCheck; result: VerificationResult }>,
  deps: EventHandlerDeps
): Promise<{
  repairNeeded: boolean;
  repairPrompt?: string;
  maxRepairsReached?: boolean;
}> {
  const failedChecks = endResults.filter((r) => r.result.status === "failed");

  if (failedChecks.length > 0) {
    const failureText = failedChecks
      .map((f) => `${f.check.command} failed:\n${f.result.output ?? ""}`)
      .join("\n\n");

    const riskReport = buildRiskReport(endChecks, endResults);
    const fullPrompt = riskReport
      ? `${failureText}\n\nResidual risk (not verified):\n${riskReport}`
      : failureText;

    return {
      repairNeeded: true,
      repairPrompt: `\n\n[Verification Failed] ${fullPrompt}\n\nFix the issues and try again.`,
    };
  }

  return { repairNeeded: false };
}
