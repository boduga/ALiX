/**
 * route-executor.ts — Task route execution dispatcher.
 *
 * Defines the RuntimeExecutor interface and the executeRoute() dispatcher.
 * Two implementations exist: local (same process) and daemon (Unix socket).
 * The daemon-side executor lives in daemon-server.ts for socket I/O.
 */

import type { TaskRoute } from "./task-router.js";

/** Context shared by all route executors. */
export interface RuntimeContext {
  cwd: string;
  sessionId: string;
  sessionDir: string;
  eventLog: any; // EventLog
  config: any;   // AlixConfig
  approvalStore?: any;
  onStream?: (chunk: any) => void;
}

/** Interface each execution backend must implement. */
export interface RuntimeExecutor {
  executeTool(route: TaskRoute & { kind: "tool" }, ctx: RuntimeContext): Promise<string>;
  executeChat(route: TaskRoute & { kind: "chat" }, ctx: RuntimeContext): Promise<string>;
  executeGroundedChat(route: TaskRoute & { kind: "grounded_chat" }, ctx: RuntimeContext): Promise<string>;
  executeAgent(route: TaskRoute & { kind: "agent" }, ctx: RuntimeContext): Promise<string>;
}

/** Dispatch a TaskRoute to the correct executor method. */
export async function executeRoute(
  route: TaskRoute,
  ctx: RuntimeContext,
  executor: RuntimeExecutor,
): Promise<string> {
  switch (route.kind) {
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
      return result.output ?? result.content ?? "(tool completed)";
    } else if (result.kind === "denied") {
      return `Blocked by policy: ${result.reason}`;
    } else if (result.kind === "error") {
      return `Tool error: ${result.message}`;
    } else {
      return "(unexpected tool result)";
    }
  }

  async executeChat(route: TaskRoute & { kind: "chat" }, ctx: RuntimeContext): Promise<string> {
    const { createProvider } = await import("../providers/registry.js");
    const provider = await createProvider({ provider: ctx.config.model.provider, model: ctx.config.model.name });
    const response = await provider.complete({
      systemPrompt: "You are ALiX, a helpful AI assistant. Answer concisely.",
      messages: [{ role: "user", content: route.prompt }],
    });
    return response.text || "(no response)";
  }

  async executeGroundedChat(route: TaskRoute & { kind: "grounded_chat" }, ctx: RuntimeContext): Promise<string> {
    const { createProvider } = await import("../providers/registry.js");
    const { ToolExecutor } = await import("../tools/executor.js");
    const { randomBytes } = await import("node:crypto");

    const provider = await createProvider({ provider: ctx.config.model.provider, model: ctx.config.model.name });
    const executor = new ToolExecutor(ctx.config, ctx.eventLog, ctx.cwd, undefined, undefined, undefined, undefined, ctx.approvalStore);

    // First call: model may issue a tool call for fresh information
    const response = await provider.complete({
      systemPrompt: "You are ALiX, a helpful AI assistant. If you need current information, use the available tools to search. Answer concisely.",
      messages: [{ role: "user", content: route.prompt }],
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
          { role: "user", content: route.prompt },
          { role: "assistant", content: response.text || "" },
          { role: "user", content: `[Tool result from ${tc.name}]\n${toolContent}` },
        ],
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
