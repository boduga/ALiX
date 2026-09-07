import { BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import type { ModelCallOptions, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

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
      parallelToolCalls: this.parallelToolCallsResolved,
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

  async complete(request: NormalizedRequest, options?: ModelCallOptions): Promise<NormalizedResponse> {
    return complete("deepseek", this._model, request, {
      apiKey: this._apiKey,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }

  async *stream(request: NormalizedRequest, options?: ModelCallOptions): AsyncGenerator<StreamChunk> {
    yield* stream("deepseek", this._model, request, {
      apiKey: this._apiKey,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }
}
