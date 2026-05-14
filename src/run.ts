import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { loadConfig } from "./config/loader.js";
import { getEncoding } from "./config/context-limits.js";
import { EventLog } from "./events/event-log.js";
import { buildRepoMapLite } from "./repomap/repomap-lite.js";
import { createProvider } from "./providers/registry.js";
import type { ModelAdapter, NormalizedMessage, NormalizedRequest, ToolCall, TokenUsage, ToolDef } from "./providers/types.js";
import { ApiError } from "./providers/base.js";
import { ToolExecutor } from "./tools/executor.js";
import { McpManager } from "./mcp/manager.js";
import { discoverVerification, runVerification } from "./verifier/verifier.js";

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

const MAX_ITERATIONS = 10;

// Map model tool names (alix_*) → executor tool names (file.*)
const TOOL_NAME_MAP: Record<string, string> = {
  alix_file_read: "file.read",
  alix_file_create: "file.create",
  alix_file_delete: "file.delete",
  alix_dir_search: "dir.search",
  alix_shell_run: "shell.run",
  alix_patch_apply: "patch.apply"
};

function mcpToolName(serverName: string, toolName: string): string {
  // e.g., "fetch", "fetch" → "mcp_fetch_fetch"
  // toolName may contain dots: "repos.list" → "mcp_github_repos_list"
  return "mcp_" + serverName + "_" + toolName.replace(/\./g, "_");
}

function mcpToolExecName(serverName: string, toolName: string): string {
  // e.g., "fetch", "fetch" → "mcp.fetch.fetch"
  return "mcp." + serverName + "." + toolName;
}

export function buildErrorMessage(err: { kind: "error"; message: string; retryable?: boolean; hint?: string }): string {
  const parts: string[] = [`Error: ${err.message}`];
  if (err.hint) parts.push(`Hint: ${err.hint}`);
  if (err.retryable === false) parts.push("This error is fatal — do not retry this tool.");
  else if (err.retryable === true) parts.push("This error may be transient — retrying may help.");
  return parts.join(" ");
}

function buildMcpTools(registered: { serverName: string; toolName: string; description?: string; inputSchema: Record<string, unknown> }[]): ToolDef[] {
  return registered.map(tool => ({
    name: mcpToolName(tool.serverName, tool.toolName),
    description: tool.description ?? "",
    input_schema: tool.inputSchema as ToolDef["input_schema"]
  }));
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

export type RunOpts = { streaming?: boolean };

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

  const executor = new ToolExecutor(config, log, cwd, mcpManager);

  const mcpTools = buildMcpTools(mcpManager.listTools());
  for (const tool of mcpManager.listTools()) {
    TOOL_NAME_MAP[mcpToolName(tool.serverName, tool.toolName)] = mcpToolExecName(tool.serverName, tool.toolName);
  }

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

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // Truncate messages if token budget exceeded before streaming/completion
    const msgTokens = messages.reduce(
      (sum, m) => sum + estimateMessageTokens(m, encoding),
      0
    );
    if (msgTokens > MAX_CONTEXT_TOKENS / 2) {
      const { kept, dropped } = truncateToTokenBudget(messages, MAX_CONTEXT_TOKENS / 2, encoding);
      if (dropped.length > 0) {
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
        systemPrompt: "You are ALiX, an AI coding agent. You have access to tools. IMPORTANT: When you call a tool, wait for the result in the next response before taking further action. If a tool returns an error, fix the issue. If the tool succeeds, confirm completion. Do NOT repeat the same tool call twice without checking the result first.",
        messages,
        tools: [...TOOLS, ...mcpTools]
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
        systemPrompt: "You are ALiX, an AI coding agent. You have access to tools. IMPORTANT: When you call a tool, wait for the result in the next response before taking further action. If a tool returns an error, fix the issue. If the tool succeeds, confirm completion. Do NOT repeat the same tool call twice without checking the result first.",
        messages,
        tools: [...TOOLS, ...mcpTools]
      });
      text = resp.text ?? "";
      toolCalls = resp.toolCalls ?? [];
      usage = resp.usage;
    }
    
    await log.append({ ...session, actor: "agent", type: "agent.message", payload: { text } });

    if (toolCalls.length === 0) {
      // Run post_task hooks when no tools were called
      for (const hook of hooks.post_task ?? []) {
        await log.append({ ...session, actor: "system", type: "hook.post_task", payload: { command: hook.command, reason: hook.reason } });
        const result = await runHook(hook, cwd);
        await log.append({ ...session, actor: "system", type: "hook.post_task", payload: { command: hook.command, passed: result.passed, output: result.output.slice(0, 500) } });
      }

      // Run verification before final response
      const checks = await discoverVerification(cwd);
      for (const check of checks) {
        await log.append({ ...session, actor: "verifier", type: "verification.check_started", payload: { command: check.command, reason: check.reason } });
        const verResult = await runVerification(cwd, check);
        await log.append({ ...session, actor: "verifier", type: "verification.check_finished", payload: { command: check.command, status: verResult.status } });
      }

      await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "completed", summary: text } });
      await mcpManager.closeAll().catch(() => {});
      return { sessionId, summary: text, streamed: config.model.streaming };
    }

    // Track failed tool names per iteration to prevent spinning
    const failedTools: string[] = [];
    const fatalToolErrors: string[] = [];

    // Handle each tool call (model names like alix_file_read → executor names like file.read)
    for (const toolCall of toolCalls) {
      const execName = TOOL_NAME_MAP[toolCall.name] ?? toolCall.name;
      const execResult = await executor.execute({ toolCallId: toolCall.id, name: execName, args: toolCall.args });

      if (execResult.kind === "error") {
        const errorResult = execResult as { kind: "error"; message: string; retryable?: boolean; hint?: string };
        const toolLabel = execName.startsWith("mcp.") ? execName : execName;
        failedTools.push(toolLabel);
        if (errorResult.retryable === false) {
          fatalToolErrors.push(toolLabel);
        }
      }

      const resultContent =
        execResult.kind === "success"
          ? (execResult.output ?? execResult.content ?? "")
          : buildErrorMessage(execResult as { kind: "error"; message: string; retryable?: boolean; hint?: string });

      messages.push({ role: "user", content: `<tool_result id="${toolCall.id}">\n${resultContent}\n</tool_result>` });
    }

    // After each round, inject state summary so the model knows what succeeded/failed
    const created = toolCalls.filter(tc => (TOOL_NAME_MAP[tc.name] ?? tc.name) === "file.create").map(tc => tc.args.path as string);
    const deleted = toolCalls.filter(tc => (TOOL_NAME_MAP[tc.name] ?? tc.name) === "file.delete").map(tc => tc.args.path as string);

    const stateParts: string[] = [];
    if (created.length) stateParts.push(`Created: ${created.join(", ")}`);
    if (deleted.length) stateParts.push(`Deleted: ${deleted.join(", ")}`);
    if (fatalToolErrors.length) {
      stateParts.push(`FATAL (do not retry): ${fatalToolErrors.join(", ")}`);
    }
    if (failedTools.length && failedTools.length === toolCalls.length && !fatalToolErrors.length) {
      stateParts.push(`All tools failed. Consider a different approach.`);
    }
    if (stateParts.length) {
      messages.push({ role: "user", content: `[State] ${stateParts.join(". ")}.` });
    }
  }

  // Max iterations reached
  await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_iterations", summary: "Agent reached maximum iterations" } });
  await mcpManager.closeAll().catch(() => {});
  return { sessionId, summary: "Agent reached maximum iterations", streamed: config.model.streaming };
}