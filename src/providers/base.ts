import type { ModelAdapter, ModelCapabilities, NormalizedRequest, NormalizedResponse, StreamChunk, ToolCall } from "./types.js";
import type { EditFormat } from "../patch/edit-format-policy.js";
import { resolveParallelToolCalls } from "./parallel-tool-calls.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string
  ) {
    super(`API error ${status}: ${detail}`);
    this.name = "ApiError";
  }
}

export function extractSummary(args: Record<string, unknown>): string | undefined {
  const s = args.summary;
  if (typeof s === "string") {
    delete args.summary;
    return s;
  }
  return undefined;
}

export function parseToolArgs(raw: unknown): Record<string, unknown> | undefined {
  let args: Record<string, unknown>;
  if (raw == null || raw === "") {
    args = {};
  } else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
      args = parsed as Record<string, unknown>;
    } catch {
      return undefined;
    }
  } else if (typeof raw === "object" && !Array.isArray(raw)) {
    args = { ...(raw as Record<string, unknown>) };
  } else {
    return undefined;
  }
  for (const k of ["__proto__", "prototype", "constructor"]) delete (args as any)[k];
  return args;
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

  /**
   * Centralized parallelToolCalls resolution for Shotgun Surgery fix.
   * Provider files no longer call `resolveParallelToolCalls` directly;
   * they delegate to this single base getter (model-resolver remains the
   * only other call site via discoveredCapabilities).
   * Source-explicit: provider + model + transport/configuration, fail-closed.
   */
  protected get parallelToolCallsResolved(): boolean {
    const provider = (this as unknown as { id: string }).id ?? "";
    if (provider === "local-llama") {
      return resolveParallelToolCalls({ provider, model: this._model, transport: "jinja", jinjaEnabled: true });
    }
    if (provider === "openrouter") {
      return resolveParallelToolCalls({ provider, model: this._model, transport: "http" });
    }
    return resolveParallelToolCalls({ provider, model: this._model });
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

  private static _toolIdCounter = 0;

  protected safeToolId(id: string | null | undefined): string {
    if (typeof id === "string" && id.length > 0) return id;
    // Strictly monotonic counter + crypto random ensures distinctness even within same ms (no collision)
    const counter = BaseProvider._toolIdCounter++;
    const rand = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    return `call_${Date.now().toString(36)}_${counter.toString(36)}_${rand}`;
  }

  protected parseChoiceToolCalls(choice: { message?: { content?: string | null; tool_calls?: Array<{ id?: string | null; type?: string; function: { name: string; arguments: string | Record<string, unknown> } }> } }): ToolCall[] {
    const message = choice.message as any;
    // Path 1: message.tool_calls (OpenAI-compatible) — array of N, normalize to ALiX toolCalls[]
    if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
      const out: ToolCall[] = [];
      for (const tc of message.tool_calls) {
        if (!tc || typeof tc !== "object") continue;
        const fn = (tc as any).function;
        if (!fn || typeof fn !== "object") continue;
        const name = fn.name;
        if (typeof name !== "string" || name.trim().length === 0) continue;
        const args = parseToolArgs(fn.arguments);
        if (args === undefined) continue;
        const summary = extractSummary(args);
        out.push({ id: this.safeToolId((tc as any).id), name: name.trim(), args, summary });
      }
      if (out.length > 0) return out;
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
        const fn = block.function as { name?: string; arguments?: string | Record<string, unknown> };
        const parsed = parseToolArgs(fn.arguments as unknown);
        if (parsed === undefined) continue;
        const summary = extractSummary(parsed);
        toolCalls.push({ id: this.safeToolId(null), name: fn.name ?? "", args: parsed, summary });
      }
    }
    return toolCalls;
  }

  abstract get capabilities(): ModelCapabilities;
  abstract id: string;
  abstract editFormatPreference: EditFormat;
  abstract longContextStrategy: "expanded_context" | "trimmed_context";
  abstract complete(request: NormalizedRequest): Promise<NormalizedResponse>;
  abstract stream(request: NormalizedRequest): AsyncGenerator<StreamChunk>;
}