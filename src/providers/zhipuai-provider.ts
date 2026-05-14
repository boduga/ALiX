import { BaseProvider, ApiError } from "./base.js";
import type { ModelCapabilities, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type ZhipuAIConfig = {
  apiKey?: string;
  model?: string;
};

export class ZhipuAIProvider extends BaseProvider {
  id = "zhipuai";
  editFormatPreference = "search_replace" as const;
  longContextStrategy = "trimmed_context" as const;

  constructor(config: ZhipuAIConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.ZHIPUAI_API_KEY ?? "",
      model: config.model ?? "glm-4-flash",
      baseUrl: "https://open.bigmodel.cn",
    });
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "zhipuai",
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsVision: false,
    };
  }

  private async fetch(body: Record<string, unknown>): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this._apiKey) {
      headers["Authorization"] = `Bearer ${this._apiKey}`;
    }
    return fetch(`${this._baseUrl}/api/paas/v4/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) throw new Error("ZHIPUAI_API_KEY is not set");

    const messages: Array<{ role: string; content: string }> = request.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : String(m.content),
    }));

    if (request.systemPrompt) {
      messages.unshift({ role: "system", content: request.systemPrompt });
    }

    const body: Record<string, unknown> = {
      model: this._model,
      messages,
    };

    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));
    }

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens;

    const response = await this.fetch(body);

    if (!response.ok) {
      const err = await response.text();
      throw new ApiError(response.status, err);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
    };

    const choice = data.choices.at(-1)!;
    const toolCalls = this.parseChoiceToolCalls(choice as any);
    let text = "";
    if (typeof choice.message?.content === "string") text = choice.message.content;

    return { text: text.trim(), toolCalls };
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    if (!this._apiKey) throw new Error("ZHIPUAI_API_KEY is not set");

    const messages: Array<{ role: string; content: string }> = request.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : String(m.content),
    }));
    if (request.systemPrompt) messages.unshift({ role: "system", content: request.systemPrompt });

    const body: Record<string, unknown> = { model: this._model, messages, stream: true };
    if (request.tools?.length) body.tools = request.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens;

    const res = await this.fetch(body);
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
        if (data === "[DONE]") { yield { type: "done" }; return; }
        try {
          const event = JSON.parse(data);
          if (event.choices?.[0]?.delta?.content) yield { type: "text_delta", text: event.choices[0].delta.content };
          if (event.choices?.[0]?.delta?.tool_calls) {
            for (const tc of event.choices[0].delta.tool_calls) {
              yield { type: "tool_call", toolCall: { id: tc.id ?? this.safeToolId(null), name: tc.function?.name ?? "", args: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {} } };
            }
          }
          if (event.usage) yield { type: "usage", usage: { inputTokens: event.usage.prompt_tokens, outputTokens: event.usage.completion_tokens } };
        } catch { /* skip */ }
      }
    }
  }
}