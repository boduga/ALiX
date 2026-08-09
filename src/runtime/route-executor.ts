/**
 * route-executor.ts — Task route execution dispatcher.
 *
 * Defines the RuntimeExecutor interface and the executeRoute() dispatcher.
 * Two implementations exist: local (same process) and daemon (Unix socket).
 * The daemon-side executor lives in daemon-server.ts for socket I/O.
 */

import type { TaskRoute, RouteDiagnostic } from "./task-router.js";
import { buildExternalRetrievalPrompt } from "./route-prompts.js";
import { resolveModelConfig } from "../config/model-resolver.js";

/** Re-export RouteDiagnostic so callers can import it from one place. */
export type { RouteDiagnostic } from "./task-router.js";

/** Context shared by all route executors. */
export interface RuntimeContext {
  cwd: string;
  sessionId: string;
  sessionDir: string;
  eventLog: any; // EventLog
  config: any;   // AlixConfig
  approvalStore?: any;
  onStream?: (chunk: any) => void;
  /**
   * Non-persistent diagnostic callback. Fires once per dispatch with the
   * route's `RouteDiagnostic` (when present). Callers that want to surface
   * *why* a prompt routed to direct / grounded_chat / agent wire a hook
   * here. Per the contract:
   *   - callback failures are swallowed
   *   - nothing is persisted
   *   - no events are emitted
   */
  onRouteDiagnostic?: (diagnostic: RouteDiagnostic) => void;
}

/** Interface each execution backend must implement. */
export interface RuntimeExecutor {
  executeDirect(route: TaskRoute & { kind: "direct" }, ctx: RuntimeContext): Promise<string>;
  executeTool(route: TaskRoute & { kind: "tool" }, ctx: RuntimeContext): Promise<string>;
  executeChat(route: TaskRoute & { kind: "chat" }, ctx: RuntimeContext): Promise<string>;
  executeGroundedChat(route: TaskRoute & { kind: "grounded_chat" }, ctx: RuntimeContext): Promise<string>;
  executeAgent(route: TaskRoute & { kind: "agent" }, ctx: RuntimeContext): Promise<string>;
}

/**
 * Forward a route's diagnostic through `ctx.onRouteDiagnostic` if the
 * callback is present. Failures are swallowed — the diagnostic channel
 * is observability, never a control surface.
 */
function forwardDiagnostic(route: TaskRoute, ctx: RuntimeContext): void {
  const diagnostic = "diagnostic" in route ? route.diagnostic : undefined;
  if (!diagnostic || !ctx.onRouteDiagnostic) return;
  try {
    ctx.onRouteDiagnostic(diagnostic);
  } catch {
    // Intentionally swallow — diagnostics must never break dispatch.
  }
}

/** Dispatch a TaskRoute to the correct executor method. */
export async function executeRoute(
  route: TaskRoute,
  ctx: RuntimeContext,
  executor: RuntimeExecutor,
): Promise<string> {
  // Non-persistent diagnostic forwarding happens for every route kind
  // that carries a `diagnostic`. The executor implementations are
  // free to forward their own diagnostics in addition, but the
  // dispatcher is the single canonical place so a missing executor
  // implementation can't silently drop the signal.
  forwardDiagnostic(route, ctx);

  switch (route.kind) {
    case "direct":
      return executor.executeDirect(route, ctx);
    case "tool":
      return executor.executeTool(route, ctx);
    case "chat":
      return executor.executeChat(route, ctx);
    case "grounded_chat":
      return executor.executeGroundedChat(route, ctx);
    case "agent":
      return executor.executeAgent(route, ctx);
  }
}

/** Local (same-process) executor — used by no-daemon TUI and CLI commands. */
export class LocalRuntimeExecutor implements RuntimeExecutor {
  /**
   * Direct execution — no lifecycle, no tools, no artifacts.
   *
   *  - Arithmetic: returns the route's pre-computed `answer` string.
   *  - Standalone generation: one provider call, no tool loop.
   *
   * This method intentionally does **not** import `ToolExecutor` or
   * `runTask`; the direct path must stay free of side-effecting
   * executors so it remains safe to invoke from read-only contexts.
   */
  async executeDirect(route: TaskRoute & { kind: "direct" }, ctx: RuntimeContext): Promise<string> {
    if (route.answer !== undefined) {
      return route.answer;
    }

    const { createProvider } = await import("../providers/registry.js");
    const provider = await createProvider(resolveModelConfig(ctx.config));
    const response = await provider.complete({
      systemPrompt: "You are ALiX, a helpful AI assistant. Answer concisely.",
      messages: [{ role: "user", content: route.prompt }],
      maxOutputTokens: 512,
    });
    return response.text || "(no response)";
  }

  async executeTool(route: TaskRoute & { kind: "tool" }, ctx: RuntimeContext): Promise<string> {
    const { ToolExecutor } = await import("../tools/executor.js");
    const { randomBytes } = await import("node:crypto");

    const executor = new ToolExecutor(ctx.config, ctx.eventLog, ctx.cwd, undefined, undefined, undefined, undefined, ctx.approvalStore);
    const toolCallId = `local_${Date.now()}_${randomBytes(4).toString("hex")}`;

    const result = await executor.execute({
      toolCallId,
      name: route.tool,
      args: route.args,
    });

    if (result.kind === "success") {
      return result.output || result.content || "(tool completed)";
    } else if (result.kind === "denied") {
      const reason = result.reason || "";
      if (reason.includes("approval") || reason.includes("Approval")) {
        const idMatch = reason.match(/(approval_[a-zA-Z0-9_-]+)/);
        const approvalId = idMatch ? idMatch[1] : "";
        let msg = "Approval required.\n\nPending approval:\n";
        msg += `  ${approvalId || reason}\n\n`;
        msg += "Run:\n";
        msg += `  /approve ${approvalId || "<id>"}\n`;
        msg += "or:\n";
        msg += `  /deny ${approvalId || "<id>"}\n`;
        return msg;
      }
      return `Blocked by policy: ${reason}`;
    } else if (result.kind === "error") {
      return `Tool error: ${result.message}`;
    } else {
      return "(unexpected tool result)";
    }
  }

  async executeChat(route: TaskRoute & { kind: "chat" }, ctx: RuntimeContext): Promise<string> {
    const { createProvider } = await import("../providers/registry.js");
    const provider = await createProvider(resolveModelConfig(ctx.config));
    const response = await provider.complete({
      systemPrompt: "You are ALiX, a helpful AI assistant. Answer concisely.",
      messages: [{ role: "user", content: route.prompt }],
      maxOutputTokens: 512,
    });
    return response.text || "(no response)";
  }

  async executeGroundedChat(route: TaskRoute & { kind: "grounded_chat" }, ctx: RuntimeContext): Promise<string> {
    const { createProvider } = await import("../providers/registry.js");
    const { ToolExecutor } = await import("../tools/executor.js");
    const { randomBytes } = await import("node:crypto");

    const provider = await createProvider(resolveModelConfig(ctx.config));
    const executor = new ToolExecutor(ctx.config, ctx.eventLog, ctx.cwd, undefined, undefined, undefined, undefined, ctx.approvalStore);

    // T18 (#395): Layer 3 prompt construction keyed on canonical-intent label.
    // The executor consumes the intent from route.diagnostic.classification
    // — no re-classification of raw prompt text. Defensive default: a route
    // without a diagnostic still executes as external retrieval.
    const intent = route.diagnostic?.classification ?? "external_retrieval";
    const retrievalPrompt = buildExternalRetrievalPrompt(intent);

    // First call: model may issue a tool call for fresh information
    const response = await provider.complete({
      systemPrompt: retrievalPrompt.systemPrompt,
      messages: [{ role: "user", content: retrievalPrompt.userPromptTemplate(route.prompt) }],
      maxOutputTokens: 512,
    });

    if (response.toolCalls.length > 0) {
      if (response.toolCalls.length > 1) {
        return "Grounded chat supports only one tool call at a time.";
      }
      const tc = response.toolCalls[0];

      // Enforce allowedTools allowlist
      if (!route.allowedTools.includes(tc.name)) {
        return `Tool "${tc.name}" is not allowed for this query type.`;
      }

      const toolResult = await executor.execute({
        toolCallId: `local_${Date.now()}_${randomBytes(4).toString("hex")}`,
        name: tc.name,
        args: tc.args,
      });

      const toolContent = toolResult.kind === "success"
        ? (toolResult.output || toolResult.content || "(no output)")
        : toolResult.kind === "error"
          ? `Error: ${toolResult.message}`
          : "Tool request denied by policy";

      // Second call: model synthesizes answer from tool result
      // Tool results are passed as user messages in the normalized format
      const finalResponse = await provider.complete({
        systemPrompt: "Answer the user's question based on the tool result.",
        messages: [
          { role: "user", content: retrievalPrompt.userPromptTemplate(route.prompt) },
          { role: "assistant", content: response.text || "" },
          { role: "user", content: `[Tool result from ${tc.name}]\n${toolContent}` },
        ],
        maxOutputTokens: 512,
      });
      return finalResponse.text || "(no response)";
    }

    // No tool call — model answered directly
    return response.text || "(no response)";
  }

  async executeAgent(route: TaskRoute & { kind: "agent" }, ctx: RuntimeContext): Promise<string> {
    const { runTask } = await import("../agent/agent-loop.js");
    const result = await runTask(ctx.cwd, route.task, {
      sharedSession: {
        sessionId: ctx.sessionId,
        sessionDir: ctx.sessionDir,
        eventLog: ctx.eventLog,
      },
      planMode: false,
      streaming: !!ctx.onStream,
    }, ctx.onStream);
    return result.summary || "(task completed)";
  }
}
