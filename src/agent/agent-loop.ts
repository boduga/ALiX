import { join } from "node:path";
import { initAgent, type AgentContext } from "./agent.js";
import { buildToolsForProvider, buildContextBundleEventPayload, renderContextBundleForPrompt } from "./messages.js";
import type { StreamHandler } from "./stream.js";
import type { RunResult, RunOpts, MutationSessionState } from "../run.js";
import { runTaskLoop, type TaskLoopDeps } from "../run/task-loop.js";
import { ToolSelector } from "../mcp/tool-selector.js";
import { ToolDiscovery } from "../mcp/tool-discovery.js";
import { classifyTask, detectResearchDepth, isReadOnlyTask, isShellTask } from "../task-classifier.js";
import { runPlanPhase } from "../run/plan-phase.js";
import { READ_ONLY_TOOL_NAMES } from "../run/helpers.js";
import { TaskStateMachine, RunLimiter } from "../autonomy/state-machine.js";
import { buildMemoryContext, buildMemoryStats } from "../utils/memory/recall.js";
import { ContextCompiler } from "../repomap/context-compiler.js";
import { TOOL_NAME_MAP } from "../agents/tool-name-map.js";
import type { NormalizedMessage } from "../providers/types.js";
import { getEncoding } from "../config/context-limits.js";
import { buildEditFormatPolicy } from "../patch/edit-format-policy.js";
import { DEFAULT_FACTORY_CONFIG } from "../skills/dispatcher.js";
import { evictIfNeeded } from "../skills/lifecycle.js";

export async function runTask(cwd: string, task: string, opts?: RunOpts, onStream?: StreamHandler): Promise<RunResult> {
  const ctx = await initAgent(cwd, { cwd, task, sessionId: opts?.sharedSession?.sessionId, sessionDir: opts?.sharedSession?.sessionDir, sharedSession: opts?.sharedSession, sessionMode: opts?.sessionMode });

  const session = { sessionId: ctx.sessionId, actor: "system" as const };

  // Resume path — reconstruct state from a prior session
  if (opts?.resumeSessionId) {
    const { reconstructSession } = await import("../session/resume.js");
    const reconstructed = await reconstructSession(cwd, opts.resumeSessionId);

    if (reconstructed.completed) {
      return {
        sessionId: ctx.sessionId,
        summary: `Session ${opts.resumeSessionId} is already completed. Use a different session or start a new task.`,
        streamed: opts?.streaming,
      };
    }

    // Override task with the original task from the persisted session
    const originalTask = reconstructed.messages.find(m => m.role === "user");
    if (originalTask && typeof originalTask.content === "string") {
      task = originalTask.content;
    }

    // Store reconstructed state on context for downstream use
    (ctx as any)._resumedMessages = reconstructed.messages;
    (ctx as any)._scopeSnapshot = reconstructed.scopeSnapshot;
    (ctx as any)._stateSnapshot = reconstructed.stateSnapshot;
    (ctx as any)._planContent = reconstructed.planContent;

    await ctx.log.append({ ...session, actor: "system", type: "session.resumed", payload: { priorSessionId: opts.resumeSessionId, task } });
  }

  // Build memory context for injection into system prompt
  const memoryContext = await buildMemoryContext(ctx.memoryStore);
  const memoryStats = await buildMemoryStats(ctx.memoryStore);

  // Load skills (manifests only at startup, bodies lazy-loaded on match)
  const skillsHome = join(process.env.HOME ?? "", ".alix", "skills");
  const { loadSkillManifests } = await import("../skills/loader.js");
  const { buildSkillCatalog } = await import("../skills/catalog.js");
  const skillManifests = await loadSkillManifests(skillsHome);
  const skillCatalog = buildSkillCatalog(skillManifests);

  // Enforce store limits
  const { evictIfNeeded: evict } = await import("../skills/lifecycle.js");
  const { maxStore, maxCandidates } = ctx.config.skills?.factory ?? DEFAULT_FACTORY_CONFIG;
  evict(skillsHome, { maxStore, maxCandidates: maxCandidates ?? 200 });

  // Resolve context limit and encoding from config or API
  const userOverride = ctx.config.model.maxContextTokens;
  let maxTokens: number;
  let encoding: "cl100k_base" | "o200k_base" | "char4";

  if (userOverride !== undefined) {
    maxTokens = userOverride;
    encoding = getEncoding(ctx.config.model.provider);
  } else {
    const { resolveContextLimit, getEncoding: getEnc } = await import("../config/context-limits.js");
    const resolved = await resolveContextLimit(ctx.config.model.provider, ctx.config.model.name, ctx.config.apiKeys);
    maxTokens = resolved.maxTokens;
    encoding = resolved.encoding;
  }

  const MAX_CONTEXT_TOKENS = maxTokens;
  const taskType = classifyTask(task);
  const depth = detectResearchDepth(task);
  const maxIterations = ctx.config.model.maxIterations ?? 10;

  // Shell tasks (bare commands like ls, cat) cap at 2 iterations
  const shellTask = isShellTask(task);
  const readOnlyTask = isReadOnlyTask(task) || shellTask;
  const cappedIterations = shellTask ? Math.min(maxIterations, 2) : maxIterations;

  // State machine with hard limits
  const limiter = new RunLimiter({
    maxIterations,
    maxRepairs: 3,
    maxFileChanges: 0,
    maxShellCommands: 0,
    maxRuntimeMs: 0,
  });
  const stateMachine = new TaskStateMachine(limiter, (from, to, reason) => {
    void ctx.log.append({ ...session, actor: "system", type: "autonomy.state_transition", payload: { from, to, reason } });
    void ctx.log.append({ ...session, actor: "system", type: "agent.state_changed", payload: { state: to, reason } });
  });

  // Restore state machine counters on resume
  if (opts?.resumeSessionId) {
    const stateSnapshot = (ctx as any)._stateSnapshot;
    if (stateSnapshot) {
      stateMachine._setState(stateSnapshot.state);
      // Restore counters by calling tick an appropriate number of times
      for (let c = 0; c < stateSnapshot.counters.iterations; c++) {
        stateMachine.tick(0);
      }
      for (let c = 0; c < stateSnapshot.counters.repairs; c++) {
        stateMachine.recordRepair();
      }
      for (let c = 0; c < stateSnapshot.counters.fileChanges; c++) {
        stateMachine.recordFileChange();
      }
      for (let c = 0; c < stateSnapshot.counters.shellCommands; c++) {
        stateMachine.recordShellCommand();
      }
    }

    // Restore scope from snapshot if available
    const scopeSnapshot = (ctx as any)._scopeSnapshot;
    if (scopeSnapshot) {
      const { ScopeTracker } = await import("../autonomy/scope-tracker.js");
      const restored = ScopeTracker.fromJSON(scopeSnapshot);
      // Replace the scope on ctx so downstream code uses the restored one
      (ctx as any)._restoredScope = restored;
    }
  }

  // Context compiler: warm up and compile context bundle
  const contextCompiler = new ContextCompiler({
    root: cwd,
    maxTokens: MAX_CONTEXT_TOKENS,
    eventLog: ctx.log,
    sessionId: ctx.sessionId,
  });
  await contextCompiler.warm();
  const contextBundle = await contextCompiler.compileContext(task, taskType, []);
  await ctx.log.append({
    ...session,
    type: "context.bundle_compiled",
    payload: buildContextBundleEventPayload(contextBundle),
  });

  // Plan phase — generate plan, get approval, inject into system prompt
  let approvedPlanContent: string | undefined;

  // On resume, use the existing plan instead of generating a new one
  const resumedPlan = (ctx as any)._planContent;
  if (resumedPlan) {
    approvedPlanContent = resumedPlan;
  } else if (opts?.planMode !== false) {
    const planResult = await runPlanPhase(ctx, contextBundle, task, opts?.planFilePath);
    if (planResult.action === "rejected") {
      return {
        sessionId: ctx.sessionId,
        summary: "Plan rejected. Task cancelled.",
        streamed: opts?.streaming,
      };
    }
    if (planResult.action === "approved") {
      approvedPlanContent = planResult.planContent;
    }
  }

  const baseTools = buildToolsForProvider(ctx.provider);
  const providerTools = shellTask
    ? baseTools.filter((t) => READ_ONLY_TOOL_NAMES.has(t.name))
    : baseTools;

  // Setup MCP tool index
  const mcpDeferral = ctx.mcpManager?.getDeferral();
  const mcpToolIndex = mcpDeferral?.buildIndex() ?? [];
  const toolSelector = new ToolSelector(mcpToolIndex, { maxTools: 20, tokenBudget: 3000 });
  const selectedTools = toolSelector.select(task);
  const mcpDiscovery = ctx.mcpManager ? new ToolDiscovery(mcpToolIndex) : null;
  for (const entry of selectedTools) {
    TOOL_NAME_MAP[entry.name] = entry.execName;
  }
  await ctx.log.append({ sessionId: ctx.sessionId, actor: "system", type: "mcp.tools_selected", payload: { total: mcpToolIndex.length, selected: selectedTools.length, taskPreview: task.slice(0, 100) } });

  // Session state for mutations
  const sessionState: MutationSessionState = {
    created: new Set<string>(),
    deleted: new Set<string>(),
    changed: new Set<string>(),
    fatalErrors: [] as string[],
    pendingScopeExpansion: false,
  };

  // Lazy-load matched skill content
  const matchedSkills = await skillCatalog.getMatchedContent(task);

  // Build system prompt
  const SYSTEM_PROMPT_BASE = "You are ALiX, an AI coding agent. You have access to tools. IMPORTANT: When you call a tool, wait for the result in the next response before taking further action. If a tool returns an error, fix the issue. If the tool succeeds, confirm completion. Do NOT repeat the same tool call twice without checking the result first. When the task is complete, call the done tool — do NOT keep calling tools after the goal is achieved. For read-only queries (like pwd, ls, cat, grep), call done immediately after getting the result — there is nothing to verify.";
  const lines: string[] = [
    SYSTEM_PROMPT_BASE,
    `## Workspace\nYou are working in: \`${cwd}\`. All file paths are relative to this directory.`,
  ];

  // For shell tasks (bare commands like ls, cat), inject a mode instruction
  if (shellTask) {
    lines.push(`## Read-Only Mode
The user gave you a direct shell command. Use the \`shell_run\` tool to execute it, read the output, and call \`done\`. Do NOT read files or search the codebase unless the output clearly requires it. This task does not involve writing code or modifying files.`);
  }

  if (matchedSkills && matchedSkills.length > 0) {
    const skillSection = matchedSkills
      .map(s => `## Skill: ${s.manifest.trigger ?? s.manifest.name}\n${s.body}`)
      .join("\n\n");
    lines.push(`## Available Skills\n${skillSection}`);
  }

  if (contextBundle.primaryFiles.length > 0 || contextBundle.tests.length > 0 || contextBundle.supportingFiles.length > 0) {
    lines.push(renderContextBundleForPrompt(contextBundle));
  }

  if (approvedPlanContent) {
    lines.push(`## Approved Plan
${approvedPlanContent}`);
  }

  if (memoryStats) {
    lines.push(`## Memory Stats\n${memoryStats}`);
  }

  if (memoryContext) {
    lines.push(`## Memory\n${memoryContext}`);
  }

  const SYSTEM_PROMPT = lines.join("\n\n");

  // Get hooks
  const { discoverHooks } = await import("../hooks/discover.js");
  const hooks = await discoverHooks(cwd);

  // Build task loop deps
  const taskLoopDeps: TaskLoopDeps = {
    config: {
      model: {
        provider: ctx.config.model.provider,
        name: ctx.config.model.name,
        streaming: ctx.config.model.streaming ?? false,
      },
      permissions: {
        sessionMode: ctx.config.permissions.sessionMode,
      },
      skills: ctx.config.skills,
    },
    provider: ctx.provider,
    providerTools,
    mcpToolIndex,
    messages: (ctx as any)._resumedMessages ?? [{ role: "user" as const, content: task }],
    sessionState,
    stateMachine,
    scope: (ctx as any)._restoredScope ?? ctx.scope,
    session,
    log: ctx.log,
    executor: ctx.toolExecutor,
    mcpDiscovery,
    selectedTools,
    hooks,
    maxIterations: cappedIterations,
    MAX_CONTEXT_TOKENS,
    encoding,
    task,
    taskType,
    depth,
    readOnly: readOnlyTask,
    shellTask,
    memoryStore: ctx.memoryStore,
    sessionId: ctx.sessionId,
    sessionDir: ctx.sessionDir,
    systemPrompt: SYSTEM_PROMPT,
    onStream,
    hookRunner: ctx.hookRunner,
  };

  return await runTaskLoop(taskLoopDeps);
}

export type { RunOpts, RunResult } from "../run.js";