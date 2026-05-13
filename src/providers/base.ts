import type { ModelAdapter, ModelCapabilities, NormalizedRequest, NormalizedResponse, ToolCall } from "./types.js";
import type { EditFormat } from "../patch/edit-format-policy.js";

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

  protected parseOpenAIToolCalls(content: unknown): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    if (!Array.isArray(content)) return toolCalls;
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        "type" in block &&
        block.type === "function" &&
        "function" in block &&
        block.function &&
        typeof block.function === "object"
      ) {
        const fn = block.function as { name?: string; arguments?: string };
        toolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          name: fn.name ?? "",
          args: fn.arguments ? JSON.parse(fn.arguments) : {},
        });
      }
    }
    return toolCalls;
  }

  abstract get capabilities(): ModelCapabilities;
  abstract id: string;
  abstract editFormatPreference: EditFormat;
  abstract longContextStrategy: "expanded_context" | "trimmed_context";
  abstract complete(request: NormalizedRequest): Promise<NormalizedResponse>;
}