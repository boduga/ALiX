import type { ModelAdapter, NormalizedRequest, NormalizedResponse } from "./types.js";

export type AnthropicConfig = {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
};

export class AnthropicProvider implements ModelAdapter {
  id = "anthropic";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  private _apiKey: string;
  private _model: string;
  private _maxTokens: number;

  constructor(config: AnthropicConfig = {}) {
    this._apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this._model = config.model ?? "claude-sonnet-4-7-20250514";
    this._maxTokens = config.maxTokens ?? 4096;
  }

  get capabilities() {
    return {
      provider: "anthropic" as const,
      model: this._model,
      inputTokenLimit: 200_000,
      outputTokenLimit: 8192,
      supportsTools: true,
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsVision: true
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }

    const body = {
      model: this._model,
      max_tokens: this._maxTokens,
      system: request.systemPrompt,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content
      }))
    };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this._apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${error}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };

    const text = data.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");

    return { text, toolCalls: [] };
  }
}