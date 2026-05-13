import { BaseProvider } from "./base.js";
import type { ModelCapabilities, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type OpenAIConfig = {
  apiKey?: string;
  model?: string;
};

export class OpenAIProvider extends BaseProvider {
  id = "openai";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  constructor(config: OpenAIConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.OPENAI_API_KEY ?? "",
      model: config.model ?? "gpt-4o",
      baseUrl: "https://api.openai.com",
    });
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "openai",
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: 16_384,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: true,
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }

    const body: Record<string, unknown> = {
      messages: request.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : m.content,
      })),
    };

    if (request.systemPrompt) {
      body.messages = [
        { role: "system", content: request.systemPrompt },
        ...(body.messages as object[]),
      ];
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));
    }

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens;

    const response = await this.post(body);
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          role: string;
          content: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = data.choices.at(-1)!;
    const toolCalls = this.parseChoiceToolCalls(choice as any);
    let text = "";
    const rawContent = (choice as any).message?.content;
    if (typeof rawContent === "string") text = rawContent;

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
      messages: request.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content })),
      stream: true,
    };
    if (request.systemPrompt) body.messages = [{ role: "system", content: request.systemPrompt }, ...(body.messages as object[])];
    if (request.tools?.length) body.tools = request.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens;

    const res = await this.post(body);
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