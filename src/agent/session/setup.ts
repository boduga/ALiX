// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Agent Session — shared session engine for run, run --chat, and tui.
 *
 * P1: One session = one logical conversation/task, potentially spanning
 * multiple user turns. First turn includes full setup (agent init, graph,
 * context, plan). Subsequent turns reuse the session and accumulate messages.
 *
 * @module agent-session
 */

import "node:crypto";
import "node:fs";
import "node:path";
import "node:path";
import { homedir } from "node:os";
import "node:url";
import "../../events/event-log.js";

import type { NormalizedMessage, ToolDef } from "../../providers/types.js";
import type { AgentContext } from "../agent.js";
import type { TaskType } from "../../task-classifier.js";
import type { WorkflowRun } from "../../kernel/workflow-run.js";
import type { TaskGraph, TaskNode } from "../../kernel/task-graph.js";
import type { ContextBundle } from "../../repomap/context-compiler.js";
import type { DeferredToolEntry } from "../../mcp/tool-deferral.js";
import type { ExecutionContext } from "../../observability/execution-context.js";
import "../../tracing/noop-client.js";
import { initAgent } from "../agent.js";
import "../run-root.js";
import "../../run/task-loop.js";
import "../../providers/registry.js";
import "../../runtime/task-router.js";
import "../../runtime/governed-route-executor.js";
import "../../runtime/task-router.js";
import { createWorkflowRun } from "../../kernel/workflow-run.js";
import { createSingleNodeGraph } from "../../kernel/task-graph.js";
import {
  classifyTask,
  detectResearchDepth,
  isReadOnlyTask,
  isShellTask,
} from "../../task-classifier.js";
import {
  buildToolsForProvider,
  buildContextBundleEventPayload,
  renderContextBundleForPrompt,
} from "../messages.js";
import { ContextCompiler } from "../../repomap/context-compiler.js";
import {
  buildMemoryContext,
  buildMemoryStats,
} from "../../utils/memory/recall.js";
import { getEncoding, type TokenizerName } from "../../config/context-limits.js";
import "../../config/model-resolver.js";
import { createContextBudget, DEFAULT_OUTPUT_CAP, type ContextBudget, type ContextBudgetConfig } from "../../config/context-budget.js";
import { ensureEncoder } from "../../utils/tokens.js";
import { DEFAULT_FACTORY_CONFIG } from "../../skills/dispatcher.js";
import { evictIfNeeded } from "../../skills/lifecycle.js";
import type { SkillEntry } from "../../skills/catalog.js";
import { ToolSelector } from "../../mcp/tool-selector.js";
import { ToolDiscovery } from "../../mcp/tool-discovery.js";
import { TOOL_NAME_MAP } from "../../agents/tool-name-map.js";
import { READ_ONLY_TOOL_NAMES } from "../../run/helpers.js";
import { MinimalMetrics } from "../../kernel/minimal-metrics.js";
import type { PlanTask } from "../../planning/plan-task.js";
import { SYSTEM_PROMPT_BASE, SHELL_TASK_PROMPT, READ_ONLY_MODE_PROMPT } from "../system-prompt.js";
import { AgentSessionBuilder } from "./main.js";
import { AgentSession, AgentSessionConfig } from "./types.js";

export async function setupSession(
  cwd: string,
  task: string,
  opts?: {
    sessionId?: string;
    sessionMode?: "auto" | "ask" | "bypass";
    approvalStore?: import("../../approvals/approval-store.js").ApprovalStore;
    suppressConfigWarnings?: boolean;
  },
): Promise<{ ctx: AgentContext; metrics: MinimalMetrics }> {
  const metrics = new MinimalMetrics();
  metrics.increment("workflow_runs_total", { goal: task.slice(0, 50) });
  const ctx = await initAgent(cwd, {
    cwd,
    task,
    sessionId: opts?.sessionId,
    sessionMode: opts?.sessionMode,
    approvalStore: opts?.approvalStore,
    suppressConfigWarnings: opts?.suppressConfigWarnings,
  });
  return { ctx, metrics };
}

/**
 * P1: WorkflowRun + TaskGraph setup.
 */
export async function setupWorkflow(
  ctx: AgentContext,
  sessionId: string,
  task: string,
): Promise<{
  wfRun: WorkflowRun;
  taskGraph: TaskGraph;
  taskNode: TaskNode;
  wfMeta: Record<string, string>;
  graphMeta: Record<string, string>;
}> {
  const session = { sessionId, actor: "system" as const };
  const wfRun = createWorkflowRun(sessionId, task);
  const wfMeta = { sessionId, workflowId: wfRun.id };
  await ctx.log.append({
    ...session,
    type: "workflow.created",
    actor: "system",
    payload: { workflowId: wfRun.id, goal: task, mode: wfRun.mode },
    meta: wfMeta,
  });
  const graphResult = createSingleNodeGraph(wfRun.id, task);
  const taskGraph = graphResult.graph;
  const taskNode = graphResult.node;
  const graphMeta = { ...wfMeta, graphId: taskGraph.id, nodeId: taskNode.id };
  await ctx.log.append({
    ...session,
    type: "graph.created",
    actor: "system",
    payload: { graphId: taskGraph.id, workflowId: wfRun.id, nodeCount: 1 },
    meta: graphMeta,
  });
  await ctx.log.append({
    ...session,
    type: "task.ready",
    actor: "system",
    payload: { nodeId: taskNode.id, graphId: taskGraph.id, goal: task },
    meta: graphMeta,
  });
  return { wfRun, taskGraph, taskNode, wfMeta, graphMeta };
}

/**
 * P2: Resume from prior session.
 */
export async function setupResume(
  _ctx: AgentContext,
  cwd: string,
  resumeSessionId: string,
): Promise<{
  completed: boolean;
  currentTask?: string;
  resumedMessages?: readonly NormalizedMessage[];
  scopeSnapshot?: any;
  stateSnapshot?: any;
  planContent?: string;
  planTasks?: readonly PlanTask[];
}> {
  const { reconstructSession } = await import("../../session/resume.js");
  const reconstructed = await reconstructSession(cwd, resumeSessionId);

  if (reconstructed.completed) {
    return { completed: true };
  }

  const originalTask = reconstructed.messages.find((m) => m.role === "user");
  const newTask =
    originalTask && typeof originalTask.content === "string"
      ? originalTask.content
      : undefined;

  return {
    completed: false,
    currentTask: newTask,
    resumedMessages: reconstructed.messages,
    scopeSnapshot: reconstructed.scopeSnapshot,
    stateSnapshot: reconstructed.stateSnapshot,
    planContent: reconstructed.planContent ?? undefined,
    planTasks: reconstructed.planTasks,
  };
}

/**
 * P3: Build memory context/stats.
 */
export async function setupMemory(
  memoryStore: any,
): Promise<{
  memoryContext: string | undefined;
  memoryStats: string | undefined;
}> {
  const [memoryContext, memoryStats] = await Promise.all([
    buildMemoryContext(memoryStore),
    buildMemoryStats(memoryStore),
  ]);
  return { memoryContext, memoryStats };
}

/**
 * Resolve explicit skill names (slash-command injection) to body-loaded
 * `LoadedSkill[]`. Per-name resolution is NON-FATAL (missing → warn + skip),
 * but body loading is TRANSACTIONAL: any rejection from `Promise.all`
 * drops the WHOLE explicit set — never a half-injected subset.
 *
 * Pure helper — does no auto-matching (that's `setupSkills`' job). Re-used
 * by the per-turn path in `processTurn` so direct routes and subsequent
 * turns of an initialized session can splice explicit skills into their
 * own system prompts without re-running the full initialize() pipeline.
 */
export async function resolveExplicitSkills(
  explicitSkills?: string[],
  projectDir?: string | null,
): Promise<any[]> {
  if (!explicitSkills || explicitSkills.length === 0) return [];
  try {
    const { loadDiscoveredSkillManifests } = await import("../../skills/discovery.js");
    const { loadSkillContent } = await import("../../skills/loader.js");
    const { buildSkillCatalog } = await import("../../skills/catalog.js");
    const skillManifests = await loadDiscoveredSkillManifests(homedir(), projectDir);
    const skillCatalog = buildSkillCatalog(skillManifests);
    const entries: SkillEntry[] = [];
    for (const ref of explicitSkills) {
      const entry = skillCatalog.getByTriggerOrName(ref);
      if (!entry) {
        console.warn(`Skill "${ref}" isn't installed. Continuing without it.`);
        continue;
      }
      entries.push(entry);
    }
    try {
      const loaded = await Promise.all(
        entries.map(async (e) => {
          const content = await loadSkillContent(e.path);
          return content ? { manifest: content.manifest, body: content.body, path: e.path } : null;
        }),
      );
      const out: any[] = [];
      for (const s of loaded) if (s) out.push(s);
      return out;
    } catch {
      // Transactional: any body-load failure drops the WHOLE explicit set —
      // never a half-injected subset.
      return [];
    }
  } catch {
    return [];
  }
}

/**
 * P4: Skills catalog (best-effort; failures are non-fatal).
 *
 * Merged union: explicit skill names (slash-command injection) ADD to,
 * never replace, automatic matching. Union → dedupe by `canonicalSkillId`
 * (the SOLE dedup authority) → inject. Explicit body loading is
 * transactional: per-name resolution is non-fatal (missing → warn + skip),
 * but any body-load failure drops the ENTIRE explicit set (never a
 * half-injected subset). The explicit-resolution step is delegated to
 * `resolveExplicitSkills` so per-turn paths can reuse it without going
 * through this union helper.
 *
 * `opts.autoMatch === false` skips automatic matching (used by callers that
 * want purely explicit injection; the chat path never passes skills at all).
 */
export async function setupSkills(
  task: string,
  factoryConfig?: { maxStore: number; maxCandidates: number },
  explicitSkills?: string[],
  opts?: { autoMatch?: boolean; projectDir?: string | null },
): Promise<any[]> {
  try {
    const { loadDiscoveredSkillManifests, getAlixSkillsDir } = await import("../../skills/discovery.js");
    const { buildSkillCatalog } = await import("../../skills/catalog.js");
    const { canonicalSkillId } = await import("../../skills/slash.js");
    const skillManifests = await loadDiscoveredSkillManifests(homedir(), opts?.projectDir);
    const skillCatalog = buildSkillCatalog(skillManifests);
    const { maxStore, maxCandidates } = factoryConfig ?? DEFAULT_FACTORY_CONFIG;
    evictIfNeeded(getAlixSkillsDir(homedir()), {
      maxStore,
      maxCandidates: maxCandidates ?? 200,
    });

    // Explicit: resolve per-name (non-fatal), load transactionally (all-or-nothing).
    const explicit = await resolveExplicitSkills(explicitSkills, opts?.projectDir);

    // Auto-match (preserved; skipped when the caller opts out, e.g. chat path).
    const autoMatched = opts?.autoMatch === false ? [] : await skillCatalog.getMatchedContent(task);

    // Union → dedupe by canonicalSkillId (explicit body wins on duplicate).
    const byId = new Map<string, any>();
    for (const s of [...explicit, ...autoMatched]) {
      byId.set(canonicalSkillId(s.manifest), s);
    }
    return [...byId.values()];
  } catch {
    return [];
  }
}

/**
 * P5: Context token limits + task classification.
 */
export async function resolveDirectOutputCeiling(
  chatModel: { provider: string; model?: string } | undefined,
  chatApiKey?: string,
): Promise<number> {
  // Direct/chat routes hardcoded maxOutputTokens at 512, which truncated
  // long generation tasks (e.g. a 5-part stress prompt cut mid-sentence at
  // ~512 tokens) even though the resolved context budget allows far more.
  // Derive the output ceiling from the same budget math as the agent loop
  // (`setupContextLimits` → `createContextBudget`) so direct and chat route
  // answers get the full budgeted output the model can provide.
  if (!chatModel) return 512;
  const { resolveModelDescriptor } = await import("../../config/context-limits.js");
  try {
    const descriptor = await resolveModelDescriptor(
      chatModel.provider,
      chatModel.model ?? "",
      chatApiKey ? { [chatModel.provider]: chatApiKey } : undefined,
    );
    // DeepSeek accepts output budgets far above the generic 32,768 cap
    // (verified against api.deepseek.com: 100k–300k `max_tokens` honored;
    // the model streams reasoning + content inside a single budget, so a
    // long answer cut at 32k was silently truncated mid-part). Keep the
    // generic cap for other providers, whose APIs often reject `max_tokens`
    // above their own much smaller ceiling (e.g. gpt-4o).
    if (chatModel.provider === "deepseek") {
      return createContextBudget(descriptor, { outputCap: 131_072 }).requestedMaxOutputTokens;
    }
    return createContextBudget(descriptor).requestedMaxOutputTokens;
  } catch {
    return 512;
  }
}

/**
 * P5: Context token limits + task classification.
 */
export async function setupContextLimits(
  modelConfig: {
    provider: string;
    name: string;
    maxContextTokens?: number;
    maxIterations?: number;
  },
  apiKeys?: any,
  task?: string,
  readOnly?: boolean,
  budgetConfig?: ContextBudgetConfig,
): Promise<{
  contextBudget: ContextBudget;
  tokenizer: TokenizerName;
  taskType: TaskType;
  depth: "quick" | "deep";
  shellTask: boolean;
  readOnlyTask: boolean;
  cappedIterations: number;
}> {
  const userOverride = modelConfig.maxContextTokens;
  let contextBudget: ContextBudget;
  let tokenizer: TokenizerName;
  const budgetOptions: ContextBudgetConfig = budgetConfig ?? {};
  // DeepSeek accepts output budgets far above the generic 32,768 cap (verified
  // against api.deepseek.com: 100k–300k `max_tokens` honored; reasoning +
  // content share the budget, so long answers were silently truncated at 32k).
  // Only elevate when the user hasn't set their own cap.
  if (
    modelConfig.provider === "deepseek" &&
    (budgetOptions.outputCap === undefined || budgetOptions.outputCap === DEFAULT_OUTPUT_CAP)
  ) {
    budgetOptions.outputCap = 131_072;
  }
  if (userOverride !== undefined) {
    contextBudget = createContextBudget({ contextWindowTokens: userOverride }, budgetOptions);
    tokenizer = getEncoding(modelConfig.provider);
  } else {
    const { resolveModelDescriptor } = await import("../../config/context-limits.js");
    const descriptor = await resolveModelDescriptor(
      modelConfig.provider,
      modelConfig.name,
      apiKeys,
    );
    tokenizer = descriptor.tokenizer;
    contextBudget = createContextBudget(descriptor, budgetOptions);
  }

  // Ensure the tiktoken encoder is genuinely loaded before any admission /
  // truncation call in the task loop — the tokenizer-based estimators fall
  // back to char/4 only when the encoder was never loaded (E1).
  await ensureEncoder(tokenizer);

  const effectiveTask = task || "Interactive coding session";
  const taskType = classifyTask(effectiveTask);
  const depth = detectResearchDepth(effectiveTask);
  const maxIter = modelConfig.maxIterations ?? 25;
  const shellTask = isShellTask(effectiveTask);
  const readOnlyTask = isReadOnlyTask(effectiveTask) || shellTask;
  const cappedIterations = shellTask
    ? Math.min(maxIter, 2)
    : readOnly
      ? Math.min(maxIter, 4)
      : maxIter;

  return {
    contextBudget,
    tokenizer,
    taskType,
    depth,
    shellTask,
    readOnlyTask,
    cappedIterations,
  };
}

/**
 * P6: Context compilation + Plan phase.
 */
export async function setupContextAndPlan(
  ctx: AgentContext,
  cwd: string,
  contextBudget: ContextBudget,
  task: string,
  taskType: TaskType,
  sessionId: string,
  opts?: {
    planMode?: boolean;
    planFilePath?: string;
    planApprovalMode?: "interactive" | "deferred";
    planApprovalGate?: any;
    /** Run identity → plan-phase provider request (model spans, R1/§18). */
    context?: ExecutionContext;
  },
): Promise<{
  contextBundle?: ContextBundle;
  planRejected?: boolean;
  approvedPlanContent?: string;
  approvedPlanTasks?: readonly PlanTask[];
}> {
  const contextCompiler = new ContextCompiler({
    root: cwd,
    maxTokens: contextBudget.availableInputTokens,
    eventLog: ctx.log,
    sessionId,
  });
  await contextCompiler.warm();
  const contextBundle = await contextCompiler.compileContext(
    task,
    taskType,
    [],
  );
  await ctx.log.append({
    sessionId,
    actor: "system",
    type: "context.bundle_compiled",
    payload: buildContextBundleEventPayload(contextBundle),
  });

  if (opts?.planMode === false) {
    return { contextBundle };
  }

  const { runPlanPhase } = await import("../../run/plan-phase.js");
  const planResult = await runPlanPhase(
    ctx,
    contextBundle,
    task,
    opts?.planFilePath,
    {
      approvalMode: opts?.planApprovalMode ?? "interactive",
      gate: opts?.planApprovalGate,
      context: opts?.context,
    },
  );

  if (planResult.action === "rejected") {
    return { contextBundle, planRejected: true };
  }

  return {
    contextBundle,
    planRejected: false,
    approvedPlanContent: planResult.planContent,
    approvedPlanTasks: planResult.planTasks,
  };
}

/**
 * P7: Tool setup.
 */
export async function setupTools(
  ctx: AgentContext,
  task: string,
  readOnly?: boolean,
  shellTask?: boolean,
): Promise<{
  providerTools: ToolDef[];
  mcpToolIndex: DeferredToolEntry[];
  selectedTools: DeferredToolEntry[];
  mcpDiscovery: ToolDiscovery | null;
}> {
  const baseTools = buildToolsForProvider(ctx.provider);
  const toolFilter = readOnly
    ? new Set([...READ_ONLY_TOOL_NAMES].filter((n) => n !== "alix_shell_run"))
    : shellTask
      ? READ_ONLY_TOOL_NAMES
      : null;
  const providerTools = toolFilter
    ? baseTools.filter((t) => toolFilter.has(t.name))
    : baseTools;

  const mcpDeferral = ctx.mcpManager?.getDeferral();
  const mcpToolIndex = mcpDeferral?.buildIndex() ?? [];
  const toolSelector = new ToolSelector(mcpToolIndex, {
    maxTools: 20,
    tokenBudget: 3000,
  });
  const selectedTools = toolSelector.select(task);
  const mcpDiscovery = ctx.mcpManager ? new ToolDiscovery(mcpToolIndex) : null;
  for (const entry of selectedTools) {
    TOOL_NAME_MAP[entry.name] = entry.execName;
  }

  return { providerTools, mcpToolIndex, selectedTools, mcpDiscovery };
}

/** Render the "Available Skills" system-prompt section, or "" for none. */
export function buildSkillsSection(skills: any[]): string {
  if (skills.length === 0) return "";
  const skillSection = skills
    .map((s: any) => `## Skill: ${s.manifest.trigger ?? s.manifest.name}\n${s.body}`)
    .join("\n\n");
  return `## Available Skills\n${skillSection}`;
}

/**
 * Replace (or strip) the "## Available Skills" section in `systemPrompt` with
 * a fresh section built from `skills`. If no skills section exists and
 * `skills` is non-empty, the new section is appended.
 *
 * Used by the per-turn paths in `processTurn`:
 *   - Direct routes: the hardcoded "Answer concisely." prompt has no skills
 *     section; the splice APPENDS one when explicit skills are present.
 *   - Subsequent turns on an initialized session: the system prompt was
 *     built in `initialize()` with the first turn's skills section; the
 *     splice REPLACES it with `firstTurnMatchedSkills + currentTurnExplicit`
 *     (deduped upstream) so first-turn auto-matched skills are preserved
 *     and current-turn explicit skills are injected.
 *
 * Section boundaries are detected via the `## Available Skills` start marker
 * and the next top-level `## ` section header (markdown level-2 headings).
 * Sub-headers inside the skills section (`## Skill: /name`) are NOT treated
 * as section boundaries.
 */
export function spliceSkillsSection(systemPrompt: string, skills: any[]): string {
  const newSection = buildSkillsSection(skills);
  if (skills.length === 0) {
    // Strip any existing skills section.
    return stripSkillsSection(systemPrompt);
  }
  // If no existing section, append.
  const startIdx = systemPrompt.indexOf("## Available Skills");
  if (startIdx === -1) {
    return systemPrompt.replace(/\s+$/, "") + "\n\n" + newSection;
  }
  // Find the end of the skills section: the next top-level `## ` header at
  // line start, or end-of-string. `## Skill: ` (skill sub-headers inside the
  // section) and `## Available Skills` (the start marker) are NOT section
  // boundaries.
  let endIdx = systemPrompt.length;
  const tail = systemPrompt.slice(startIdx);
  const nextSection = tail.match(/\n## (?!Available Skills\b|Skill: )/);
  if (nextSection && nextSection.index !== undefined) {
    endIdx = startIdx + nextSection.index;
  }
  const before = systemPrompt.slice(0, startIdx).replace(/\n+$/, "");
  const after = systemPrompt.slice(endIdx);
  // Rejoin: before + newSection + (after, if any).
  if (after.length === 0) {
    return before + "\n\n" + newSection;
  }
  return before + "\n\n" + newSection + "\n\n" + after.replace(/^\n+/, "");
}

/** Internal helper: strip the "## Available Skills" section if present. */
export function stripSkillsSection(systemPrompt: string): string {
  const startIdx = systemPrompt.indexOf("## Available Skills");
  if (startIdx === -1) return systemPrompt;
  let endIdx = systemPrompt.length;
  const tail = systemPrompt.slice(startIdx);
  const nextSection = tail.match(/\n## (?!Available Skills\b|Skill: )/);
  if (nextSection && nextSection.index !== undefined) {
    endIdx = startIdx + nextSection.index;
  }
  const before = systemPrompt.slice(0, startIdx).replace(/\n+$/, "");
  const after = systemPrompt.slice(endIdx).replace(/^\n+/, "");
  if (after.length === 0) return before + "\n";
  return before + "\n\n" + after;
}

/**
 * Merge `currentTurnExplicit` with `firstTurnMatchedSkills` for the
 * subsequent-turn splice in `processTurn`:
 *   - First-turn AUTO-matched skills are preserved.
 *   - First-turn EXPLICIT skills are replaced by `currentTurnExplicit`
 *     (subtract by canonical-id, then add current-turn).
 *   - If a current-turn explicit skill has the same canonical id as a
 *     first-turn explicit, it wins (it's the current value).
 *   - Dedupe is by `canonicalSkillId` (the SOLE dedup authority).
 *
 * Exported for direct testing of the dedupe logic.
 */
export async function spliceExplicitIntoFirstTurn(
  firstTurnMatchedSkills: any[],
  firstTurnExplicitSkills: any[],
  currentTurnExplicit: any[],
): Promise<any[]> {
  const { canonicalSkillId } = await import("../../skills/slash.js");
  const explicitIds = new Set(
    firstTurnExplicitSkills.map((s) => canonicalSkillId(s.manifest)),
  );
  // Keep only first-turn skills that are NOT first-turn explicit (i.e., the
  // auto-matched subset of firstTurnMatchedSkills).
  const autoOnlyFromFirstTurn = firstTurnMatchedSkills.filter(
    (s) => !explicitIds.has(canonicalSkillId(s.manifest)),
  );
  // Union: autoOnlyFromFirstTurn + currentTurnExplicit, deduped by canonical id.
  const byId = new Map<string, any>();
  for (const s of [...autoOnlyFromFirstTurn, ...currentTurnExplicit]) {
    byId.set(canonicalSkillId(s.manifest), s);
  }
  return [...byId.values()];
}

/**
 * P8: System prompt assembly.
 */
export async function setupSystemPrompt(
  cwd: string,
  opts: {
    readOnly?: boolean;
    shellTask: boolean;
    matchedSkills: any[];
    contextBundle?: ContextBundle;
    approvedPlanContent?: string;
    memoryContext?: string;
    memoryStats?: string;
  },
): Promise<string> {
  const lines: string[] = [
    SYSTEM_PROMPT_BASE,
    `## Workspace\nYou are working in: \`${cwd}\`. All file paths are relative to this directory.`,
  ];

  if (opts.shellTask) {
    lines.push(SHELL_TASK_PROMPT);
  }

  if (opts.readOnly) {
    lines.push(READ_ONLY_MODE_PROMPT);
  }

  if (opts.matchedSkills.length > 0) {
    lines.push(buildSkillsSection(opts.matchedSkills));
  }

  if (
    opts.contextBundle &&
    (opts.contextBundle.primaryFiles.length > 0 ||
      opts.contextBundle.tests.length > 0 ||
      opts.contextBundle.supportingFiles.length > 0)
  ) {
    lines.push(renderContextBundleForPrompt(opts.contextBundle));
  }

  if (opts.approvedPlanContent) {
    lines.push(`## Approved Plan\n${opts.approvedPlanContent}`);
  }

  if (opts.memoryStats) {
    lines.push(`## Memory Stats\n${opts.memoryStats}`);
  }

  if (opts.memoryContext) {
    lines.push(`## Memory\n${opts.memoryContext}`);
  }

  return lines.join("\n\n");
}

/**
 * P9: Discover hooks.
 */
export async function setupHooks(cwd: string): Promise<{
  pre_task: Array<{ command: string; reason: string }>;
  post_task: Array<{ command: string; reason: string }>;
}> {
  const { discoverHooks } = await import("../../hooks/discover.js");
  const discoveredHooks = await discoverHooks(cwd);
  return {
    pre_task: (discoveredHooks.pre_task ?? []).map((h: any) => ({
      command: h.command,
      reason: h.reason,
    })),
    post_task: (discoveredHooks.post_task ?? []).map((h: any) => ({
      command: h.command,
      reason: h.reason,
    })),
  };
}

// =============================================================================
// Simplified factory — delegates to fluent builder for backward compatibility
// =============================================================================

export function createAgentSession(config: AgentSessionConfig): AgentSession {
  return new AgentSessionBuilder(config).build();
}
