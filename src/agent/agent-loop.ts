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
import { ContextCompiler, type ContextBundle } from "../repomap/context-compiler.js";
import { TOOL_NAME_MAP } from "../agents/tool-name-map.js";
import type { NormalizedMessage } from "../providers/types.js";
import { getEncoding } from "../config/context-limits.js";
import { buildEditFormatPolicy } from "../patch/edit-format-policy.js";
import { DEFAULT_FACTORY_CONFIG } from "../skills/dispatcher.js";
import { evictIfNeeded } from "../skills/lifecycle.js";
import { createWorkflowRun, transitionWorkflowStatus } from "../kernel/workflow-run.js";
import { toCanonicalEvent, CanonicalEventSink } from "../kernel/event-envelope.js";
import { randomUUID } from "node:crypto";
import { createSingleNodeGraph, transitionNodeStatus, transitionGraphStatus } from "../kernel/task-graph.js";
import { MinimalMetrics } from "../kernel/minimal-metrics.js";

export async function runTask(cwd: string, task: string, opts?: RunOpts, onStream?: StreamHandler): Promise<RunResult> {
  const metrics = new MinimalMetrics();
  metrics.increment("workflow_runs_total", { goal: task.slice(0, 50) });

  const ctx = await initAgent(cwd, { cwd, task, sessionId: opts?.sharedSession?.sessionId, sessionDir: opts?.sharedSession?.sessionDir, sharedSession: opts?.sharedSession, sessionMode: opts?.sessionMode });

  const session = { sessionId: ctx.sessionId, actor: "system" as const };

  // Create WorkflowRun for this task
  const wfRun = createWorkflowRun(ctx.sessionId, task);
  const wfMeta = { workflowId: wfRun.id };
  const canonicalSink = new CanonicalEventSink();

  await ctx.log.append({
    ...session,
    type: "workflow.created",
    actor: "system",
    payload: { workflowId: wfRun.id, goal: task, mode: wfRun.mode },
    meta: wfMeta,
  });

  await canonicalSink.emit(toCanonicalEvent(
    { id: randomUUID(), seq: 0, version: 1, sessionId: ctx.sessionId, timestamp: new Date().toISOString(), type: "workflow.created" as const, actor: "system" as const, payload: { workflowId: wfRun.id }, meta: wfMeta },
    wfMeta,
  ));

  // Create single-node TaskGraph for this task
  const { graph: taskGraph, node: taskNode } = createSingleNodeGraph(wfRun.id, task);
  const graphMeta = { ...wfMeta, graphId: taskGraph.id, nodeId: taskNode.id };

  await ctx.log.append({
    ...session, type: "graph.created", actor: "system",
    payload: { graphId: taskGraph.id, workflowId: wfRun.id, nodeCount: 1 },
    meta: graphMeta,
  });

  await ctx.log.append({
    ...session, type: "task.ready", actor: "system",
    payload: { nodeId: taskNode.id, graphId: taskGraph.id, goal: task },
    meta: graphMeta,
  });

  // Resume path — reconstruct state from a prior session
  if (opts?.resumeSessionId) {
    const { reconstructSession } = await import("../session/resume.js");
    const reconstructed = await reconstructSession(cwd, opts.resumeSessionId);

    if (reconstructed.completed) {
      const completedRun = transitionWorkflowStatus(wfRun, "completed");
      await ctx.log.append({
        ...session, type: "workflow.completed", actor: "system",
        payload: { workflowId: wfRun.id, summary: `Session ${opts.resumeSessionId} is already completed. Use a different session or start a new task.` },
        meta: wfMeta,
      });
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
  let skillCatalog: any = null;
  if (!opts?.disableSkillFactory) {
    const skillsHome = join(process.env.HOME ?? "", ".alix", "skills");
    const { loadSkillManifests } = await import("../skills/loader.js");
    const { buildSkillCatalog } = await import("../skills/catalog.js");
    const skillManifests = await loadSkillManifests(skillsHome);
    skillCatalog = buildSkillCatalog(skillManifests);

    // Enforce store limits
    const { evictIfNeeded: evict } = await import("../skills/lifecycle.js");
    const { maxStore, maxCandidates } = ctx.config.skills?.factory ?? DEFAULT_FACTORY_CONFIG;
    evict(skillsHome, { maxStore, maxCandidates: maxCandidates ?? 200 });
  }

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

  let approvedPlanContent: string | undefined;
  let contextBundle: ContextBundle | undefined;

  // Skip context compilation & plan phase on subsequent TUI prompts
  // (context was compiled on the first prompt; tool state is unchanged)
  if (!opts?.skipContext) {
    const contextCompiler = new ContextCompiler({
      root: cwd,
      maxTokens: MAX_CONTEXT_TOKENS,
      eventLog: ctx.log,
      sessionId: ctx.sessionId,
    });
    await contextCompiler.warm();
    contextBundle = await contextCompiler.compileContext(task, taskType, []);
    await ctx.log.append({
      ...session,
      type: "context.bundle_compiled",
      payload: buildContextBundleEventPayload(contextBundle),
    });

    // Plan phase — only on first prompt or explicit requests
    const resumedPlan = (ctx as any)._planContent;
    if (resumedPlan) {
      approvedPlanContent = resumedPlan;
    } else if (opts?.planMode !== false) {
      const planResult = await runPlanPhase(ctx, contextBundle, task, opts?.planFilePath);
      if (planResult.action === "rejected") {
        const failedRun = transitionWorkflowStatus(wfRun, "failed");
        await ctx.log.append({
          ...session, type: "workflow.failed", actor: "system",
          payload: { workflowId: wfRun.id, summary: "Plan rejected. Task cancelled." },
          meta: wfMeta,
        });
        return { sessionId: ctx.sessionId, summary: "Plan rejected. Task cancelled.", streamed: opts?.streaming };
      }
      if (planResult.action === "approved") {
        approvedPlanContent = planResult.planContent;
      }
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
  let matchedSkills: any[] = [];
  if (skillCatalog) {
    matchedSkills = await skillCatalog.getMatchedContent(task);
  }

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

  if (contextBundle && (contextBundle.primaryFiles.length > 0 || contextBundle.tests.length > 0 || contextBundle.supportingFiles.length > 0)) {
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
    messages: (ctx as any)._resumedMessages ?? opts?.messages ?? [{ role: "user" as const, content: task }],
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

  // Emit task.started before entering the task loop
  transitionNodeStatus(taskNode, "running");
  transitionGraphStatus(taskGraph, "running");
  await ctx.log.append({
    ...session, type: "task.started", actor: "system",
    payload: { nodeId: taskNode.id, graphId: taskGraph.id },
    meta: graphMeta,
  });
  await ctx.log.append({
    ...session, type: "graph.status_changed", actor: "system",
    payload: { graphId: taskGraph.id, status: "running" },
    meta: graphMeta,
  });

  const startTime = Date.now();
  let result: RunResult;
  try {
    result = await runTaskLoop(taskLoopDeps);
  } catch (err) {
    transitionNodeStatus(taskNode, "failed");
    transitionGraphStatus(taskGraph, "failed");
    await ctx.log.append({
      ...session, type: "task.failed", actor: "system",
      payload: { nodeId: taskNode.id, graphId: taskGraph.id, error: String(err) },
      meta: graphMeta,
    });
    await ctx.log.append({
      ...session, type: "graph.failed", actor: "system",
      payload: { graphId: taskGraph.id, workflowId: wfRun.id, summary: String(err) },
      meta: graphMeta,
    });
    const failedRun = transitionWorkflowStatus(wfRun, "failed");
    await ctx.log.append({
      ...session, type: "workflow.failed", actor: "system",
      payload: { workflowId: wfRun.id, summary: String(err) },
      meta: wfMeta,
    });
    throw err;
  }

  const FAILURE_REASONS = new Set(["max_iterations", "max_repairs", "rejected_scope_expansion"]);
  const isFailed = FAILURE_REASONS.has(result.reason ?? "");
  if (isFailed) {
    transitionNodeStatus(taskNode, "failed");
    transitionGraphStatus(taskGraph, "failed");
    const failedRun = transitionWorkflowStatus(wfRun, "failed");
    await ctx.log.append({ ...session, type: "task.failed", actor: "system", payload: { nodeId: taskNode.id, graphId: taskGraph.id, reason: result.reason, summary: result.summary }, meta: graphMeta });
    await ctx.log.append({ ...session, type: "graph.failed", actor: "system", payload: { graphId: taskGraph.id, workflowId: wfRun.id, reason: result.reason, summary: result.summary }, meta: graphMeta });
    await ctx.log.append({ ...session, type: "workflow.failed", actor: "system", payload: { workflowId: wfRun.id, reason: result.reason, summary: result.summary }, meta: wfMeta });
  } else {
    transitionNodeStatus(taskNode, "done");
    transitionGraphStatus(taskGraph, "completed");
    const completedRun = transitionWorkflowStatus(wfRun, "completed");
    await ctx.log.append({ ...session, type: "task.done", actor: "system", payload: { nodeId: taskNode.id, graphId: taskGraph.id, summary: result.summary }, meta: graphMeta });
    await ctx.log.append({ ...session, type: "graph.completed", actor: "system", payload: { graphId: taskGraph.id, workflowId: wfRun.id, summary: result.summary }, meta: graphMeta });
    await ctx.log.append({ ...session, type: "workflow.completed", actor: "system", payload: { workflowId: wfRun.id, summary: result.summary }, meta: wfMeta });
  }

  // Flush minimal metrics
  metrics.duration("workflow_duration_ms", Date.now() - startTime);
  const metricEvents = metrics.flush();
  for (const m of metricEvents) {
    await ctx.log.append({ ...session, actor: "system", type: "m09.metric", payload: m });
  }

  return result;
}

export type { RunOpts, RunResult } from "../run.js";