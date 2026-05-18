import { BaseProvider, ApiError } from "./base.js";
import type { ModelCapabilities, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type OllamaConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};

function parseTextToolCall(text: string): { name: string; args: Record<string, unknown> } | null {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let end = start; end < text.length; end++) {
      const char = text[end];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = inString;
        continue;
      }
      if (char === "\"") {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (char === "{") depth++;
      if (char === "}") depth--;

      if (depth === 0) {
        const toolCall = parseToolCallJson(text.slice(start, end + 1));
        if (toolCall) return toolCall;
        break;
      }
    }
  }

  return null;
}

function parseToolCallJson(candidate: string): { name: string; args: Record<string, unknown> } | null {
  const trimmed = candidate.trim();
  try {
    return parseToolCallObject(JSON.parse(trimmed));
  } catch { /* try constrained repair below */ }

  const repaired = trimmed.replace(
    /(["']name["']\s*:\s*)([A-Za-z_][A-Za-z0-9_.-]*)(\s*[,}])/,
    "$1\"$2\"$3"
  ).replace(/:\s*None(\s*[,}])/g, ": null$1")
    .replace(/:\s*True(\s*[,}])/g, ": true$1")
    .replace(/:\s*False(\s*[,}])/g, ": false$1");
  if (repaired === trimmed) return null;

  try {
    return parseToolCallObject(JSON.parse(repaired));
  } catch { /* not a JSON tool call */ }

  return null;
}

function parseToolCallObject(parsed: any): { name: string; args: Record<string, unknown> } | null {
  try {
    const name = parsed.name ?? parsed.function?.name;
    const rawArgs = parsed.arguments ?? parsed.parameters ?? parsed.args ?? {};
    const args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
    if (name && typeof name === "string" && args && typeof args === "object" && !Array.isArray(args)) {
      return { name, args: args as Record<string, unknown> };
    }
  } catch { /* not a JSON tool call */ }

  return null;
}

export class OllamaProvider extends BaseProvider {
  id = "ollama";
  editFormatPreference = "search_replace" as const;
  longContextStrategy = "trimmed_context" as const;

  constructor(config: OllamaConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.OLLAMA_API_KEY ?? "",
      model: config.model ?? "llama3",
      baseUrl: config.baseUrl ?? "http://localhost:11434",
    });
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "ollama",
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: false,
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    // Try non-streaming v1 request first — more reliable than buffering SSE.
    const body: Record<string, unknown> = {
      model: this._model,
      messages: request.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content })),
      stream: false,
    };
    if (request.systemPrompt) body.messages = [{ role: "system", content: request.systemPrompt }, ...(body.messages as object[])];
    const hasTools = request.tools && request.tools.length > 0;
    if (hasTools) {
      body.tools = request.tools!.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));
    }

    let res = await this.post(body);
    if (!res.ok) {
      const errText = await res.clone().text();
      if (errText.includes("does not support") || errText.includes("not supported")) {
        delete body.tools;
        delete body.stream;
        body.stream = false;
        res = await this.post(body);
      }
    }

    if (!res.ok) {
      const errText = await res.clone().text();
      throw new Error(`Ollama API error ${res.status}: ${errText}`);
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
      message?: { content?: string };
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const choice = data.choices?.at(-1);
    const toolCalls = choice ? this.parseChoiceToolCalls(choice) : [];
    let text = choice?.message?.content ?? data.message?.content ?? "";
    if (toolCalls.length === 0 && text) {
      const parsedToolCall = parseTextToolCall(text);
      if (parsedToolCall) {
        toolCalls.push({ id: this.safeToolId(null), name: parsedToolCall.name, args: parsedToolCall.args });
        text = "";
      }
    }
    return {
      text: text.trim(),
      toolCalls,
      usage: data.usage
        ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
        : undefined,
    };
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    const body: Record<string, unknown> = {
      model: this._model,
      messages: request.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content })),
      stream: true,
    };
    if (request.systemPrompt) body.messages = [{ role: "system", content: request.systemPrompt }, ...(body.messages as object[])];
    const hasTools = request.tools && request.tools.length > 0;
    if (hasTools) body.tools = request.tools!.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    if (request.temperature !== undefined) body.temperature = request.temperature;

    let res = await this.post(body);

    if (!res.ok && hasTools) {
      const errText = await res.clone().text();
      if (errText.includes("does not support tools")) {
        delete body.tools;
        res = await this.post(body);
      }
    }

    // Always buffer the SSE stream fully first. This handles two cases:
    // 1. Models (qwen) where streaming with tools can hang in non-streaming mode.
    // 2. Ensures the JSON-in-text fallback sees the complete accumulated text.
    const chunks: StreamChunk[] = [];
    for await (const chunk of this.streamSSE(res)) {
      chunks.push(chunk);
    }

    let text = "";
    const toolCalls: import("./types.js").ToolCall[] = [];
    for (const chunk of chunks) {
      if (chunk.type === "text_delta") text += chunk.text;
      if (chunk.type === "tool_call") toolCalls.push(chunk.toolCall);
      if (chunk.type === "error") yield chunk;
    }

    // JSON-in-text fallback: find the last complete JSON object in the text.
    if (toolCalls.length === 0 && text) {
      const parsedToolCall = parseTextToolCall(text);
      if (parsedToolCall) {
        toolCalls.push({ id: this.safeToolId(null), name: parsedToolCall.name, args: parsedToolCall.args });
        text = "";
      }
    }

    if (text) yield { type: "text_delta", text };
    for (const tc of toolCalls) yield { type: "tool_call", toolCall: tc };
  }
}
