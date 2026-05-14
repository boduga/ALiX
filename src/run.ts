import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config/loader.js";
import { EventLog } from "./events/event-log.js";
import { buildRepoMapLite } from "./repomap/repomap-lite.js";
import { createProvider } from "./providers/registry.js";
import type { ModelAdapter, NormalizedMessage, NormalizedRequest, ToolCall, TokenUsage, ToolDef } from "./providers/types.js";
import { ToolExecutor } from "./tools/executor.js";
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

export type RunResult = {
  sessionId: string;
  summary: string;
};

export async function runTask(cwd: string, task: string): Promise<RunResult> {
  const sessionId = randomUUID();
  const sessionDir = join(cwd, ".alix", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });

  const config = await loadConfig(cwd);
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
  const executor = new ToolExecutor(config, log, cwd);

  const messages: NormalizedMessage[] = [{ role: "user", content: task }];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await provider.complete({
      systemPrompt: "You are ALiX. You have access to tools. Use them to complete the user's request.",
      messages,
      tools: TOOLS
    });

    await log.append({ ...session, actor: "agent", type: "agent.message", payload: { text: response.text } });

    if (response.toolCalls.length === 0) {
      // Run verification before final response
      const checks = await discoverVerification(cwd);
      for (const check of checks) {
        await log.append({ ...session, actor: "verifier", type: "verification.check_started", payload: { command: check.command, reason: check.reason } });
        const verResult = await runVerification(cwd, check);
        await log.append({ ...session, actor: "verifier", type: "verification.check_finished", payload: { command: check.command, status: verResult.status } });
      }

      await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "completed", summary: response.text } });
      return { sessionId, summary: response.text };
    }

    // Handle each tool call (model names like alix_file_read → executor names like file.read)
    for (const toolCall of response.toolCalls) {
      const execName = TOOL_NAME_MAP[toolCall.name] ?? toolCall.name;
      const execResult = await executor.execute({ toolCallId: toolCall.id, name: execName, args: toolCall.args });

      const resultContent =
        execResult.kind === "success"
          ? (execResult.output ?? execResult.content ?? "")
          : `Error: ${(execResult as { kind: "denied"; reason: string }).reason ?? (execResult as { kind: "error"; message: string }).message}`;

      messages.push({ role: "user", content: `<tool_result id="${toolCall.id}">\n${resultContent}\n</tool_result>` });
    }
  }

  // Max iterations reached
  await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_iterations", summary: "Agent reached maximum iterations" } });
  return { sessionId, summary: "Agent reached maximum iterations" };
}