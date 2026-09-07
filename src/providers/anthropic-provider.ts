import { BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import type { ModelCallOptions, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type AnthropicConfig = {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
};

export class AnthropicProvider extends BaseProvider {
  id = "anthropic";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "expanded_context" as const;

  get capabilities() {
    return {
      provider: "anthropic",
      model: this._model,
      inputTokenLimit: 200_000,
      outputTokenLimit: 8192,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: true,
      parallelToolCalls: this.parallelToolCallsResolved,
    };
  }

  constructor(config: AnthropicConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "",
      model: config.model ?? "claude-opus-4-8",
      baseUrl: "https://api.anthropic.com",
      timeoutMs: 120_000,
    });
  }

  async complete(request: NormalizedRequest, options?: ModelCallOptions): Promise<NormalizedResponse> {
    return complete("anthropic", this._model, request, {
      apiKey: this._apiKey,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }

  async *stream(request: NormalizedRequest, options?: ModelCallOptions): AsyncGenerator<StreamChunk> {
    yield* stream("anthropic", this._model, request, {
      apiKey: this._apiKey,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }
}