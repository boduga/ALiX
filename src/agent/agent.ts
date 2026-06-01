import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config/loader.js";
import { EventLog } from "../events/event-log.js";
import { PolicyEngine } from "../policy/policy-engine.js";
import { ApprovalManager } from "../policy/approvals.js";
import { buildRepoMapLite } from "../repomap/repomap-lite.js";
import { createProvider } from "../providers/registry.js";
import type { ModelAdapter } from "../providers/types.js";
import type { McpManager } from "../mcp/manager.js";
import { ToolExecutor } from "../tools/executor.js";
import { buildEditFormatPolicy } from "../patch/edit-format-policy.js";
import { CheckpointManager } from "../patch/checkpoint.js";
import { buildSessionDigest } from "../utils/session-digest.js";
import { MemoryStore } from "../utils/memory/store.js";
import { buildMemoryContext, buildMemoryStats } from "../utils/memory/recall.js";
import { DEFAULT_FACTORY_CONFIG } from "../skills/dispatcher.js";
import { extractInitialScope, createScopeTracker } from "../autonomy/scope-tracker.js";
import type { ScopeTracker } from "../autonomy/scope-tracker.js";
import { shouldAutoDisableStreaming } from "./stream.js";

export type AgentContext = {
  sessionId: string;
  sessionDir: string;
  log: EventLog;
  config: Awaited<ReturnType<typeof loadConfig>>;
  provider: ModelAdapter;
  editFormatPolicy: ReturnType<typeof buildEditFormatPolicy>;
  mcpManager: McpManager | null;
  toolExecutor: ToolExecutor;
  checkpointManager: CheckpointManager;
  memoryStore: MemoryStore;
  repoMap: Awaited<ReturnType<typeof buildRepoMapLite>> | undefined;
  ownershipRegistry?: import("../agents/ownership-registry.js").OwnershipRegistry;
  mergeCoordinator?: import("../agents/merge-coordinator.js").MergeCoordinator;
  subagentManager?: import("../agents/subagent-manager.js").SubagentManager;
  scope: ScopeTracker;
};

export type InitAgentOpts = {
  cwd: string;
  task: string;
  sessionId?: string;
  sessionDir?: string;
  sharedSession?: {
    sessionId: string;
    sessionDir: string;
    eventLog: EventLog;
  };
  sessionMode?: "auto" | "ask" | "bypass";
};

export async function initAgent(cwd: string, opts: InitAgentOpts): Promise<AgentContext> {
  let sessionId: string;
  let sessionDir: string;
  let log: EventLog;

  // Use shared session if provided (for TUI integration)
  if (opts.sharedSession) {
    sessionId = opts.sharedSession.sessionId;
    sessionDir = opts.sharedSession.sessionDir;
    log = opts.sharedSession.eventLog;
  } else {
    sessionId = opts.sessionId ?? randomUUID();
    sessionDir = opts.sessionDir ?? join(cwd, ".alix", "sessions", sessionId);
    await mkdir(sessionDir, { recursive: true });
    log = new EventLog(sessionDir);
    await log.init();
  }

  const config = await loadConfig(cwd);
  // CLI flag overrides config for session mode
  if (opts.sessionMode) {
    config.permissions.sessionMode = opts.sessionMode;
  }

  // Auto-disable streaming in non-TTY environments unless explicitly forced
  if (shouldAutoDisableStreaming() && config.model.streaming) {
    config.model.streaming = false;
  }

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
  await log.append({ ...session, actor: "user", type: "user.message", payload: { text: opts.task, attachments: [] } });

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

  const provider = await createProvider(
    { provider: config.model.provider, model: config.model.name },
    process.env[`${config.model.provider.toUpperCase()}_API_KEY`]
  );
  const editFormatPolicy = buildEditFormatPolicy({ provider: config.model.provider, preferred: provider.editFormatPreference });

  // Initialize MCP manager (lazy - only needed if config.mcpServers?.length > 0)
  let mcpManager: McpManager | null = null;
  if (config.mcpServers?.length) {
    const { McpManager: McpManagerClass } = await import("../mcp/manager.js");
    mcpManager = new McpManagerClass(config);
    await mcpManager.initialize();
  }

  const { discoverHooks } = await import("../hooks/discover.js");
  const hooks = await discoverHooks(cwd);

  // Load skills (manifests only at startup, bodies lazy-loaded on match)
  const skillsHome = join(process.env.HOME ?? "", ".alix", "skills");
  const { loadSkillManifests } = await import("../skills/loader.js");
  const { buildSkillCatalog } = await import("../skills/catalog.js");
  const skillManifests = await loadSkillManifests(skillsHome);
  const skillCatalog = buildSkillCatalog(skillManifests);

  // Enforce store limits
  const { evictIfNeeded } = await import("../skills/lifecycle.js");
  const { maxStore, maxCandidates } = config.skills?.factory ?? DEFAULT_FACTORY_CONFIG;
  evictIfNeeded(skillsHome, { maxStore, maxCandidates: maxCandidates ?? 200 });

  // Initialize subagent infrastructure only if enabled
  let ownershipRegistry: import("../agents/ownership-registry.js").OwnershipRegistry | undefined;
  let mergeCoordinator: import("../agents/merge-coordinator.js").MergeCoordinator | undefined;
  let subagentManager: import("../agents/subagent-manager.js").SubagentManager | undefined;
  let delegateHandler: ((args: Record<string, unknown>) => Promise<import("../tools/types.js").ToolResult>) | undefined;

  if (config.subagents?.enabled) {
    const { SubagentManager: SubagentManagerClass } = await import("../agents/subagent-manager.js");
    const { OwnershipRegistry: OwnershipRegistryClass } = await import("../agents/ownership-registry.js");
    const { MergeCoordinator: MergeCoordinatorClass } = await import("../agents/merge-coordinator.js");
    const { createDelegateHandler: createDelegateHandlerFn } = await import("../agents/delegate-tool.js");

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

  const toolExecutor = new ToolExecutor(config, log, cwd, mcpManager ?? undefined, editFormatPolicy, delegateHandler ? { delegate: delegateHandler } : undefined, checkpointManager);

  // Scope tracking: derive initial scope from task string
  const initialScope = extractInitialScope(opts.task);
  const scope = createScopeTracker(initialScope?.files ?? [], cwd);

  return {
    sessionId,
    sessionDir,
    log,
    config,
    provider,
    editFormatPolicy,
    mcpManager,
    toolExecutor,
    checkpointManager,
    memoryStore,
    repoMap,
    ownershipRegistry,
    mergeCoordinator,
    subagentManager,
    scope,
  };
}