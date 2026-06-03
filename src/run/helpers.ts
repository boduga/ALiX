import { createInterface } from "node:readline";
import type { ModelAdapter, NormalizedRequest, ToolCall, TokenUsage, ToolDef } from "../providers/types.js";
import type { MemoryStore } from "../utils/memory/store.js";
import { extractDecisions, promptDecisionConfirmation } from "../utils/memory/decision-extractor.js";
import { TOOL_NAME_MAP } from "../agents/tool-name-map.js";
import { buildEditFormatPolicy, type EditFormatPolicy } from "../patch/edit-format-policy.js";
import { extractPatchPaths } from "../patch/patch-paths.js";

// =============================================================================
// INTERNAL HELPERS (not exported — used by helpers.ts exports only)
// =============================================================================

/**
 * Resolve a tool name that may be misspelled or unknown.
 * Uses fuzzy search to find the closest match in the MCP tool index.
 */
export function resolveMcpTool(
  mcpName: string,
  deferral: { search: (name: string, limit: number) => { item: { execName: string }; score: number }[] }
): string | null {
  if (TOOL_NAME_MAP[mcpName]) return TOOL_NAME_MAP[mcpName];
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
  pendingScopeExpansion: boolean;
};

/**
 * Build a human-readable summary of session state changes.
 */
export function buildStateSummary(state: SessionState): string {
  const parts: string[] = [];
  if (state.created.size) parts.push(`Created: ${[...state.created].join(", ")}`);
  if (state.changed.size) parts.push(`Changed: ${[...state.changed].join(", ")}`);
  if (state.deleted.size) parts.push(`Deleted: ${[...state.deleted].join(", ")}`);
  if (state.fatalErrors.length) parts.push(`FATAL: ${state.fatalErrors.join("; ")}`);
  return parts.length ? `[Session Digest] ${parts.join(". ")}.` : "";
}

/**
 * Generate tool description for patch format based on policy.
 */
export function patchFormatDescription(policy: EditFormatPolicy): string {
  const preferred = policy.preferred;
  const alternate = preferred === "search_replace" ? "structured_patch" : "search_replace";
  return `Patch format. Preferred: ${preferred}. Use ${preferred} unless the user explicitly asks for ${alternate}. Do not use full_file for existing files. Full-file rewrite policy: ${policy.fullFileRewrite}.`;
}

/**
 * Generate tool description for patch text based on preferred format.
 */
export function patchTextDescription(preferred: EditFormatPolicy["preferred"]): string {
  if (preferred === "structured_patch") {
    return `The patch content. Preferred structured_patch format is a JSON object: {"version":1,"files":[{"path":"src/file.ts","operation":"modify","preimageHash":"<sha256>","content":"<full new content>"}]}. Use search_replace only when a small exact replacement is safer.`;
  }
  return "The patch content. Preferred search_replace format:\n<<<<<<< SEARCH path=<file>\n<original>\n=======\n<replacement>\n>>>>>>> REPLACE";
}

// Tool schemas exposed to the model (underscores only — no dots per Anthropic spec)
export const BASE_TOOLS: ToolDef[] = [
  {
    name: "alix_file_read",
    description: "Read the contents of a file. To LIST files in a directory, use alix_shell_run with: ls <directory>. This tool reads a SINGLE FILE's content.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Root directory (defaults to workspace root)" },
        path: { type: "string", description: "Relative path to the FILE to read (NOT a directory)" }
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
    description: "Run a shell command in the workspace. IMPORTANT: To change directory within a command, chain with &&. Examples:\n  - cd myfolder && pwd  # Change dir and show new path\n  - cd api && ls -la    # List files in api folder\n  - mkdir test && cd test && echo done  # Create folder, enter it, confirm\nEach call runs in isolation — use && to chain commands that must run together.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute. Use && to chain commands that need to run together (e.g., cd dir && ls)." },
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
  },
  {
    name: "alix_file_exists",
    description: "Check whether a file exists at the given path without reading its contents.",
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
    name: "alix_done",
    description: "Signal that the task is complete. Use this when all requested changes have been made and no further tool calls are needed.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "alix_delegate",
    description: "Delegate a task to a subagent. Spawns a focused subagent (explorer/reviewer/test_investigator/docs_researcher/worker) that runs in a separate process and returns structured findings.",
    input_schema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          enum: ["auto", "explorer", "reviewer", "test_investigator", "docs_researcher", "worker"],
          description: "The role of the subagent to spawn (use 'auto' for intent-based selection)"
        },
        prompt: {
          type: "string",
          description: "The task instruction for the subagent"
        },
        ownedPaths: {
          type: "array",
          items: { type: "string" },
          description: "File paths this subagent is allowed to write (required for worker role)"
        }
      },
      required: ["role", "prompt"]
    }
  },
  {
    name: "web_search",
    description: "Search the web for current information. Use for questions about current events, recent data, or facts beyond the model's training cutoff. Requires BRAVE_API_KEY env var.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        count: { type: "integer", description: "Number of results (1-10, default 5)" }
      },
      required: ["query"]
    }
  },
  {
    name: "web_fetch",
    description: "Fetch a URL and return its text content. Use after web_search to read full articles. HTML is automatically stripped.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch (must be http:// or https://)" },
        maxLength: { type: "integer", description: "Maximum content length in characters (default 10000)" }
      },
      required: ["url"]
    }
  }
];

/**
 * Extract mutation paths from tool arguments.
 * Returns array of file paths affected by the tool call.
 */
export function extractMutationPaths(execName: string, args: Record<string, unknown>): string[] {
  if (execName === "patch.apply") {
    return extractPatchPaths(args.format as string | undefined, args.patchText);
  }
  const path = args.path;
  return typeof path === "string" && path.length > 0 ? [path] : [];
}

/**
 * Extract valid mutation paths from tool arguments.
 */
export function validMutationPaths(execName: string, args: Record<string, unknown>): string[] {
  return extractMutationPaths(execName, args)
    .filter((path): path is string => typeof path === "string" && path.length > 0);
}

// =============================================================================
// EXPORTED HELPERS
// =============================================================================

/**
 * Prompt the user with a question and return their response.
 */
export async function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Extract decisions from session events and save confirmed ones to memory.
 * Wraps memoryStore.save() in try/catch to prevent crashes during cleanup.
 */
export async function saveDecisionsToMemory(
  sessionEvents: Awaited<ReturnType<import("../events/event-log.js").EventLog["readAll"]>>,
  memoryStore: MemoryStore
): Promise<void> {
  const decisions = extractDecisions(sessionEvents);
  if (decisions.length === 0) {
    console.log("[Memory] No decisions found to save.");
    return;
  }

  const confirmedDecisions = await promptDecisionConfirmation(decisions);
  if (confirmedDecisions.length === 0) {
    console.log("[Memory] No decisions saved.");
    return;
  }

  console.log(`[Memory] Saving ${confirmedDecisions.length} decision(s) to memory:`);
  for (const decision of confirmedDecisions) {
    try {
      await memoryStore.save({
        name: decision.name,
        description: decision.description,
        type: decision.type,
        content: decision.content,
        confidence: decision.confidence,
        confirmations: decision.confirmations,
        source: decision.source,
      });
      console.log(`  - [${decision.type}] ${decision.content}`);
    } catch (err) {
      console.error(`[Memory] Failed to save decision "${decision.name}": ${(err as Error).message}`);
    }
  }
}

/**
 * Stream a request to the provider and collect the response.
 * Handles stdout writing and stream callbacks.
 */
export async function streamToResponse(
  provider: ModelAdapter,
  request: NormalizedRequest,
  options?: { onStream?: (chunk: { type: "text"; text: string }) => void }
): Promise<{ text: string; toolCalls: ToolCall[]; usage?: TokenUsage }> {
  if (!provider.stream) throw new Error("Provider does not support streaming");
  let text = "";
  let toolCalls: ToolCall[] = [];
  let usage: TokenUsage | undefined;
  for await (const chunk of provider.stream(request)) {
    if (chunk.type === "text_delta") {
      text += chunk.text;
      if (!process.stdout.write(chunk.text) && process.stdout.writableNeedDrain) {
        await new Promise(resolve => process.stdout.once("drain", resolve));
      }
      options?.onStream?.({ type: "text", text: chunk.text });
    }
    if (chunk.type === "tool_call") toolCalls.push(chunk.toolCall);
    if (chunk.type === "usage") usage = chunk.usage;
    if (chunk.type === "error") throw new Error(chunk.error);
  }
  return { text, toolCalls, usage };
}

/**
 * Build tool schemas for the provider, with dynamic format descriptions.
 */
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

/**
 * Determine whether streaming should be automatically disabled.
 * Returns true in non-TTY environments or when CI is detected.
 */
export function shouldAutoDisableStreaming(): boolean {
  if (!process.stdout.isTTY) return true;
  if (process.env.CI) return true;
  return false;
}