// src/runtime/route-execution.ts
// Single implementations of each task-route execution behavior.
//
// Both RuntimeExecutor adapters (LocalRuntimeExecutor in route-executor.ts and
// DaemonRuntimeExecutor in daemon/daemon-runtime-executor.ts) delegate here, so
// there is exactly ONE implementation of each behavior. Adapter-specific code
// is limited to where the config comes from and where the result goes — not
// the behavior itself.
//
// The direct path stays free of side-effecting executors: these functions load
// `ToolExecutor` / provider registry lazily via dynamic import so the module
// graph of the shared route layer never statically pulls in heavy executors.

import type { TaskRoute } from "./task-router.js";
import { buildExternalRetrievalPrompt } from "./route-prompts.js";
import { resolveModelConfig } from "../config/model-resolver.js";
import type { ModelAdapter } from "../providers/types.js";

/**
 * Environment-specific dependencies an execution behavior needs beyond the
 * route + config. Adapters supply these; the behaviors are blind to where
 * they came from.
 */
export interface ExecutionDeps {
  eventLog?: any; // EventLog
  cwd?: string;
  approvalStore?: any;
  /**
   * Test seam: override provider construction. Defaults to
   * `createProvider(resolveModelConfig(config))`. Production adapters never
   * set this — it exists so a test can hand the shared grounded_chat
   * behavior a provider that returns a tool call (e.g. to pin the
   * allowlist-rejection path without a network call).
   */
  providerFactory?: (config: any) => Promise<ModelAdapter>;
}

/**
 * Dependencies required by behaviors that invoke the ToolExecutor
 * (executeToolBehavior / executeGroundedChatBehavior). Direct and chat need
 * only a provider, so they accept the wider optional `ExecutionDeps`.
 */
export interface ToolExecutionDeps extends ExecutionDeps {
  cwd: string;
  eventLog: any; // EventLog
}

/** Build the provider a behavior will call, honoring the factory seam. */
async function makeProvider(config: any, deps: ExecutionDeps): Promise<ModelAdapter> {
  if (deps.providerFactory) return deps.providerFactory(config);
  const { createProvider } = await import("../providers/registry.js");
  return createProvider(resolveModelConfig(config));
}

/**
 * Direct execution — no lifecycle, no tools, no artifacts.
 *
 *  - Arithmetic: returns the route's pre-computed `answer` string.
 *  - Standalone generation: one provider call, no tool loop.
 */
export async function executeDirectBehavior(
  route: TaskRoute & { kind: "direct" },
  config: any,
  deps: ExecutionDeps = {},
): Promise<string> {
  if (route.answer !== undefined) {
    return route.answer;
  }
  const provider = await makeProvider(config, deps);
  const response = await provider.complete({
    systemPrompt: "You are ALiX, a helpful AI assistant. Answer concisely.",
    messages: [{ role: "user", content: route.prompt }],
    maxOutputTokens: 512,
  });
  return response.text || "(no response)";
}

/** Chat route — one provider call, no tool loop. */
export async function executeChatBehavior(
  route: TaskRoute & { kind: "chat" },
  config: any,
  deps: ExecutionDeps = {},
): Promise<string> {
  const provider = await makeProvider(config, deps);
  const response = await provider.complete({
    systemPrompt: "You are ALiX, a helpful AI assistant. Answer concisely.",
    messages: [{ role: "user", content: route.prompt }],
    maxOutputTokens: 512,
  });
  return response.text || "(no response)";
}

/** Tool route — execute the requested tool and render its result. */
export async function executeToolBehavior(
  route: TaskRoute & { kind: "tool" },
  config: any,
  deps: ToolExecutionDeps,
): Promise<string> {
  const { ToolExecutor } = await import("../tools/executor.js");
  const { randomBytes } = await import("node:crypto");

  const executor = new ToolExecutor(
    config,
    deps.eventLog,
    deps.cwd,
    undefined,
    undefined,
    undefined,
    undefined,
    deps.approvalStore,
  );
  const toolCallId = `alix_${Date.now()}_${randomBytes(4).toString("hex")}`;

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

/**
 * Grounded chat — read-only retrieval with an allowlist of web tools, max two
 * provider calls (model → optional tool → synthesis).
 *
 * The allowlist (`route.allowedTools`) is the sole gate on what the model may
 * call. A route that offers only `web.search`/`web_fetch` has no shell
 * capability, and a model that attempts any other tool is rejected with the
 * same message everywhere — this is the single implementation both adapters
 * share, so the allowlist can never diverge between local and daemon.
 */
export async function executeGroundedChatBehavior(
  route: TaskRoute & { kind: "grounded_chat" },
  config: any,
  deps: ToolExecutionDeps,
): Promise<string> {
  const { ToolExecutor } = await import("../tools/executor.js");
  const { randomBytes } = await import("node:crypto");

  const provider = await makeProvider(config, deps);
  const executor = new ToolExecutor(
    config,
    deps.eventLog,
    deps.cwd,
    undefined,
    undefined,
    undefined,
    undefined,
    deps.approvalStore,
  );

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
      toolCallId: `alix_${Date.now()}_${randomBytes(4).toString("hex")}`,
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
