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
import { createModelResolver } from "../config/model-resolver.js";
import { ALIX_EXECUTOR_TO_MODEL_FACING } from "../agents/tool-manifest.js";
import { resolveExecutableToolName } from "../agents/tool-name-resolver.js";
import type { ModelAdapter, ToolDef } from "../providers/types.js";
import type { ExecutionContext } from "../observability/execution-context.js";

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
   * Run identity for provider/tool spans. When set, the grounded-chat model
   * calls carry `context.runId` so their spans resolve via getRun, and the
   * tool call threads `runId` for its tool span (R1/R2, design §18/§21).
   * Omitted when the caller has no run root (daemon socket path keeps its
   * no-runId behavior).
   */
  context?: ExecutionContext;
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
   * `createProvider(createModelResolver(config).require())`. Production adapters never
   * set this — it exists so a test can hand the shared grounded_chat
   * behavior a provider that returns a tool call (e.g. to pin the
   * allowlist-rejection path without a network call).
   */
  providerFactory?: (config: any) => Promise<ModelAdapter>;
  /**
   * Test seam: override tool-executor construction, mirroring
   * `providerFactory`. Production adapters never set this; without it a test of
   * a behavior's own logic (tool choice, observation) would have to stand up a
   * real `ToolExecutor` and the session directory it expects.
   */
  toolExecutorFactory?: (config: any, deps: ToolExecutionDeps) => Promise<unknown>;
  signal?: AbortSignal;
}

/**
 * Dependencies required by behaviors that invoke the ToolExecutor
 * (executeToolBehavior / executeGroundedChatBehavior). Direct and chat need
 * only a provider, so they accept the wider optional `ExecutionDeps`.
 */
export interface ToolExecutionDeps extends ExecutionDeps {
  cwd: string;
  eventLog: any; // EventLog
  /**
   * Internal executor ids on the grounded route → the model-facing candidate
   * names the rest of ALiX uses. The route now offers `alix_web_search` /
   * `alix_web_fetch` to the provider (it used to offer the executor ids
   * directly, which meant an executor id could reach execution), and resolves
   * the model's call back to the executor id before dispatch. The task loop
   * freezes `builtin:alix_web_search` / `builtin:alix_web_fetch`. Without this
   * normalisation the same tool would land in two different candidate key
   * spaces and no actual-vs-Jev comparison could be formed across the paths.
   */
  toolCandidateAliases?: Record<string, string>;
  /**
   * Identity for the selection scope this route may produce. The caller owns
   * the scope id; the route supplies only the facts it uniquely has (the exact
   * tools it offered, the choice the model made, and how that choice turned
   * out). Absent means this caller does not observe selections.
   */
  selectionScope?: {
    scopeId: string;
    iteration: number;
    sessionId: string;
  };
}

/** Build the provider a behavior will call, honoring the factory seam. */
async function makeProvider(config: any, deps: ExecutionDeps): Promise<ModelAdapter> {
  if (deps.providerFactory) return deps.providerFactory(config);
  const { createProvider } = await import("../providers/registry.js");
  return createProvider(createModelResolver(config).require());
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
    ...(deps.context ? { context: deps.context } : {}),
  }, { signal: deps.signal });
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
  /** Pending approval id, present on approval-gated denials. */
  approvalId?: string;
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
      // Prefer the structured approvals field; fall back to carving it out of
      // the reason, which keeps hand-constructed denials rendering the same.
      const approvalId =
        result.approvalId ??
        reason.match(/(approval_[a-zA-Z0-9_-]+)/)?.[1] ??
        "";
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
  if (deps.toolExecutorFactory) return deps.toolExecutorFactory(config, deps);
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
    signal: deps.signal,
  });
  return renderToolResult(result, { renderApprovalPrompt: deps.renderApprovalPrompt });
}

/**
 * Grounded chat — read-only retrieval with an allowlist of web tools, max two
 * provider calls (model → optional tool → synthesis).
 *
 * The allowlist (`route.allowedTools`) is the sole gate on what the model may
 * call. A route that offers only `alix_web_search`/`alix_web_fetch` has no shell
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
  // `route.allowedTools` holds INTERNAL executor ids — it is route config, not
  // a model surface. The provider, however, must be offered the exact manifest
  // names: passing the executor ids straight through made this route the one
  // path that never went through `resolveExecutableToolName`, so the model was
  // offered and the executor accepted the very spelling the exact-name contract
  // says must never reach execution (`web_search`/`web_fetch` before the dotted
  // rename, `web.search`/`web.fetch` after it — the violation was pre-existing,
  // but it is a vocabulary bug and this branch is the vocabulary branch).
  const allowedExecutors = new Set(route.allowedTools);
  const executableTools = ([webSearchTool(), webFetchTool({ allowDomains: config.permissions?.allowNetworkDomains ?? [] })] as ToolDef[])
    .filter((t) => allowedExecutors.has(t.name));
  const tools = executableTools.map((tool) => {
    const modelFacing = ALIX_EXECUTOR_TO_MODEL_FACING.get(tool.name);
    // A tool with no manifest name is unroutable-by-design here; keep its own
    // name so the allowlist check below still applies rather than silently
    // widening the surface.
    return modelFacing ? { ...tool, name: modelFacing } : tool;
  });
  const offeredModelFacing = new Set(tools.map((tool) => tool.name));
  const selectionSignatures = new Map<string, number>();

  // First call: model may issue a tool call for fresh information
  const response = await provider.complete({
    systemPrompt: retrievalPrompt.systemPrompt,
    messages: [{ role: "user", content: retrievalPrompt.userPromptTemplate(route.prompt) }],
    tools: tools.length > 0 ? tools : undefined,
    ...tokenCap(deps),
    ...(deps.context ? { context: deps.context } : {}),
  }, { signal: deps.signal });

  if (response.toolCalls.length > 0) {
    // #760: models sometimes fan out parallel calls (e.g. a typo variant +
    // a corrected spelling of the same query). The grounded flow stays a
    // single tool round — execute the first allowlisted call, ignore extras —
    // instead of surfacing a governor error to natural-language users.
    const tc = response.toolCalls[0];

    // Enforce the allowlist against the OFFERED model-facing names, then resolve
    // through the shared resolver so the executor only ever receives an
    // internal id derived from a name actually offered this turn.
    if (!offeredModelFacing.has(tc.name)) {
      return `Tool "${tc.name}" is not allowed for this query type.`;
    }

    let execName: string;
    try {
      execName = resolveExecutableToolName(tc.name, tools.map((tool) => ({ name: tool.name })));
    } catch {
      return `Tool "${tc.name}" is not available.`;
    }

    const toolResult = await executor.execute({
      toolCallId: await newToolCallId(),
      name: execName,
      args: tc.args,
      signal: deps.signal,
      runId: deps.context?.runId,
    });

    // Selection observation for this external turn. The surface recorded is
    // exactly the `tools` array handed to `provider.complete` above — not a
    // later reconstruction — and the choice is resolved against it. A choice
    // that does not resolve is recorded as invalid rather than matched to a
    // convenient candidate. Emitted through the shared neutral assembly, so
    // this path and the task loop describe a selection identically.
    if (deps.selectionScope) {
      // Canonical candidate names: the provider-facing name the model emitted
      // (`chosen`) is a fact; the candidate id must be the same key the task
      // loop uses for that tool, so the two paths stay comparable.
      const aliases = deps.toolCandidateAliases;
      const canonical = (name: string): string => aliases?.[name] ?? name;
      const frozen = tools.map(tool => ({
        candidateId: `builtin:${canonical(tool.name)}`,
        domain: "builtin" as const,
        label: canonical(tool.name),
        description: tool.description ?? "",
      }));
      const chosenCandidateId = frozen.find(candidate => candidate.label === canonical(tc.name))?.candidateId;
      const [{ emitSelectionObservation }, { hashArgs }] = await Promise.all([
        import("../observability/tool-selection-observation.js"),
        import("../tools/executor.js"),
      ]);
      await emitSelectionObservation(
        deps.eventLog,
        { sessionId: deps.selectionScope.sessionId, actor: "system" },
        {
          scopeId: deps.selectionScope.scopeId,
          iteration: deps.selectionScope.iteration,
          candidates: frozen,
          chosen: tc.name,
          chosenCandidateId: chosenCandidateId ?? `builtin:${canonical(tc.name)}`,
          executor: tc.name,
          argsSignature: `${tc.name}:${hashArgs(tc.args ?? {})}`,
          seenSignatures: selectionSignatures,
          executorSuccess: toolResult.kind === "success",
          hasContent: toolResult.kind === "success",
          ...(chosenCandidateId
            ? {}
            : { invalidSelection: { toolName: tc.name, reason: "chosen tool is not in the offered surface" } }),
        },
      ).catch(() => {
        // Observation is instrumentation: a logging failure must never break
        // the external turn.
      });
    }

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
      ...(deps.context ? { context: deps.context } : {}),
    }, { signal: deps.signal });
    return finalResponse.text || "(no response)";
  }

  // No tool call — model answered directly
  if (deps.selectionScope) {
    const { emitSelectionNotApplicable } = await import("../observability/tool-selection-observation.js");
    await emitSelectionNotApplicable(
      deps.eventLog,
      { sessionId: deps.selectionScope.sessionId, actor: "system" },
      {
        scopeId: deps.selectionScope.scopeId,
        iteration: deps.selectionScope.iteration,
        route: "grounded",
        reason: tools.length > 0 ? "no_tool_call" : "no_tools_offered",
      },
    ).catch(() => {
    });
  }
  return response.text || "(no response)";
}
