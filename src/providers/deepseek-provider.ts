import { BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type DeepSeekConfig = {
  apiKey?: string;
  model?: string;
};

export class DeepSeekProvider extends BaseProvider {
  id = "deepseek";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  get capabilities() {
    return {
      provider: "deepseek",
      model: this._model,
      inputTokenLimit: 64_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: false,
    };
  }

  constructor(config: DeepSeekConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "",
      model: config.model ?? "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      timeoutMs: 120_000,
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    return complete("deepseek", this._model, request, { apiKey: this._apiKey });
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    yield* stream("deepseek", this._model, request, { apiKey: this._apiKey });
  }
}