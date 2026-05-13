import type { ModelCapabilities, NormalizedRequest, NormalizedResponse } from "./types.js";
import { BaseProvider } from "./base.js";

export class OpenAIProvider extends BaseProvider {
  readonly id = "openai";

  constructor(options: { apiKey?: string; model?: string; baseUrl?: string; timeoutMs?: number }) {
    super({
      apiKey: options.apiKey,
      model: options.model ?? "gpt-4o",
      baseUrl: options.baseUrl ?? "https://api.openai.com",
      timeoutMs: options.timeoutMs,
    });
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: this.id,
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: 16_384,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: true,
    };
  }

  get editFormatPreference() {
    return "unified_diff" as const;
  }

  get longContextStrategy(): "expanded_context" | "trimmed_context" {
    return "expanded_context";
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    throw new Error("Not implemented");
  }
}