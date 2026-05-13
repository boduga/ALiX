import { randomUUID } from "node:crypto";
import type { ModelAdapter, ModelCapabilities, NormalizedRequest, NormalizedResponse, StreamChunk, ToolCall } from "./types.js";

export type GeminiConfig = {
  apiKey?: string;
  model?: string;
};

export class GeminiProvider implements ModelAdapter {
  id = "google";
  editFormatPreference = "search_replace" as const;
  longContextStrategy = "expanded_context" as const;

  private _apiKey: string;
  private _model: string;

  constructor(config: GeminiConfig = {}) {
    this._apiKey = config.apiKey ?? process.env.GEMINI_API_KEY ?? "";
    this._model = config.model ?? "gemini-2.0-flash";
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "google",
      model: this._model,
      inputTokenLimit: 1_000_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsVision: true,
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) throw new Error("GEMINI_API_KEY is not set");

    const contents = request.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts:
        typeof m.content === "string"
          ? [{ text: m.content }]
          : m.content.map((p) => ("text" in p ? { text: p.text } : { inlineData: { mimeType: p.mediaType ?? "image/png", data: p.source } })),
    }));

    const body: Record<string, unknown> = {
      contents,
    };

    if (request.systemPrompt) {
      body.system_instruction = { parts: [{ text: request.systemPrompt }] };
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = {
        functionDeclarations: request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        })),
      };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this._model}:generateContent?key=${this._apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }>;
        };
      }>;
    };

    const parts = data.candidates?.at(-1)?.content?.parts ?? [];
    let text = "";
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if (part.text) text += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: randomUUID(),
          name: part.functionCall.name,
          args: part.functionCall.args,
        });
      }
    }

    return { text: text.trim(), toolCalls };
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    if (!this._apiKey) throw new Error("GEMINI_API_KEY is not set");

    const contents = request.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: typeof m.content === "string" ? [{ text: m.content }] : m.content.map((p) => ("text" in p ? { text: p.text } : { inlineData: { mimeType: p.mediaType ?? "image/png", data: p.source } })),
    }));

    const body: Record<string, unknown> = { contents };
    if (request.systemPrompt) body.system_instruction = { parts: [{ text: request.systemPrompt }] };
    if (request.tools?.length) body.tools = { functionDeclarations: request.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.input_schema })) };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this._model}:generateContent?key=${this._apiKey}&alt=sse`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) { yield { type: "error", error: `API error ${res.status}` }; return; }
    if (!res.body) { yield { type: "error", error: "No response body" }; return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) { yield { type: "done" }; return; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        try {
          const event = JSON.parse(data);
          const parts = event.candidates?.[0]?.content?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.text) yield { type: "text_delta", text: part.text };
              if (part.functionCall) {
                yield { type: "tool_call", toolCall: { id: randomUUID(), name: part.functionCall.name, args: part.functionCall.args ?? {} } };
              }
            }
          }
        } catch { /* skip */ }
      }
    }
  }
}
