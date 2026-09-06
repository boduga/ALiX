import { createInterface } from "node:readline";
import type { ModelAdapter, NormalizedMessage, NormalizedRequest, ToolCall, TokenUsage, ToolDef } from "../providers/types.js";
import type { MemoryStore } from "../utils/memory/store.js";
import { extractDecisions, promptDecisionConfirmation } from "../utils/memory/decision-extractor.js";
import { TOOL_NAME_MAP } from "../agents/tool-name-map.js";
import { buildEditFormatPolicy, type EditFormatPolicy } from "../patch/edit-format-policy.js";
import { shouldAutoDisableStreaming, type StreamHandler } from "../agent/stream.js";
import { extractMutationPaths, validMutationPaths } from "../agent/mutations.js";
import {
  ExecutionCancelledError,
  raceWithCancellation,
} from "../runtime/cancellation-token.js";

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
  return `Patch format. Preferred: ${preferred}. Use ${preferred} unless the user explicitly asks for ${alternate}. unified_diff is also accepted and auto-detected. Do not use full_file for existing files. Full-file rewrite policy: ${policy.fullFileRewrite}.`;
}

/**
 * Generate tool description for patch text based on preferred format.
 */
export function patchTextDescription(preferred: EditFormatPolicy["preferred"]): string {
  if (preferred === "structured_patch") {
    return `The patch content. Preferred structured_patch format is a JSON object: {"version":1,"files":[{"path":"src/file.ts","operation":"modify","preimageHash":"<sha256>","content":"<full new content>"}]}. Use search_replace only when a small exact replacement is safer. unified_diff is also accepted and auto-detected.`;
  }
  if (preferred === "unified_diff") {
    return "The patch content. Preferred unified_diff format is a standard git diff: --- a/<file> / +++ b/<file> / @@ hunk headers. search_replace and structured_patch are also accepted.";
  }
  return "The patch content. Preferred search_replace format:\n<<<<<<< SEARCH path=<file>\n<original>\n=======\n<replacement>\n>>>>>>> REPLACE\nunified_diff is also accepted and auto-detected.";
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
        format: { type: "string", description: "Patch format: 'search_replace', 'structured_patch', or 'unified_diff'. Unified diff is auto-detected; aider '*** Begin Patch' is normalized automatically." },
        patchText: { type: "string", description: "The patch content. For search_replace, use:\n<<<<<<< SEARCH path=<file>\n<original>\n=======\n<replacement>\n>>>>>>> REPLACE\nFor unified_diff, use standard git diff: --- a/<file> / +++ b/<file> / @@ hunk headers." }
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
    name: "alix_create_hook",
    description: "Create a hook that runs before or after tool calls or events. Hooks can log, audit, or modify behavior. For example: 'log every file deletion to audit.log'. Describe what you want in the prompt parameter and provide valid JavaScript code in the body.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "What should this hook do? e.g. 'log every file.delete to audit.log'" },
        trigger: { type: "string", enum: ["on_pre_tool", "on_post_tool", "on_tool_complete", "on_tool_error", "on_pre_patch", "on_post_patch", "on_approval_request", "on_session_start", "on_session_end"], description: "When should this hook fire? on_pre_tool = before tool, on_post_tool = after tool, etc." },
        body: { type: "string", description: "JavaScript code for the hook body. Use `data` for tool call info: data.toolName, data.args, data.result." },
      },
      required: ["description", "trigger", "body"],
    }
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
    name: "alix_web_search",
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
    name: "alix_web_fetch",
    description: "Fetch a URL and return its text content. Use after alix_web_search to read full articles. HTML is automatically stripped.",
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
 * Subset of BASE_TOOLS available for read-only tasks (research, flux commands).
 * Only reading, searching, shell commands, and file-exists checks.
 * No patch apply, file create/delete, hook creation, or delegation.
 */
export const READ_ONLY_TOOL_NAMES = new Set([
  "alix_file_read",
  "alix_dir_search",
  "alix_shell_run",
  "alix_file_exists",
  "alix_done",
  "alix_web_search",
  "alix_web_fetch",
]);


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

export type StreamToResponseResult = {
  text: string;
  reasoning?: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
  resolvedModel?: string;
  /** Terminal finish reason from the provider (stop / length / tool_calls). */
  finishReason?: string;
};

/**
 * Stream a request to the provider and collect the response.
 * Handles stdout writing and stream callbacks.
 *
 * When `options.signal` is present (operator cancellation, Task 6.1), each
 * chunk wait races the abort signal so a cancel releases the run the instant
 * it is requested — the generator is closed and the call ends as an
 * ExecutionCancelledError. A mid-stream abort NEVER falls back to the
 * blocking `complete()` (cancellation is not a network hiccup to repair).
 * Without a signal the behaviour is byte-for-byte the legacy path.
 */
export async function streamToResponse(
  provider: ModelAdapter,
  request: NormalizedRequest,
  options?: { onStream?: StreamHandler; signal?: AbortSignal }
): Promise<StreamToResponseResult> {
  if (!provider.stream) throw new Error("Provider does not support streaming");
  const signal = options?.signal;
  let text = "";
  let reasoning = "";
  let toolCalls: ToolCall[] = [];
  let usage: TokenUsage | undefined;
  let resolvedModel: string | undefined;
  let finishReason: string | undefined;
  try {
    if (!signal) {
      for await (const chunk of provider.stream(request)) {
        if (chunk.type === "text_delta") {
          text += chunk.text;
          if (!process.stdout.write(chunk.text) && process.stdout.writableNeedDrain) {
            await new Promise(resolve => process.stdout.once("drain", resolve));
          }
          options?.onStream?.({ type: "text", text: chunk.text });
        }
        if (chunk.type === "reasoning_delta") {
          reasoning += chunk.text;
          // Reasoning is private trace — never written to stdout and never
          // folded into the final text, but surfaced as a `reasoning` stream
          // chunk so liveness feeds (which otherwise see only text chunks)
          // can count a long private thought-phase as progress.
          options?.onStream?.({ type: "reasoning", text: chunk.text });
        }
        if (chunk.type === "tool_call") toolCalls.push(chunk.toolCall);
        if (chunk.type === "usage") usage = chunk.usage;
        if (chunk.type === "done" && chunk.resolvedModel) resolvedModel = chunk.resolvedModel;
        if (chunk.type === "done" && chunk.finishReason) finishReason = chunk.finishReason;
        if (chunk.type === "error") throw new Error(chunk.error);
      }
      return { text, reasoning: reasoning || undefined, toolCalls, usage, resolvedModel, finishReason };
    }

    // Cancellable path — same accumulation, but every `next()` races the
    // operator-cancel signal so a cancel releases a hung stream immediately.
    const iterator = provider.stream(request)[Symbol.asyncIterator]();
    try {
      for (;;) {
        if (signal.aborted) throw new ExecutionCancelledError(String((signal as any).reason ?? "operation cancelled"));
        // One abort listener per chunk, detached on settle (raceWithCancellation)
        // — a long stream never accumulates listeners across chunks.
        const step = await raceWithCancellation(iterator.next(), signal);
        if (step.done) break;
        const chunk = step.value;
        if (chunk.type === "text_delta") {
          text += chunk.text;
          if (!process.stdout.write(chunk.text) && process.stdout.writableNeedDrain) {
            await new Promise(resolve => process.stdout.once("drain", resolve));
          }
          options?.onStream?.({ type: "text", text: chunk.text });
        }
        if (chunk.type === "reasoning_delta") {
          reasoning += chunk.text;
          options?.onStream?.({ type: "reasoning", text: chunk.text });
        }
        if (chunk.type === "tool_call") toolCalls.push(chunk.toolCall);
        if (chunk.type === "usage") usage = chunk.usage;
        if (chunk.type === "done" && chunk.resolvedModel) resolvedModel = chunk.resolvedModel;
        if (chunk.type === "done" && chunk.finishReason) finishReason = chunk.finishReason;
        if (chunk.type === "error") throw new Error(chunk.error);
      }
      return { text, reasoning: reasoning || undefined, toolCalls, usage, resolvedModel, finishReason };
    } finally {
      // The signal fired (or the pump errored): ask the generator to stop so
      // the provider stops producing. Fire-and-forget on purpose — a
      // generator stuck in its own internal await cannot accept return()
      // until that await settles, and we must NEVER block the cancellation
      // propagation on it (the transport's own idle/timeout bounds the
      // orphaned request).
      if (signal.aborted) {
        void (async () => {
          try { if (iterator.return) await iterator.return(undefined); } catch { /* best-effort */ }
        })();
      }
    }
  } catch (err) {
    if (signal?.aborted || err instanceof ExecutionCancelledError) throw err;
    // Routing adapters already made their fallback decision (INV-5); their
    // post-commit failure is final — do not re-run the chain and concatenate.
    if (provider.isRoutingAdapter) throw err;
    // Fail-soft: a mid-stream error (network hiccup, dropped chunk, malformed
    // SSE) must not abort the task run. Fall back to a blocking complete();
    // the tokens streamed so far remain, the rest arrives as one block.
    const resp = await provider.complete(request);
    return { text: text + (resp.text ?? ""), reasoning: reasoning || resp.reasoning, toolCalls, usage: usage ?? resp.usage, resolvedModel: resolvedModel ?? resp.resolvedModel, finishReason: finishReason ?? resp.finishReason };
  }
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

// =============================================================================
// Truncation continuation — shared by the task loop and the single-shot chat
// path (src/agent/session.ts processChat). A finish_reason=length response is
// a model that ran out of output budget mid-answer, never a final answer: keep
// generating in follow-up turns until the answer completes, the budget is
// exhausted, or a follow-up turn asks for tools instead of more prose.
// =============================================================================

/**
 * How many times a length-truncated generation may be re-prompted before the
 * truncated answer is accepted. ONE shared budget — the loop and the chat path
 * previously diverged (4 vs 3) with two private copies of this logic.
 */
export const TRUNCATION_CONTINUATION_LIMIT = 4;

/**
 * Re-prompt sent after each truncated segment. The model is asked to continue
 * exactly where it stopped so the accumulated segments merge into one coherent
 * answer rather than a restarted draft.
 */
export const TRUNCATION_CONTINUE_PROMPT =
  "Your previous response was cut off at the model's output token limit. " +
  "Continue exactly from where you stopped — do not repeat any content — and " +
  "produce the remaining parts of the complete answer.";

/** One follow-up generation segment produced while continuing a truncated reply. */
export type TruncatedGenerationSegment = {
  /** The new delta produced for THIS continuation (never the cumulative text). */
  text: string;
  reasoning?: string;
  finishReason?: string;
  toolCalls?: readonly ToolCall[];
  usage?: TokenUsage;
  resolvedModel?: string;
};

export type ContinueTruncatedGenerationOptions = {
  /** The first segment that was cut off by finish_reason=length. */
  initialText: string;
  /**
   * Conversation preceding the truncated reply. The helper appends continuation
   * turns to its own working copy, so callers never have to stage the partial
   * assistant reply / re-prompt themselves.
   */
  messages: readonly NormalizedMessage[];
  /**
   * Perform exactly ONE follow-up generation from the supplied conversation.
   * Callers pass the request pieces they already own (provider, system prompt,
   * output ceiling, tools). The helper owns the accumulate-and-merge loop.
   */
  generateNext: (messages: NormalizedMessage[]) => Promise<TruncatedGenerationSegment>;
  /** Re-prompt budget. Defaults to TRUNCATION_CONTINUATION_LIMIT. */
  maxContinuations?: number;
  /** Invoked before each continuation generation; `attempt` is 1-based. */
  onContinuation?: (info: { attempt: number; chars: number }) => void | Promise<void>;
};

export type ContinueTruncatedGenerationResult = {
  /** Every segment concatenated in order — the complete un-truncated answer. */
  text: string;
  reasoning?: string;
  finishReason?: string;
  toolCalls?: readonly ToolCall[];
  usage?: TokenUsage;
  resolvedModel?: string;
  /** Number of follow-up generations actually performed. */
  continuations: number;
};

/**
 * Continue a finish_reason=length generation. Only the LAST partial segment is
 * appended before each re-prompt (never the cumulative text), so the model's
 * context grows linearly with the number of continuations rather than
 * quadratically. Stops when a continuation produces no text, requests tools,
 * finishes cleanly (finishReason !== "length"), or the budget runs out.
 */
export async function continueTruncatedGeneration(
  options: ContinueTruncatedGenerationOptions,
): Promise<ContinueTruncatedGenerationResult> {
  const maxContinuations = options.maxContinuations ?? TRUNCATION_CONTINUATION_LIMIT;
  const working: NormalizedMessage[] = [...options.messages];
  let text = options.initialText;
  let segmentToContinue = options.initialText;
  let last: TruncatedGenerationSegment | undefined;
  let continuations = 0;
  for (; continuations < maxContinuations; continuations++) {
    const attempt = continuations + 1;
    await options.onContinuation?.({ attempt, chars: segmentToContinue.length });
    working.push({ role: "assistant", content: segmentToContinue });
    working.push({ role: "user", content: TRUNCATION_CONTINUE_PROMPT });
    last = await options.generateNext(working);
    if (!last.text || last.text.length === 0) break;
    text += last.text;
    segmentToContinue = last.text;
    if ((last.toolCalls?.length ?? 0) > 0) break;
    if (last.finishReason !== "length") break;
  }
  return {
    text,
    reasoning: last?.reasoning,
    finishReason: last?.finishReason,
    toolCalls: last?.toolCalls,
    usage: last?.usage,
    resolvedModel: last?.resolvedModel,
    continuations,
  };
}

