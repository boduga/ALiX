import { BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import type { ModelCallOptions, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

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
      parallelToolCalls: this.parallelToolCallsResolved,
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

  async complete(request: NormalizedRequest, options?: ModelCallOptions): Promise<NormalizedResponse> {
    return complete("openai", this._model, request, {
      apiKey: this._apiKey,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }

  async *stream(request: NormalizedRequest, options?: ModelCallOptions): AsyncGenerator<StreamChunk> {
    yield* stream("openai", this._model, request, {
      apiKey: this._apiKey,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }
}
