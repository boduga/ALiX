import { BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type OpenRouterConfig = {
  apiKey?: string;
  model?: string;
};

export class OpenRouterProvider extends BaseProvider {
  id = "openrouter";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  get capabilities() {
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

  constructor(config: OpenRouterConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.OPENROUTER_API_KEY ?? "",
      model: config.model ?? "openai/gpt-4o",
      baseUrl: "https://openrouter.ai/api",
      timeoutMs: 120_000,
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    return complete("openrouter", this._model, request, { apiKey: this._apiKey });
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    yield* stream("openrouter", this._model, request, { apiKey: this._apiKey });
  }
}