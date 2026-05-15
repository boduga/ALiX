import { BaseProvider, ApiError } from "./base.js";
import type { ModelCapabilities, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type OllamaConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};

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

    let res = await this.post(body);
    if (!res.ok) {
      const errText = await res.clone().text();
      if (errText.includes("does not support") || errText.includes("not supported")) {
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
      choices?: Array<{ message?: { content?: string } }>;
      message?: { content?: string };
    };
    const text = data.choices?.[0]?.message?.content ?? data.message?.content ?? "";
    return { text: text.trim(), toolCalls: [] };
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
      const lastBrace = text.lastIndexOf("}");
      const candidate = lastBrace >= 0 ? text.slice(0, lastBrace + 1).trim() : text.trim();
      if (candidate.startsWith("{")) {
        try {
          const parsed = JSON.parse(candidate);
          const name = parsed.name ?? parsed.function?.name;
          const args = parsed.arguments ?? parsed.parameters ?? parsed.args ?? {};
          if (name && typeof name === "string" && args) {
            toolCalls.push({ id: this.safeToolId(null), name, args });
            text = "";
          }
        } catch { /* not JSON */ }
      }
    }

    if (text) yield { type: "text_delta", text };
    for (const tc of toolCalls) yield { type: "tool_call", toolCall: tc };
  }
}