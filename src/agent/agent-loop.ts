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
import { getEncoding, type TokenizerName } from "../config/context-limits.js";
import { ensureEncoder } from "../utils/tokens.js";
import { buildEditFormatPolicy } from "../patch/edit-format-policy.js";
import { DEFAULT_FACTORY_CONFIG } from "../skills/dispatcher.js";
import { evictIfNeeded } from "../skills/lifecycle.js";
import { createWorkflowRun, transitionWorkflowStatus } from "../kernel/workflow-run.js";
import { toCanonicalEvent, CanonicalEventSink } from "../kernel/event-envelope.js";
import { randomUUID } from "node:crypto";
import { createSingleNodeGraph, transitionNodeStatus, transitionGraphStatus } from "../kernel/task-graph.js";
import { MinimalMetrics } from "../kernel/minimal-metrics.js";
import type { ExecutionContext } from "../observability/execution-context.js";
import { SYSTEM_PROMPT_BASE, FAILURE_REASONS, SHELL_TASK_PROMPT, READ_ONLY_MODE_PROMPT } from "./system-prompt.js";

/** Internal core — the original runTask body, wrapped by the governed
 *  `runTask` export below. Kept as a separate function so the governed
 *  wrapper (ExecutionIntent + terminal evidence) surrounds it without
 *  changing the agent-loop's internal behavior. */
async function runTaskCore(cwd: string, task: string, opts?: RunOpts, onStream?: StreamHandler): Promise<RunResult> {
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

  // Resolve context window and tokenizer from config or API
  const userOverride = ctx.config.model.maxContextTokens;
  let maxTokens: number;
  let tokenizer: TokenizerName;

  if (userOverride !== undefined) {
    maxTokens = userOverride;
    tokenizer = getEncoding(ctx.config.model.provider);
  } else {
    const { resolveModelDescriptor } = await import("../config/context-limits.js");
    const descriptor = await resolveModelDescriptor(ctx.config.model.provider, ctx.config.model.name, ctx.config.apiKeys);
    maxTokens = descriptor.contextWindowTokens;
    tokenizer = descriptor.tokenizer;
  }

  // Ensure the tiktoken encoder is genuinely loaded before any admission /
  // truncation call — the tokenizer-based estimators fall back to char/4 only
  // when the encoder was never loaded (E1). Loading here guarantees the run
  // path measures with the same estimator truncation uses.
  await ensureEncoder(tokenizer);

  const MAX_CONTEXT_TOKENS = maxTokens;
  const taskType = classifyTask(task);
  const depth = detectResearchDepth(task);
  const maxIterations = ctx.config.model.maxIterations ?? 10;

  // Shell tasks (bare commands like ls, cat) cap at 2 iterations
  const shellTask = isShellTask(task);
  const readOnlyTask = isReadOnlyTask(task) || shellTask;
  const cappedIterations = shellTask ? Math.min(maxIterations, 2) : opts?.readOnly ? Math.min(maxIterations, 4) : maxIterations;

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
  // Also skip for shell tasks — the command IS the task, no repo context needed.
  if (!opts?.skipContext) {
    const skipContext = shellTask || readOnlyTask;
    if (!skipContext) {
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
        const planResult = await runPlanPhase(ctx, contextBundle, task, opts?.planFilePath, {
          approvalMode: opts?.planApprovalMode ?? "interactive",
          gate: opts?.planApprovalGate,
        });
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
  }

  const baseTools = buildToolsForProvider(ctx.provider);
  // Filter tools based on execution mode:
  //   --read-only:  exclude alix_shell_run, include alix_delegate
  //   shell task:   only READ_ONLY_TOOL_NAMES (includes shell_run)
  //   default:      all tools
  const readOnlyToolFilter = new Set([...READ_ONLY_TOOL_NAMES].filter((n) => n !== "alix_shell_run"));
  readOnlyToolFilter.add("alix_delegate");
  const toolFilter = opts?.readOnly ? readOnlyToolFilter : shellTask ? READ_ONLY_TOOL_NAMES : null;
  const providerTools = toolFilter
    ? baseTools.filter((t) => toolFilter.has(t.name))
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
  const lines: string[] = [
    SYSTEM_PROMPT_BASE,
    `## Workspace\nYou are working in: \`${cwd}\`. All file paths are relative to this directory.`,
  ];

  // For shell tasks (bare commands like ls, cat), inject a mode instruction
  if (shellTask) {
    lines.push(SHELL_TASK_PROMPT);
  }

  // For --read-only flag, inject a stricter mode instruction
  if (opts?.readOnly) {
    lines.push(READ_ONLY_MODE_PROMPT);
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
  // Build execution context for diagnostic correlation
  const runId = `run-${randomUUID().slice(0, 8)}`;
  const taskContext: ExecutionContext = {
    runId,
    sessionId: ctx.sessionId,
    workflowId: wfRun.id,
    providerId: ctx.config.model.provider,
    model: ctx.config.model.name,
    parentRunId: opts?.parentRunId,
  };

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
    tokenizer,
    task,
    taskType,
    depth,
    readOnly: opts?.readOnly ?? readOnlyTask,
    shellTask,
    memoryStore: ctx.memoryStore,
    sessionId: ctx.sessionId,
    sessionDir: ctx.sessionDir,
    systemPrompt: SYSTEM_PROMPT,
    onStream,
    hookRunner: ctx.hookRunner,
    context: taskContext,
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

  return { ...result, runId };
}

/**
 * Governed entry point for running a task (spec #404).
 *
 * Wraps the internal `runTaskCore` with the ExecutionIntent lifecycle:
 *   - Creates an immutable ExecutionIntent for the task BEFORE execution.
 *   - Runs the core (unchanged behavior).
 *   - Emits terminal evidence (SUCCESS or FAILED) to the X3b evidence store
 *     in a `finally`, so success AND failure both persist a record.
 *
 * The signature is unchanged from the original `runTask` — all callers
 * (research, daemon, session, route-executor) are unaffected. Evidence
 * persistence is fire-and-forget and never stalls the task.
 */
export async function runTask(
  cwd: string,
  task: string,
  opts?: RunOpts,
  onStream?: StreamHandler,
): Promise<RunResult> {
  // Create the canonical ExecutionIntent BEFORE execution begins.
  const { createExecutionIntent } = await import("../runtime/execution-intent-factory.js");
  const { createIntentId } = await import("../runtime/contracts/execution-intent-contract.js");
  const { PersistenceEvidenceEmitter } = await import("../runtime/execution-persistence.js");
  const { ExecutionEvidenceStore } = await import("../runtime/execution-evidence-store.js");

  const now = new Date().toISOString();
  const intent = createExecutionIntent(
    { kind: "agent", task, diagnostic: { classification: "workspace_action", route: "agent", reason: "runTask" } },
    { actor: "system", now },
  );
  // Evidence store lives under the working dir, like the session path.
  const store = new ExecutionEvidenceStore(join(cwd, ".alix", "governance"));
  const emitter = new PersistenceEvidenceEmitter(store);

  // CREATED evidence.
  emitRunEvidence(intent.intentId, "ExecutionCreated", "SUCCESS", `Execution created for task: ${task.slice(0, 80)}`, emitter, now);

  try {
    const result = await runTaskCore(cwd, task, opts, onStream);
    // SUCCESS terminal evidence.
    emitRunEvidence(intent.intentId, "ExecutionCompleted", "SUCCESS", (result.summary ?? task).slice(0, 200), emitter, now);
    return result;
  } catch (err) {
    // FAILED terminal evidence.
    emitRunEvidence(intent.intentId, "ExecutionFailed", "FAILED", err instanceof Error ? err.message : String(err), emitter, now);
    throw err;
  }
}

/** Emit one governed run evidence record (fire-and-forget, never throws). */
export function emitRunEvidence(
  intentId: string,
  eventType: "ExecutionCreated" | "ExecutionCompleted" | "ExecutionFailed",
  outcome: "SUCCESS" | "FAILED",
  summary: string,
  emitter: { emit(type: unknown, evidence: unknown): void },
  startedAt: string,
): void {
  try {
    emitter.emit(eventType, {
      evidenceId: `ev_${intentId}_${eventType}`,
      intentId,
      startedAt,
      completedAt: new Date().toISOString(),
      outcome,
      summary,
      artifacts: [],
      verificationPassed: outcome === "SUCCESS",
      evidenceHash: "",
    });
  } catch {
    // Evidence must never stall a task run.
  }
}

export type { RunOpts, RunResult } from "../run.js";