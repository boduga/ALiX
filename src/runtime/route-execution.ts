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
import type { ModelAdapter, ToolDef } from "../providers/types.js";

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
   * Cap on provider output tokens. When unset the field is omitted entirely,
   * so the provider's own default applies. LocalRuntimeExecutor passes 512
   * (its historical cap); the daemon omits it to keep its historical
   * uncapped behavior.
   */
  maxOutputTokens?: number;
  /**
   * When false, a tool denial is rendered as the short `Blocked by policy: …`
   * line instead of the multi-line `/approve` prompt. A daemon socket client
   * cannot act on CLI `/approve` commands, so DaemonRuntimeExecutor opts out.
   */
  renderApprovalPrompt?: boolean;
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
 * Spread `maxOutputTokens` only when an adapter set one. When unset the field
 * is omitted so the provider's own default applies — the daemon's historical
 * uncapped behavior.
 */
function tokenCap(deps: ExecutionDeps): { maxOutputTokens: number } | {} {
  return deps.maxOutputTokens !== undefined ? { maxOutputTokens: deps.maxOutputTokens } : {};
}

/**
 * One provider call with no tool loop — the shared shape behind the direct
 * and chat behaviors.
 */
async function singleProviderCall(
  prompt: string,
  config: any,
  deps: ExecutionDeps,
): Promise<string> {
  const provider = await makeProvider(config, deps);
  const response = await provider.complete({
    systemPrompt: "You are ALiX, a helpful AI assistant. Answer concisely.",
    messages: [{ role: "user", content: prompt }],
    ...tokenCap(deps),
  });
  return response.text || "(no response)";
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
  return singleProviderCall(route.prompt, config, deps);
}

/** Chat route — one provider call, no tool loop. */
export async function executeChatBehavior(
  route: TaskRoute & { kind: "chat" },
  config: any,
  deps: ExecutionDeps = {},
): Promise<string> {
  return singleProviderCall(route.prompt, config, deps);
}

/** Options controlling how a tool outcome is rendered as text. */
export interface RenderToolResultOptions {
  /**
   * When false, a denial is rendered as the short `Blocked by policy: <reason>`
   * line even when the reason names an approval. Local keeps the multi-line
   * `/approve` prompt (its historical UX); the daemon opts out because a
   * socket client cannot act on CLI commands.
   */
  renderApprovalPrompt?: boolean;
}

/** Minimal structural shape of a ToolExecutor outcome (see tools/executor.ts). */
interface ToolOutcome {
  kind: string;
  output?: string;
  content?: string;
  reason?: string;
  message?: string;
}

/**
 * Render a ToolExecutor outcome as the text returned to the caller. Single
 * implementation both adapters share, so the denial/approval text can never
 * diverge between local and daemon.
 */
export function renderToolResult(
  result: ToolOutcome,
  opts: RenderToolResultOptions = {},
): string {
  if (result.kind === "success") {
    return result.output || result.content || "(tool completed)";
  }
  if (result.kind === "denied") {
    const reason = result.reason || "";
    const wantsApprovalPrompt =
      opts.renderApprovalPrompt !== false &&
      (reason.includes("approval") || reason.includes("Approval"));
    if (wantsApprovalPrompt) {
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
  }
  if (result.kind === "error") {
    return `Tool error: ${result.message}`;
  }
  return "(unexpected tool result)";
}

/** Fresh daemon/local tool-call id with the shared `alix_` prefix. */
async function newToolCallId(): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  return `alix_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

/**
 * Build a ToolExecutor for the given deps. Kept behind a dynamic import so the
 * shared route layer never statically pulls in the tool executor, and so the
 * two behaviors that run tools construct it identically.
 */
async function makeToolExecutor(config: any, deps: ToolExecutionDeps): Promise<any> {
  const { ToolExecutor } = await import("../tools/executor.js");
  return new ToolExecutor(
    config,
    deps.eventLog,
    deps.cwd,
    undefined,
    undefined,
    undefined,
    undefined,
    deps.approvalStore,
  );
}

/** Tool route — execute the requested tool and render its result. */
export async function executeToolBehavior(
  route: TaskRoute & { kind: "tool" },
  config: any,
  deps: ToolExecutionDeps,
): Promise<string> {
  const executor = await makeToolExecutor(config, deps);
  const result = await executor.execute({
    toolCallId: await newToolCallId(),
    name: route.tool,
    args: route.args,
  });
  return renderToolResult(result, { renderApprovalPrompt: deps.renderApprovalPrompt });
}

/**
 * Grounded chat — read-only retrieval with an allowlist of web tools, max two
 * provider calls (model → optional tool → synthesis).
 *
 * The allowlist (`route.allowedTools`) is the sole gate on what the model may
 * call. A route that offers only `web_search`/`web_fetch` has no shell
 * capability, and a model that attempts any other tool is rejected with the
 * same message everywhere — this is the single implementation both adapters
 * share, so the allowlist can never diverge between local and daemon.
 *
 * The web tool schemas ARE passed to the provider (via the `tools` field) so
 * the model can actually issue a structured tool call instead of answering
 * from stale training memory.
 */
export async function executeGroundedChatBehavior(
  route: TaskRoute & { kind: "grounded_chat" },
  config: any,
  deps: ToolExecutionDeps,
): Promise<string> {
  const provider = await makeProvider(config, deps);
  const executor = await makeToolExecutor(config, deps);

  // T18 (#395): Layer 3 prompt construction keyed on canonical-intent label.
  // The executor consumes the intent from route.diagnostic.classification
  // — no re-classification of raw prompt text. Defensive default: a route
  // without a diagnostic still executes as external retrieval.
  const intent = route.diagnostic?.classification ?? "external_retrieval";
  const retrievalPrompt = buildExternalRetrievalPrompt(intent);

  // Web tool schemas, filtered to the route's allowlist. Kept behind a
  // dynamic import so the shared route layer never statically pulls in the
  // tool modules.
  const { webSearchTool } = await import("../tools/web-search.js");
  const { webFetchTool } = await import("../tools/web-fetch.js");
  const allowedSet = new Set(route.allowedTools);
  const tools = ([webSearchTool(), webFetchTool()] as ToolDef[])
    .filter((t) => allowedSet.has(t.name));

  // First call: model may issue a tool call for fresh information
  const response = await provider.complete({
    systemPrompt: retrievalPrompt.systemPrompt,
    messages: [{ role: "user", content: retrievalPrompt.userPromptTemplate(route.prompt) }],
    tools: tools.length > 0 ? tools : undefined,
    ...tokenCap(deps),
  });

  if (response.toolCalls.length > 0) {
    if (response.toolCalls.length > 1) {
      return "Grounded chat supports only one tool call at a time.";
    }
    const tc = response.toolCalls[0];

    // Enforce allowedTools allowlist
    if (!allowedSet.has(tc.name)) {
      return `Tool "${tc.name}" is not allowed for this query type.`;
    }

    const toolResult = await executor.execute({
      toolCallId: await newToolCallId(),
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
      ...tokenCap(deps),
    });
    return finalResponse.text || "(no response)";
  }

  // No tool call — model answered directly
  return response.text || "(no response)";
}
