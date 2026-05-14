import { randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import type {
  ModelAdapter,
  NormalizedRequest,
  NormalizedResponse,
  StreamChunk,
  ToolDef,
  ToolCall,
} from "./types.js";
import { ApiError } from "./base.js";

export type AnthropicConfig = {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
};

// Built-in tools exposed to the model
const ALIX_TOOLS: ToolDef[] = [
  {
    name: "file.read",
    description: "Read the contents of a file from the workspace.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Root directory (defaults to workspace)" },
        path: { type: "string", description: "Relative path to the file" }
      },
      required: ["path"]
    }
  },
  {
    name: "dir.search",
    description: "Search for a pattern across all files in the workspace.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Root directory (defaults to workspace)" },
        pattern: { type: "string", description: "Text pattern to search for" },
        extensions: { type: "string[]", description: "File extensions to include, e.g. ['.ts', '.js']" }
      },
      required: ["pattern"]
    }
  },
  {
    name: "shell.run",
    description: "Run a shell command in the workspace.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to run" },
        cwd: { type: "string", description: "Working directory (defaults to workspace)" },
        timeoutMs: { type: "number", description: "Timeout in milliseconds" }
      },
      required: ["command"]
    }
  },
  {
    name: "patch.apply",
    description: "Apply a code patch to one or more files using search/replace.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Root directory (defaults to workspace)" },
        format: { type: "string", description: "Patch format: search_replace or structured_patch" },
        patchText: { type: "string", description: "The patch content" }
      },
      required: ["format", "patchText"]
    }
  }
];

export class AnthropicProvider implements ModelAdapter {
  id = "anthropic";
  editFormatPreference = "search_replace" as const;
  longContextStrategy = "trimmed_context" as const;

  private _apiKey: string;
  private _model: string;
  private _maxTokens: number;

  constructor(config: AnthropicConfig = {}) {
    this._apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this._model = config.model ?? "claude-sonnet-4-6";
    this._maxTokens = config.maxTokens ?? 8192;
  }

  get capabilities() {
    return {
      provider: "anthropic" as const,
      model: this._model,
      inputTokenLimit: 200_000,
      outputTokenLimit: 8192,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: true
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }

    const tools = request.tools ?? ALIX_TOOLS;

    const body: Record<string, unknown> = {
      model: this._model,
      max_tokens: this._maxTokens,
      system: request.systemPrompt,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content
      }))
    };

    if (tools.length > 0) {
      body.tools = tools;
    }

    if (request.structuredOutputSchema) {
      body.output = {
        type: "json",
        schema: request.structuredOutputSchema,
      };
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this._apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000)
    });

    if (!response.ok) {
      const body = await response.text();
      let detail = body;
      try {
        const parsed = JSON.parse(body);
        if (parsed.error?.type === "invalid_request_error") {
          detail = parsed.error.message ?? body;
        }
      } catch { /* not json */ }
      throw new ApiError(response.status, detail);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string }>;
      stop_reason?: string;
    };

    const toolCalls: ToolCall[] = [];
    let text = "";

    for (const block of data.content) {
      if (block.type === "text") {
        text += block.text ?? "";
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id ?? randomUUID(),
          name: block.name ?? "",
          args: block.input ?? {}
        });
      }
    }

    return { text: text.trim(), toolCalls };
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    if (!this._apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

    const tools = request.tools ?? ALIX_TOOLS;
    const body: Record<string, unknown> = {
      model: this._model,
      max_tokens: this._maxTokens,
      system: request.systemPrompt,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    };
    if (tools.length > 0) body.tools = tools;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this._apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const body = await res.text();
      let detail = body;
      try {
        const parsed = JSON.parse(body);
        if (parsed.error?.type === "invalid_request_error") {
          detail = parsed.error.message ?? body;
        }
      } catch { /* not json */ }
      yield { type: "error" as const, error: detail };
      return;
    }
    if (!res.body) { yield { type: "error" as const, error: "No response body" }; return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) { yield { type: "done" }; return; }
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const dataLine = part.split("\n").find(l => l.startsWith("data:"));
        if (!dataLine) continue;
        const data = dataLine.slice(5);
        if (data === "[DONE]") { yield { type: "done" }; return; }
        try {
          const event = JSON.parse(data);
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            yield { type: "text_delta", text: event.delta.text };
          }
          if (event.type === "message_delta" && event.usage) {
            yield { type: "usage", usage: { inputTokens: event.usage.input_tokens, outputTokens: event.usage.output_tokens } };
          }
        } catch { /* skip */ }
      }
    }
  }
}