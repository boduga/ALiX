import { BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type PerplexityConfig = {
  apiKey?: string;
  model?: string;
};

export class PerplexityProvider extends BaseProvider {
  id = "perplexity";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  get capabilities() {
    return {
      provider: "perplexity",
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsVision: false,
    };
  }

  constructor(config: PerplexityConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.PERPLEXITY_API_KEY ?? "",
      model: config.model ?? "llama-3.1-sonar-large-128k-online",
      baseUrl: "https://api.perplexity.ai",
      timeoutMs: 120_000,
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    return complete("perplexity", this._model, request, { apiKey: this._apiKey });
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    yield* stream("perplexity", this._model, request, { apiKey: this._apiKey });
  }
}