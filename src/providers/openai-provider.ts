import { BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type OpenAIConfig = {
  apiKey?: string;
  model?: string;
};

export class OpenAIProvider extends BaseProvider {
  id = "openai";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  get capabilities() {
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

  constructor(config: OpenAIConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.OPENAI_API_KEY ?? "",
      model: config.model ?? "gpt-4o",
      baseUrl: "https://api.openai.com",
      timeoutMs: 120_000,
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    return complete("openai", this._model, request, { apiKey: this._apiKey });
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    yield* stream("openai", this._model, request, { apiKey: this._apiKey });
  }
}