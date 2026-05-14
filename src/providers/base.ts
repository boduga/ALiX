import type { ModelAdapter, ModelCapabilities, NormalizedRequest, NormalizedResponse, StreamChunk, ToolCall } from "./types.js";
import type { EditFormat } from "../patch/edit-format-policy.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string
  ) {
    super(`API error ${status}: ${detail}`);
    this.name = "ApiError";
  }
}

export abstract class BaseProvider implements ModelAdapter {
  protected _apiKey: string;
  protected _model: string;
  protected _baseUrl: string;
  protected _timeoutMs: number;

  constructor(options: { apiKey?: string; model: string; baseUrl: string; timeoutMs?: number }) {
    this._apiKey = options.apiKey ?? "";
    this._model = options.model;
    this._baseUrl = options.baseUrl;
    this._timeoutMs = options.timeoutMs ?? 120_000;
  }

  protected async post(body: Record<string, unknown>): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this._apiKey) {
      headers["Authorization"] = `Bearer ${this._apiKey}`;
    }
    const extra = this.extraHeaders();
    for (const [k, v] of Object.entries(extra)) {
      headers[k] = v;
    }

    return fetch(`${this._baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: this._model, ...body }),
      signal: AbortSignal.timeout(this._timeoutMs),
    });
  }

  protected extraHeaders(): Record<string, string> {
    return {};
  }

  protected safeToolId(id: string | null | undefined): string {
    return id ?? `call_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  protected parseChoiceToolCalls(choice: { message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }): ToolCall[] {
    const message = choice.message;
    // Path 1: message.tool_calls (OpenAI-compatible)
    if (message?.tool_calls?.length) {
      return message.tool_calls.map((tc) => ({
        id: this.safeToolId(tc.id),
        name: tc.function.name ?? "",
        args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
      }));
    }
    // Path 2: message.content as array (OpenAI function-calling in content)
    return this.parseOpenAIToolCalls(message?.content);
  }

  // parseOpenAIToolCalls parses content when it's an array of {type:"function", function:{name, arguments}}
  protected parseOpenAIToolCalls(content: unknown): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    if (!Array.isArray(content)) return toolCalls;
    for (const block of content) {
      if (block && typeof block === "object" && "type" in block && block.type === "function" && "function" in block && block.function && typeof block.function === "object") {
        const fn = block.function as { name?: string; arguments?: string };
        toolCalls.push({ id: this.safeToolId(null), name: fn.name ?? "", args: fn.arguments ? JSON.parse(fn.arguments) : {} });
      }
    }
    return toolCalls;
  }

  protected async *streamSSE(res: Response): AsyncGenerator<StreamChunk> {
    if (!res.ok) { yield { type: "error", error: `API error ${res.status}` }; return; }
    if (!res.body) { yield { type: "error", error: "No response body" }; return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Accumulate tool calls across deltas by index
    const partialTools: Record<number, { id: string; name: string; args: string }> = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) { yield { type: "done" }; return; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") { yield { type: "done" }; return; }
        try {
          const event = JSON.parse(data);
          if (event.choices?.[0]?.delta?.content) yield { type: "text_delta", text: event.choices[0].delta.content };

          if (event.choices?.[0]?.delta?.tool_calls) {
            for (const tc of event.choices[0].delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (tc.id && !partialTools[idx]) partialTools[idx] = { id: tc.id, name: "", args: "" };
              if (tc.function?.name) partialTools[idx].name = tc.function.name;
              if (tc.function?.arguments) partialTools[idx].args += tc.function.arguments;
              // Yield when arguments JSON is complete (ends with })
              if (tc.function?.arguments && tc.function.arguments.trim().endsWith("}")) {
                const t = partialTools[idx];
                if (t.name) {
                  try {
                    yield { type: "tool_call" as const, toolCall: { id: t.id, name: t.name, args: JSON.parse(t.args) } };
                  } catch { /* incomplete JSON, keep accumulating */ }
                }
                delete partialTools[idx];
              }
            }
          }

          if (event.usage) yield { type: "usage", usage: { inputTokens: event.usage.prompt_tokens, outputTokens: event.usage.completion_tokens } };
        } catch { /* skip */ }
      }
    }
  }

  abstract get capabilities(): ModelCapabilities;
  abstract id: string;
  abstract editFormatPreference: EditFormat;
  abstract longContextStrategy: "expanded_context" | "trimmed_context";
  abstract complete(request: NormalizedRequest): Promise<NormalizedResponse>;
  abstract stream(request: NormalizedRequest): AsyncGenerator<StreamChunk>;
}