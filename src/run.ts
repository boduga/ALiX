import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { loadConfig } from "./config/loader.js";
import { getEncoding } from "./config/context-limits.js";
import { EventLog } from "./events/event-log.js";
import { buildRepoMapLite } from "./repomap/repomap-lite.js";
import { ContextCompiler } from "./repomap/context-compiler.js";
import { createProvider } from "./providers/registry.js";
import type { ModelAdapter, NormalizedMessage, NormalizedRequest, ToolCall, TokenUsage, ToolDef } from "./providers/types.js";
import type { DeferredToolEntry } from "./mcp/tool-deferral.js";
import { ApiError } from "./providers/base.js";
import { ToolExecutor } from "./tools/executor.js";
import { McpManager } from "./mcp/manager.js";
import { buildSessionDigest } from "./utils/session-digest.js";
import { discoverVerification, runVerification } from "./verifier/verifier.js";
import type { VerificationCheck, VerificationResult } from "./verifier/verifier.js";
import { classifyTask } from "./task-classifier.js";
import { DEFAULT_FACTORY_CONFIG } from "./skills/dispatcher.js";
import { extractInitialScope, createScopeTracker } from "./autonomy/scope-tracker.js";
import { TaskStateMachine, RunLimiter } from "./autonomy/state-machine.js";
import type { ScopeTracker } from "./autonomy/scope-tracker.js";
import type { AgentState } from "./autonomy/scope-tracker.js";

async function streamToResponse(provider: ModelAdapter, request: NormalizedRequest): Promise<{ text: string; toolCalls: ToolCall[]; usage?: TokenUsage }> {
  if (!provider.stream) throw new Error("Provider does not support streaming");
  let text = "";
  let toolCalls: ToolCall[] = [];
  let usage: TokenUsage | undefined;
  for await (const chunk of provider.stream(request)) {
    if (chunk.type === "text_delta") text += chunk.text;
    if (chunk.type === "tool_call") toolCalls.push(chunk.toolCall);
    if (chunk.type === "usage") usage = chunk.usage;
    if (chunk.type === "error") throw new Error(chunk.error);
  }
  return { text, toolCalls, usage };
}

const TOOL_NAME_MAP: Record<string, string> = {
  alix_file_read: "file.read",
  alix_file_create: "file.create",
  alix_file_delete: "file.delete",
  alix_dir_search: "dir.search",
  alix_shell_run: "shell.run",
  alix_patch_apply: "patch.apply"
};

export function buildErrorMessage(err: { kind: "error"; message: string; retryable?: boolean; hint?: string }): string {
  const parts: string[] = [`Error: ${err.message}`];
  if (err.hint) parts.push(`Hint: ${err.hint}`);
  if (err.retryable === false) parts.push("This error is fatal — do not retry this tool.");
  else if (err.retryable === true) parts.push("This error may be transient — retrying may help.");
  return parts.join(" ");
}

/**
 * Resolve a tool name that may be misspelled or unknown.
 * Uses fuzzy search to find the closest match in the MCP tool index.
 * Returns the execName if found, or null if no match above threshold.
 */
function resolveMcpTool(mcpName: string, deferral: { search: (name: string, limit: number) => { item: { execName: string }; score: number }[] }): string | null {
  // Already in the map — fast path
  if (TOOL_NAME_MAP[mcpName]) return TOOL_NAME_MAP[mcpName];

  // Try fuzzy search — score >= 40 means edit distance ≤ ~30% of max length.
  // Below 40, the match is too uncertain (e.g., "guthu" vs "github" scores ~36).
  const matches = deferral.search(mcpName, 1);
  if (matches.length > 0 && matches[0].score >= 40) {
    const execName = matches[0].item.execName;
    TOOL_NAME_MAP[mcpName] = execName;
    return execName;
  }
  return null;
}

type SessionState = {
  created: Set<string>;
  deleted: Set<string>;
  changed: Set<string>;
  fatalErrors: string[];
};

function buildStateSummary(state: SessionState): string {
  const parts: string[] = [];
  if (state.created.size) parts.push(`Created: ${[...state.created].join(", ")}`);
  if (state.changed.size) parts.push(`Changed: ${[...state.changed].join(", ")}`);
  if (state.deleted.size) parts.push(`Deleted: ${[...state.deleted].join(", ")}`);
  if (state.fatalErrors.length) parts.push(`FATAL: ${state.fatalErrors.join("; ")}`);
  return parts.length ? `[Session Digest] ${parts.join(". ")}.` : "";
}

// Tool schemas exposed to the model (underscores only — no dots per Anthropic spec)
const TOOLS: ToolDef[] = [
  {
    name: "alix_file_read",
    description: "Read the contents of a file from the workspace.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Root directory (defaults to workspace root)" },
        path: { type: "string", description: "Relative path to the file" }
      },
      required: ["path"]
    }
  },
  {
    name: "alix_dir_search",
    description: "Search for a pattern across files in the workspace.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Root directory (defaults to workspace root)" },
        pattern: { type: "string", description: "Text pattern to search for" },
        extensions: { type: "array", items: { type: "string" } }
      },
      required: ["pattern"]
    }
  },
  {
    name: "alix_shell_run",
    description: "Run a shell command in the workspace.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute" },
        cwd: { type: "string", description: "Working directory (defaults to workspace root)" },
        timeoutMs: { type: "number", description: "Timeout in milliseconds" }
      },
      required: ["command"]
    }
  },
  {
    name: "alix_patch_apply",
    description: "Apply a code patch using search/replace. Blocks dangerous paths like .git and .env.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Root directory (defaults to workspace root)" },
        format: { type: "string", description: "Patch format: 'search_replace' or 'structured_patch'" },
        patchText: { type: "string", description: "The patch content. For search_replace, use:\n<<<<<<< SEARCH path=<file>\n<original>\n=======\n<replacement>\n>>>>>>> REPLACE" }
      },
      required: ["format", "patchText"]
    }
  },
  {
    name: "alix_file_create",
    description: "Create a new file with the given content, creating parent directories as needed.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Root directory (defaults to workspace root)" },
        path: { type: "string", description: "Relative path to the file to create" },
        content: { type: "string", description: "The file content to write" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "alix_file_delete",
    description: "Delete a file from the workspace. Cannot delete directories.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Root directory (defaults to workspace root)" },
        path: { type: "string", description: "Relative path to the file to delete" }
      },
      required: ["path"]
    }
  }
];

export type StreamHandler = (chunk: { type: "text" | "tool_call"; text?: string; toolCall?: ToolCall }) => void;

export type RunResult = {
  sessionId: string;
  summary: string;
  streamed?: boolean;
};

export type RunOpts = { streaming?: boolean; sessionMode?: "auto" | "ask" | "bypass" };

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
  const session = { sessionId, actor: "system" as const };

  await log.append({ ...session, type: "session.started", payload: { cwd, configHash: "mvp" } });
  await log.append({ ...session, actor: "user", type: "user.message", payload: { text: task, attachments: [] } });

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

  // Initialize MCP manager
  const mcpManager = new McpManager(config);
  await mcpManager.initialize();

  const { discoverHooks } = await import("./hooks/discover.js");
  const { runHook } = await import("./hooks/runner.js");
  const { ensureEncoder, estimateTokens, estimateMessageTokens, truncateToTokenBudget } = await import("./utils/tokens.js");
  const hooks = await discoverHooks(cwd);

  // Load skills from ~/.alix/skills/
  const skillsHome = join(process.env.HOME ?? "", ".alix", "skills");
  const { loadSkills } = await import("./skills/loader.js");
  const loadedSkills = await loadSkills(skillsHome);

  // Enforce store limits
  const { evictIfNeeded } = await import("./skills/lifecycle.js");
  const { maxStore, maxCandidates } = config.skills?.factory ?? DEFAULT_FACTORY_CONFIG;
  evictIfNeeded(skillsHome, { maxStore, maxCandidates: maxCandidates ?? 200 });

  const executor = new ToolExecutor(config, log, cwd, mcpManager);

  const mcpDeferral = mcpManager.getDeferral();
  const mcpToolIndex = mcpDeferral.buildIndex();
  for (const entry of mcpToolIndex) {
    TOOL_NAME_MAP[entry.name] = entry.execName;
  }

  const sessionState = {
    created: new Set<string>(),
    deleted: new Set<string>(),
    changed: new Set<string>(),
    fatalErrors: [] as string[],
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
  const maxIterations = config.model.maxIterations ?? 10;
  let repairCount = 0;
  const maxRepairs = 3;

  // Scope tracking: derive initial scope from task string
  const initialScope = extractInitialScope(task);
  const scope: ScopeTracker = createScopeTracker(initialScope, cwd);

  // State machine with hard limits
  const limiter = new RunLimiter({
    maxIterations,
    maxRepairs: 3,
    maxFileChanges: 0,    // 0 = unlimited
    maxShellCommands: 0,  // 0 = unlimited
    maxRuntimeMs: 0,      // 0 = unlimited
  });
  const stateMachine = new TaskStateMachine(limiter, (from, to, reason) => {
    log.append({ ...session, actor: "system", type: "autonomy.state_transition", payload: { from, to, reason } });
  });

  // Inject available skills into system prompt

  // Context compiler: warm up and compile context bundle now that MAX_CONTEXT_TOKENS and taskType are resolved
  const contextCompiler = new ContextCompiler();
  await contextCompiler.warm(cwd);
  const CONTEXT_BUDGET = Math.floor(MAX_CONTEXT_TOKENS * 0.3);
  const pinnedPaths: string[] = [];
  const contextBundle = await contextCompiler.compile(task, taskType, CONTEXT_BUDGET, pinnedPaths);
  await log.append({
    ...session,
    type: "context.bundle_compiled",
    payload: {
      taskType,
      budget: contextBundle.budget,
      primaryCount: contextBundle.primaryFiles.length,
      testCount: contextBundle.tests.length,
      supportingCount: contextBundle.supportingFiles.length,
      pinnedCount: contextBundle.pinned.length,
    }
  });

  function buildSystemPrompt(base: string, contextBundle: import("./repomap/context-compiler.js").ContextBundle): string {
    const parts: string[] = [base];

    if (loadedSkills.length > 0) {
      const skillSection = loadedSkills
        .map(s => `## Skill: ${s.manifest.trigger ?? s.manifest.name}\n${s.body}`)
        .join("\n\n");
      parts.push(`## Available Skills\n${skillSection}`);
    }

    // Inject ranked context bundle if populated
    if (contextBundle.primaryFiles.length > 0 || contextBundle.tests.length > 0 || contextBundle.supportingFiles.length > 0) {
      const ctxLines: string[] = ["## Context Files"];
      if (contextBundle.primaryFiles.length > 0) {
        ctxLines.push(`Primary files (ranked by relevance to this task): ${contextBundle.primaryFiles.map(f => f.path).join(", ")}`);
      }
      if (contextBundle.tests.length > 0) {
        ctxLines.push(`Test files (related to your changes): ${contextBundle.tests.map(f => f.path).join(", ")}`);
      }
      if (contextBundle.supportingFiles.length > 0) {
        ctxLines.push(`Supporting files (config): ${contextBundle.supportingFiles.map(f => f.path).join(", ")}`);
      }
      parts.push(ctxLines.join("\n"));
    }

    return parts.join("\n\n");
  }

  const SYSTEM_PROMPT_BASE = "You are ALiX, an AI coding agent. You have access to tools. IMPORTANT: When you call a tool, wait for the result in the next response before taking further action. If a tool returns an error, fix the issue. If the tool succeeds, confirm completion. Do NOT repeat the same tool call twice without checking the result first.";
  const SYSTEM_PROMPT = buildSystemPrompt(SYSTEM_PROMPT_BASE, contextBundle);

  for (let i = 0; i < maxIterations; i++) {
    // Truncate messages if token budget exceeded before streaming/completion
    const msgTokens = messages.reduce(
      (sum, m) => sum + estimateMessageTokens(m, encoding),
      0
    );
    if (msgTokens > MAX_CONTEXT_TOKENS / 2) {
      const { kept, dropped } = truncateToTokenBudget(messages, MAX_CONTEXT_TOKENS / 2, encoding);
      if (dropped.length > 0) {
        // Remove all [State] messages before truncation, then re-inject one rolling summary
        messages = messages.filter(m => !String(m.content).startsWith("[Session Digest]"));

        // Build digest from session log — authoritative source of truth
        const logDir = log.path.replace(/\/events\.jsonl$/, "");
        const digest = await buildSessionDigest(logDir);
        if (digest) {
          messages.push({ role: "user", content: digest });
        } else {
          // Fallback to rolling sessionState summary when log isn't available
          const summary = buildStateSummary(sessionState);
          if (summary) messages.push({ role: "user", content: summary });
        }

        messages = [...(kept as NormalizedMessage[])];
        await log.append({ ...session, actor: "system", type: "context.truncated", payload: {
          droppedCount: dropped.length,
          provider: config.model.provider,
          maxTokens: MAX_CONTEXT_TOKENS,
          encoding
        }});
      }
    }

    // Run pre_task hooks at the start of each iteration
    for (const hook of hooks.pre_task ?? []) {
      await log.append({ ...session, actor: "system", type: "hook.pre_task", payload: { command: hook.command, reason: hook.reason } });
      const result = await runHook(hook, cwd);
      await log.append({ ...session, actor: "system", type: "hook.pre_task", payload: { command: hook.command, passed: result.passed, output: result.output.slice(0, 500) } });
    }

    let text = "";
    let toolCalls: ToolCall[] = [];
    let usage: TokenUsage | undefined;
    if (config.model.streaming && provider.stream) {
      for await (const chunk of provider.stream({
        systemPrompt: SYSTEM_PROMPT,
        messages,
        tools: [...TOOLS, ...mcpToolIndex]
      })) {
        if (chunk.type === "text_delta") {
          text += chunk.text;
          if (!process.stdout.write(chunk.text) && process.stdout.writableNeedDrain) {
            await new Promise(resolve => process.stdout.once("drain", resolve));
          }
          onStream?.({ type: "text", text: chunk.text });
        }
        if (chunk.type === "tool_call") {
          toolCalls.push(chunk.toolCall);
          onStream?.({ type: "tool_call", toolCall: chunk.toolCall });
        }
        if (chunk.type === "error") throw new Error(chunk.error);
        if (chunk.type === "usage") usage = chunk.usage;
      }
    } else {
      const resp = await provider.complete({
        systemPrompt: SYSTEM_PROMPT,
        messages,
        tools: [...TOOLS, ...mcpToolIndex]
      });
      text = resp.text ?? "";
      toolCalls = resp.toolCalls ?? [];
      usage = resp.usage;
    }
    
    await log.append({ ...session, actor: "agent", type: "agent.message", payload: { text } });

    if (toolCalls.length === 0) {
      // No tools called — check if model signals completion
      const modelSaysDone = /done|complete|finished|resolved/i.test(text);

      // Run post_task hooks
      for (const hook of hooks.post_task ?? []) {
        await log.append({ ...session, actor: "system", type: "hook.post_task", payload: { command: hook.command, reason: hook.reason } });
        const result = await runHook(hook, cwd);
        await log.append({ ...session, actor: "system", type: "hook.post_task", payload: { command: hook.command, passed: result.passed, output: result.output.slice(0, 500) } });
      }

      // Get verification checks
      const checks = await discoverVerification(cwd);

      // For docs tasks, skip verification
      if (taskType === "docs" || checks.length === 0) {
        if (modelSaysDone) {
          await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "completed", summary: text } });
          await mcpManager.closeAll().catch(() => {});
          // Fire-and-forget: dispatch skill factory
          const { skillFactory } = await import("./skills/dispatcher.js");
          void skillFactory.process({
            sessionId,
            sessionDir,
            summary: text,
            filesCreated: [...sessionState.created],
            filesChanged: [...sessionState.changed],
            config: config.skills?.factory ?? DEFAULT_FACTORY_CONFIG,
          });
          return { sessionId, summary: text, streamed: config.model.streaming };
        }
        // Model didn't signal done, continue
      } else {
        // Run verification
        const verResults: Array<{ check: VerificationCheck; result: VerificationResult }> = [];
        for (const check of checks) {
          await log.append({ ...session, actor: "verifier", type: "verification.check_started", payload: { command: check.command, reason: check.reason } });
          const verResult = await runVerification(cwd, check);
          await log.append({ ...session, actor: "verifier", type: "verification.check_finished", payload: { command: check.command, status: verResult.status } });
          verResults.push({ check, result: verResult });
        }

        const allPassed = verResults.every((vr) => vr.result.status === "passed");

        if (allPassed && modelSaysDone) {
          // Success — verification passed and model signals done
          await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "completed", summary: text } });
          await mcpManager.closeAll().catch(() => {});
          return { sessionId, summary: text, streamed: config.model.streaming };
        }

        // Repair loop — verification failed or model didn't signal done
        const failures = verResults.filter((vr) => vr.result.status === "failed");
        const failureText = failures.length > 0
          ? failures.map((f) => `${f.check.command} failed:\n${f.result.output ?? ""}`).join("\n\n")
          : "No tool calls and model did not signal completion.";

        repairCount++;
        if (repairCount > maxRepairs) {
          await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_repairs", summary: `Repair limit reached after ${maxRepairs} attempts` } });
          await mcpManager.closeAll().catch(() => {});
          // Fire-and-forget: dispatch skill factory
          const { skillFactory } = await import("./skills/dispatcher.js");
          void skillFactory.process({
            sessionId,
            sessionDir,
            summary: `Repair limit reached: ${failureText}`,
            filesCreated: [...sessionState.created],
            filesChanged: [...sessionState.changed],
            config: config.skills?.factory ?? DEFAULT_FACTORY_CONFIG,
          });
          return { sessionId, summary: `Repair limit reached: ${failureText}`, streamed: config.model.streaming };
        }

        const repairPrompt = `\n\n[Verification Result] ${failureText}\n\nRepair the issues above and confirm completion when done.`;
        messages.push({ role: "user", content: repairPrompt });

        // Don't return — continue the loop
      }
    }

    // Track failed tool names per iteration to prevent spinning
    const failedTools: string[] = [];
    const fatalToolErrors: string[] = [];
    let pendingScopeExpansion: { path: string; toolCallId: string } | null = null;

    // Handle each tool call (model names like alix_file_read → executor names like file.read)
    for (const toolCall of toolCalls) {
      const execName = TOOL_NAME_MAP[toolCall.name] ?? toolCall.name;

      // Scope expansion check: intercept mutation tools for files outside initial scope
      const isMutation = execName === "file.create" || execName === "file.write" || execName === "file.delete" || execName === "patch.apply";
      if (isMutation) {
        const path = (toolCall.args.path as string | undefined) ?? "";
        const check = scope.checkMutation(path);
        if (check === "scope_expansion") {
          await log.append({ ...session, actor: "policy", type: "autonomy.scope_expansion", payload: { path, toolCallId: toolCall.id, toolName: execName } });
          pendingScopeExpansion = { path, toolCallId: toolCall.id };
          scope.setPending(path);
          // Deny the tool and ask for scope confirmation
          messages.push({ role: "user", content: `<tool_result id="${toolCall.id}">\nError: Scope expansion requires approval. The agent is attempting to modify "${path}" which is outside the initial scope.\n\nPlease confirm: type "approve" to allow this file, or "deny" to block it.\n</tool_result>` });
          continue;
        }
        // scope.checkMutation returned "allowed" or "approved" — proceed
      }

      const execResult = await executor.execute({ toolCallId: toolCall.id, name: execName, args: toolCall.args });

      if (execResult.kind === "error") {
        const errorResult = execResult as { kind: "error"; message: string; retryable?: boolean; hint?: string };
        failedTools.push(execName);
        if (errorResult.retryable === false) {
          fatalToolErrors.push(execName);
        }
      }

      const resultContent =
        execResult.kind === "success"
          ? (execResult.output ?? execResult.content ?? "")
          : buildErrorMessage(execResult as { kind: "error"; message: string; retryable?: boolean; hint?: string });

      messages.push({ role: "user", content: `<tool_result id="${toolCall.id}">\n${resultContent}\n</tool_result>` });
    }

    // Track all file mutations in sessionState
    for (const toolCall of toolCalls) {
      const execName = TOOL_NAME_MAP[toolCall.name] ?? toolCall.name;
      if (execName === "file.create") sessionState.created.add(toolCall.args.path as string);
      if (execName === "file.delete") sessionState.deleted.add(toolCall.args.path as string);
      if (execName === "file.write" || execName === "file.patch_apply") sessionState.changed.add(toolCall.args.path as string);
    }
    sessionState.fatalErrors.push(...fatalToolErrors);
    for (const failed of failedTools) {
      if (!fatalToolErrors.includes(failed)) {
        sessionState.fatalErrors.push(failed);
      }
    }

    // After tool calls, run verification every iteration
    const endChecks = await discoverVerification(cwd);
    if (endChecks.length > 0 && taskType !== "docs") {
      const endResults: Array<{ check: VerificationCheck; result: VerificationResult }> = [];
      for (const endCheck of endChecks) {
        await log.append({ ...session, actor: "verifier", type: "verification.check_started", payload: { command: endCheck.command, reason: endCheck.reason } });
        const verResult = await runVerification(cwd, endCheck);
        await log.append({ ...session, actor: "verifier", type: "verification.check_finished", payload: { command: endCheck.command, status: verResult.status } });
        endResults.push({ check: endCheck, result: verResult });
      }

      const failedChecks = endResults.filter((r) => r.result.status === "failed");
      if (failedChecks.length > 0) {
        repairCount++;
        stateMachine.recordRepair();
        if (repairCount > maxRepairs) {
          await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_repairs", summary: `Repair limit reached after ${maxRepairs} attempts` } });
          await mcpManager.closeAll().catch(() => {});
          // Fire-and-forget: dispatch skill factory
          const { skillFactory } = await import("./skills/dispatcher.js");
          void skillFactory.process({
            sessionId,
            sessionDir,
            summary: "Repair limit reached",
            filesCreated: [...sessionState.created],
            filesChanged: [...sessionState.changed],
            config: config.skills?.factory ?? DEFAULT_FACTORY_CONFIG,
          });
          return { sessionId, summary: "Repair limit reached", streamed: config.model.streaming };
        }
        const failureText = failedChecks
          .map((f) => `${f.check.command} failed:\n${f.result.output ?? ""}`)
          .join("\n\n");
        const repairPrompt = `\n\n[Verification Failed] ${failureText}\n\nFix the issues and try again.`;
        messages.push({ role: "user", content: repairPrompt });
      }
    }
  }

  // Max iterations reached
  await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_iterations", summary: "Agent reached maximum iterations" } });
  await mcpManager.closeAll().catch(() => {});
  // Fire-and-forget: dispatch skill factory
  const { skillFactory } = await import("./skills/dispatcher.js");
  void skillFactory.process({
    sessionId,
    sessionDir,
    summary: "Agent reached maximum iterations",
    filesCreated: [...sessionState.created],
    filesChanged: [...sessionState.changed],
    config: config.skills?.factory ?? DEFAULT_FACTORY_CONFIG,
  });
  return { sessionId, summary: "Agent reached maximum iterations", streamed: config.model.streaming };
}