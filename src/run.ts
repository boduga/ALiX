import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { loadConfig } from "./config/loader.js";
import { getEncoding } from "./config/context-limits.js";
import { EventLog } from "./events/event-log.js";
import { PolicyEngine } from "./policy/policy-engine.js";
import { ApprovalManager } from "./policy/approvals.js";
import { buildRepoMapLite } from "./repomap/repomap-lite.js";
import { ContextCompiler } from "./repomap/context-compiler.js"; // LAZY: conditional on config.context?.enabled
import { createProvider } from "./providers/registry.js";
import type { ModelAdapter, NormalizedMessage, ToolCall, TokenUsage, ToolDef } from "./providers/types.js";
import type { DeferredToolEntry } from "./mcp/tool-deferral.js";
import { ToolSelector } from "./mcp/tool-selector.js";
import { ApiError } from "./providers/base.js";
import { ToolExecutor } from "./tools/executor.js";
import { ToolDiscovery } from "./mcp/tool-discovery.js";
import type { LoadedSkill } from "./skills/types.js";
import type { McpManager } from "./mcp/manager.js"; // LAZY: conditional on config.mcpServers?.length > 0
import { buildSessionDigest } from "./utils/session-digest.js";
import { MemoryStore } from "./utils/memory/store.js"; // LAZY: conditional on memory features enabled
import type { MemoryEntry } from "./utils/memory/types.js";
import { buildMemoryContext, buildMemoryStats } from "./utils/memory/recall.js";
import { classifyTask, detectResearchDepth } from "./task-classifier.js";
import { DEFAULT_FACTORY_CONFIG } from "./skills/dispatcher.js";
import { extractInitialScope, createScopeTracker } from "./autonomy/scope-tracker.js";
import { TaskStateMachine, RunLimiter } from "./autonomy/state-machine.js";
import type { ScopeTracker } from "./autonomy/scope-tracker.js";
import type { AgentState } from "./autonomy/scope-tracker.js";
import { buildEditFormatPolicy } from "./patch/edit-format-policy.js";
import { extractPatchPaths } from "./patch/patch-paths.js";
import { CheckpointManager } from "./patch/checkpoint.js";
import { promptUser, saveDecisionsToMemory, streamToResponse, resolveMcpTool, validMutationPaths, BASE_TOOLS, patchFormatDescription, patchTextDescription } from "./run/helpers.js";
import { TOOL_NAME_MAP } from "./agents/tool-name-map.js";
import { handleToolCall, handleMcpToolSearch, handleScopeExpansion, buildScopeDenialMessage, buildScopeRejectionSummary, type EventHandlerDeps } from "./run/event-handlers.js";
import { runTaskLoop, type TaskLoopDeps } from "./run/task-loop.js";



export function buildErrorMessage(err: { kind: "error"; message: string; retryable?: boolean; hint?: string }): string {
  const parts: string[] = [`Error: ${err.message}`];
  if (err.hint) parts.push(`Hint: ${err.hint}`);
  if (err.retryable === false) parts.push("This error is fatal — do not retry this tool.");
  else if (err.retryable === true) parts.push("This error may be transient — retrying may help.");
  return parts.join(" ");
}

export function buildToolsForProvider(provider: Pick<ModelAdapter, "editFormatPreference">): ToolDef[] {
  const policy = buildEditFormatPolicy({ provider: "runtime", preferred: provider.editFormatPreference });
  return BASE_TOOLS.map((tool) => {
    if (tool.name !== "alix_patch_apply") return tool;
    return {
      ...tool,
      input_schema: {
        ...tool.input_schema,
        properties: {
          ...tool.input_schema.properties,
          format: {
            type: "string",
            enum: policy.allowed,
            description: patchFormatDescription(policy)
          },
          patchText: {
            type: "string",
            description: patchTextDescription(policy.preferred)
          }
        }
      }
    };
  });
}

export function buildContextBundleEventPayload(contextBundle: import("./repomap/context-compiler.js").ContextBundle) {
  return {
    taskType: contextBundle.taskType,
    budget: contextBundle.budget,
    primaryFiles: contextBundle.primaryFiles,
    tests: contextBundle.tests,
    supportingFiles: contextBundle.supportingFiles,
    pinned: contextBundle.pinned,
  };
}

export function buildModelUsageEventPayload(provider: string, model: string, usage: TokenUsage) {
  return { provider, model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
}

export function renderContextBundleForPrompt(contextBundle: import("./repomap/context-compiler.js").ContextBundle): string {
  const lines: string[] = ["## Context Files"];
  if (contextBundle.primaryFiles.length > 0) {
    const files = contextBundle.primaryFiles.filter(f => f.kind === "file");
    const symbols = contextBundle.primaryFiles.filter(f => f.kind === "symbol");
    if (files.length > 0) {
      lines.push(`Primary files: ${files.map(f => `${f.path} (${f.reason})`).join(", ")}`);
    }
    if (symbols.length > 0) {
      lines.push(`Symbols: ${symbols.map(f => `${f.symbolName}@${f.path}:${f.lineStart} (${f.reason})`).join(", ")}`);
    }
  }
  if (contextBundle.tests.length > 0) {
    lines.push(`Related tests: ${contextBundle.tests.map(f => `${f.path} (${f.reason})`).join(", ")}`);
  }
  if (contextBundle.supportingFiles.length > 0) {
    lines.push(`Supporting files: ${contextBundle.supportingFiles.map(f => `${f.path} (${f.reason})`).join(", ")}`);
  }
  return lines.join("\n");
}

export type StreamHandler = (chunk: { type: "text" | "tool_call"; text?: string; toolCall?: ToolCall }) => void;

export type RunResult = {
  sessionId: string;
  summary: string;
  streamed?: boolean;
  reason?: "completed" | "max_repairs" | "max_iterations" | "rejected_scope_expansion";
};

export type RunOpts = { streaming?: boolean; sessionMode?: "auto" | "ask" | "bypass" };

export const EXIT_CODES = {
  REJECTED_SCOPE_EXPANSION: 3,
} as const;

export type MutationSessionState = {
  created: Set<string>;
  changed: Set<string>;
  deleted: Set<string>;
  fatalErrors: string[];
  pendingScopeExpansion: boolean;
};

export function extractMutationPaths(execName: string, args: Record<string, unknown>): string[] {
  if (execName === "patch.apply") {
    return extractPatchPaths(args.format as string | undefined, args.patchText);
  }
  const path = args.path;
  return typeof path === "string" && path.length > 0 ? [path] : [];
}

export function recordMutationInSessionState(
  state: MutationSessionState,
  execName: string,
  args: Record<string, unknown>
): void {
  const paths = validMutationPaths(execName, args);
  if (execName === "file.create") {
    for (const path of paths) state.created.add(path);
  }
  if (execName === "file.delete") {
    for (const path of paths) state.deleted.add(path);
  }
  if (execName === "file.write" || execName === "patch.apply") {
    for (const path of paths) state.changed.add(path);
  }
}

export function shouldAutoDisableStreaming(): boolean {
  if (!process.stdout.isTTY) return true;
  if (process.env.CI) return true;
  return false;
}

export async function runTask(cwd: string, task: string, opts?: RunOpts, onStream?: StreamHandler): Promise<RunResult> {
  const sessionId = randomUUID();
  const sessionDir = join(cwd, ".alix", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });

  const config = await loadConfig(cwd);
  // CLI flag overrides config for session mode
  if (opts?.sessionMode) {
    config.permissions.sessionMode = opts.sessionMode;
  }
  // Auto-disable streaming in non-TTY environments unless explicitly forced
  if (shouldAutoDisableStreaming() && config.model.streaming && opts?.streaming !== true) {
    config.model.streaming = false;
  }
  const log = new EventLog(sessionDir);
  await log.init();

  // Create policy engine with event log
  const policyEngine = new PolicyEngine(config, {}, {
    eventLog: log,
    sessionId,
  });

  // Create approval manager with event log
  const approvalManager = new ApprovalManager({
    eventLog: log,
    sessionId,
  });

  // Initialize CheckpointManager for the session
  const checkpointManager = new CheckpointManager(join(sessionDir, "checkpoints"));
  await checkpointManager.init();

  const session = { sessionId, actor: "system" as const };

  await log.append({ ...session, type: "session.started", payload: { cwd, configHash: "mvp" } });
  await log.append({ ...session, actor: "user", type: "user.message", payload: { text: task, attachments: [] } });

  // Load memory context for injection into system prompt
  const memoryStore = new MemoryStore(join(cwd, ".alix", "memory"));
  const memoryContext = await buildMemoryContext(memoryStore);
  const memoryStats = await buildMemoryStats(memoryStore);

  const repoMap = config.context.repoMap ? await buildRepoMapLite(cwd) : undefined;
  await log.append({
    ...session,
    type: "context.repo_map_lite_created",
    payload: { fileCount: repoMap?.files.length ?? 0, sourceCount: repoMap?.sourceFiles.length ?? 0, testCount: repoMap?.testFiles.length ?? 0 }
  });

  // Context compiler wired after MAX_CONTEXT_TOKENS and taskType are resolved (see below)

  const provider = createProvider(
    { provider: config.model.provider, model: config.model.name },
    process.env[`${config.model.provider.toUpperCase()}_API_KEY`]
  );
  const editFormatPolicy = buildEditFormatPolicy({ provider: config.model.provider, preferred: provider.editFormatPreference });
  const providerTools = buildToolsForProvider(provider);

  // Initialize MCP manager (lazy - only needed if config.mcpServers?.length > 0)
  let mcpManager: McpManager | null = null;
  if (config.mcpServers?.length) {
    const { McpManager: McpManagerClass } = await import("./mcp/manager.js");
    mcpManager = new McpManagerClass(config);
    await mcpManager.initialize();
  }

  const { discoverHooks } = await import("./hooks/discover.js");
  const { ensureEncoder, estimateTokens, estimateMessageTokens, truncateToTokenBudget } = await import("./utils/tokens.js");
  const hooks = await discoverHooks(cwd);

  // Load skills (manifests only at startup, bodies lazy-loaded on match)
  const skillsHome = join(process.env.HOME ?? "", ".alix", "skills");
  const { loadSkillManifests } = await import("./skills/loader.js");
  const { buildSkillCatalog } = await import("./skills/catalog.js");
  const skillManifests = await loadSkillManifests(skillsHome);
  const skillCatalog = buildSkillCatalog(skillManifests);

  // Enforce store limits
  const { evictIfNeeded } = await import("./skills/lifecycle.js");
  const { maxStore, maxCandidates } = config.skills?.factory ?? DEFAULT_FACTORY_CONFIG;
  evictIfNeeded(skillsHome, { maxStore, maxCandidates: maxCandidates ?? 200 });

  // Initialize subagent infrastructure only if enabled
  let ownershipRegistry: import("./agents/ownership-registry.js").OwnershipRegistry | undefined;
  let mergeCoordinator: import("./agents/merge-coordinator.js").MergeCoordinator | undefined;
  let subagentManager: import("./agents/subagent-manager.js").SubagentManager | undefined;
  let delegateHandler: ((args: Record<string, unknown>) => Promise<import("./tools/types.js").ToolResult>) | undefined;

  if (config.subagents?.enabled) {
    const { SubagentManager: SubagentManagerClass } = await import("./agents/subagent-manager.js");
    const { OwnershipRegistry: OwnershipRegistryClass } = await import("./agents/ownership-registry.js");
    const { MergeCoordinator: MergeCoordinatorClass } = await import("./agents/merge-coordinator.js");
    const { createDelegateHandler: createDelegateHandlerFn } = await import("./agents/delegate-tool.js");

    ownershipRegistry = new OwnershipRegistryClass();
    mergeCoordinator = new MergeCoordinatorClass();
    subagentManager = new SubagentManagerClass({ sessionId, config });
    subagentManager.onResult((result) => {
      mergeCoordinator!.enqueue(result);
      void log.append({ ...session, actor: "subagent", type: "subagent.result", payload: result });
    });
    delegateHandler = createDelegateHandlerFn(subagentManager, (opts) => {
      const taskId = crypto.randomUUID();
      if (opts.mode === "write" && opts.ownedPaths?.length) {
        ownershipRegistry!.claim(taskId, opts.ownedPaths);
      }
      return { id: taskId, role: opts.role, mode: opts.mode ?? "read_only", prompt: opts.prompt, ownedPaths: opts.ownedPaths };
    });
  }

  const executor = new ToolExecutor(config, log, cwd, mcpManager ?? undefined, editFormatPolicy, delegateHandler ? { delegate: delegateHandler } : undefined, checkpointManager);

  const mcpDeferral = mcpManager?.getDeferral();
  const mcpToolIndex = mcpDeferral?.buildIndex() ?? [];
  const toolSelector = new ToolSelector(mcpToolIndex, { maxTools: 20, tokenBudget: 3000 });
  const selectedTools = toolSelector.select(task);
  const mcpDiscovery = mcpManager ? new ToolDiscovery(mcpToolIndex) : null; // full index, not selectedTools
  for (const entry of selectedTools) {
    TOOL_NAME_MAP[entry.name] = entry.execName;
  }
  await log.append({ sessionId, actor: "system", type: "mcp.tools_selected", payload: { total: mcpToolIndex.length, selected: selectedTools.length, taskPreview: task.slice(0, 100) } });

  const sessionState = {
    created: new Set<string>(),
    deleted: new Set<string>(),
    changed: new Set<string>(),
    fatalErrors: [] as string[],
    pendingScopeExpansion: false,
  };

  let messages: NormalizedMessage[] = [{ role: "user", content: task }];

  // Resolve context limit and encoding from config or API
  const userOverride = config.model.maxContextTokens;
  let maxTokens: number;
  let encoding: "cl100k_base" | "o200k_base" | "char4";

  if (userOverride !== undefined) {
    maxTokens = userOverride;
    encoding = getEncoding(config.model.provider);
  } else {
    const { resolveContextLimit, getEncoding: getEnc } = await import("./config/context-limits.js");
    const resolved = await resolveContextLimit(config.model.provider, config.model.name, config.apiKeys);
    maxTokens = resolved.maxTokens;
    encoding = resolved.encoding;
  }

  await ensureEncoder(encoding);
  const MAX_CONTEXT_TOKENS = maxTokens;
  const taskType = classifyTask(task);
  const depth = detectResearchDepth(task);
  const maxIterations = config.model.maxIterations ?? 10;
  let repairCount = 0;
  const maxRepairs = 3;

  // Scope tracking: derive initial scope from task string
  const initialScope = extractInitialScope(task);
  const scope: ScopeTracker = createScopeTracker(initialScope?.files ?? [], cwd);

  // State machine with hard limits
  const limiter = new RunLimiter({
    maxIterations,
    maxRepairs: 3,
    maxFileChanges: 0,    // 0 = unlimited
    maxShellCommands: 0,  // 0 = unlimited
    maxRuntimeMs: 0,      // 0 = unlimited
  });
  const stateMachine = new TaskStateMachine(limiter, (from, to, reason) => {
    void log.append({ ...session, actor: "system", type: "autonomy.state_transition", payload: { from, to, reason } });
  });

  // Inject available skills into system prompt

  // Context compiler: warm up and compile context bundle now that MAX_CONTEXT_TOKENS and taskType are resolved
  const contextCompiler = new ContextCompiler({
    root: cwd,
    maxTokens: MAX_CONTEXT_TOKENS,
    eventLog: log,
    sessionId,
  });
  await contextCompiler.warm();
  const contextBundle = await contextCompiler.compileContext(task, taskType, []);
  await log.append({
    ...session,
    type: "context.bundle_compiled",
    payload: buildContextBundleEventPayload(contextBundle),
  });

  function buildSystemPrompt(base: string, contextBundle: import("./repomap/context-compiler.js").ContextBundle, memoryContext: string, memoryStats: string, matchedSkills?: LoadedSkill[]): string {
    const parts: string[] = [base];

    if (matchedSkills && matchedSkills.length > 0) {
      const skillSection = matchedSkills
        .map(s => `## Skill: ${s.manifest.trigger ?? s.manifest.name}\n${s.body}`)
        .join("\n\n");
      parts.push(`## Available Skills\n${skillSection}`);
    }

    // Inject ranked context bundle if populated
    if (contextBundle.primaryFiles.length > 0 || contextBundle.tests.length > 0 || contextBundle.supportingFiles.length > 0) {
      parts.push(renderContextBundleForPrompt(contextBundle));
    }

    // Inject memory stats summary at session start
    if (memoryStats) {
      parts.push(`## Memory Stats\n${memoryStats}`);
    }

    // Inject memory context if available
    if (memoryContext) {
      parts.push(`## Memory\n${memoryContext}`);
    }

    return parts.join("\n\n");
  }

  const { skillFactory } = await import("./skills/dispatcher.js");

  // Lazy-load matched skill content (only load bodies for skills that match the task)
  const matchedSkills = await skillCatalog.getMatchedContent(task);

  const SYSTEM_PROMPT_BASE = "You are ALiX, an AI coding agent. You have access to tools. IMPORTANT: When you call a tool, wait for the result in the next response before taking further action. If a tool returns an error, fix the issue. If the tool succeeds, confirm completion. Do NOT repeat the same tool call twice without checking the result first. When the task is complete, call the done tool — do NOT keep calling tools after the goal is achieved.";
  const SYSTEM_PROMPT = buildSystemPrompt(SYSTEM_PROMPT_BASE, contextBundle, memoryContext, memoryStats, matchedSkills);

  // Build deps for the task loop
  const taskLoopDeps: TaskLoopDeps = {
    config: {
      model: {
        provider: config.model.provider,
        name: config.model.name,
        streaming: config.model.streaming ?? false,
      },
      permissions: {
        sessionMode: config.permissions.sessionMode,
      },
      skills: config.skills,
    },
    provider,
    providerTools,
    mcpToolIndex,
    messages,
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
    systemPrompt: SYSTEM_PROMPT,
    onStream,
  };

  // Run the task loop
  return await runTaskLoop(taskLoopDeps);
}
