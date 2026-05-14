import { BaseProvider, ApiError } from "./base.js";
import type { ModelCapabilities, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type OpenRouterConfig = {
  apiKey?: string;
  model?: string;
};

export class OpenRouterProvider extends BaseProvider {
  id = "openrouter";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  constructor(config: OpenRouterConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.OPENROUTER_API_KEY ?? "",
      model: config.model ?? "anthropic/claude-3.5-sonnet",
      baseUrl: "https://openrouter.ai/api",
    });
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "openrouter",
      model: this._model,
      inputTokenLimit: 200_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: true,
    };
  }

  protected extraHeaders(): Record<string, string> {
    return {
      "HTTP-Referer": "https://github.com/alix-cli/alix",
      "X-Title": "ALiX",
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) throw new Error("OPENROUTER_API_KEY is not set");

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

    if (request.structuredOutputSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: request.structuredOutputSchema.name, schema: request.structuredOutputSchema },
      };
    }

    const response = await this.post(body);
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
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = data.choices.at(-1)!;
    const toolCalls = this.parseChoiceToolCalls(choice as any);
    let text = "";
    if (typeof choice.message?.content === "string") text = choice.message.content;

    return {
      text: text.trim(),
      toolCalls,
      usage: data.usage
        ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
        : undefined,
    };
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    if (!this._apiKey) throw new Error("OPENROUTER_API_KEY is not set");

    const body: Record<string, unknown> = {
      messages: request.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content })),
      stream: true,
    };
    if (request.systemPrompt) body.messages = [{ role: "system", content: request.systemPrompt }, ...(body.messages as object[])];
    if (request.tools?.length) body.tools = request.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens;

    const res = await this.post(body);
    yield* this.streamSSE(res);
  }
}