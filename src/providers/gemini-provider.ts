import { BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type GeminiConfig = {
  apiKey?: string;
  model?: string;
};

export class GeminiProvider extends BaseProvider {
  id = "google";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "expanded_context" as const;

  get capabilities() {
    return {
      provider: "google",
      model: this._model,
      inputTokenLimit: 1_000_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: true,
    };
  }

  constructor(config: GeminiConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.GEMINI_API_KEY ?? "",
      model: config.model ?? "gemini-2.5-flash",
      baseUrl: "https://generativelanguage.googleapis.com",
      timeoutMs: 120_000,
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    return complete("google", this._model, request, { apiKey: this._apiKey });
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    yield* stream("google", this._model, request, { apiKey: this._apiKey });
  }
}
