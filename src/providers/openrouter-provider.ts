import { BaseProvider } from "./base.js";
import type { ModelCapabilities, NormalizedRequest, NormalizedResponse } from "./types.js";

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
      supportsStreaming: false,
      supportsStructuredOutput: false,
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

    const response = await this.post(body);
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${err}`);
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

    const choice = data.choices.at(-1);
    const message = choice?.message as { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } ?? {};
    let text = "";
    const toolCalls = [];

    if (typeof message.content === "string") text = message.content;
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
        });
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
}