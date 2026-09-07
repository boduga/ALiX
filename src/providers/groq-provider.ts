import { BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import type { ModelCallOptions, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type GroqConfig = {
  apiKey?: string;
  model?: string;
};

export class GroqProvider extends BaseProvider {
  id = "groq";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  get capabilities() {
    return {
      provider: "groq",
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: false,
      parallelToolCalls: this.parallelToolCallsResolved,
    };
  }

  constructor(config: GroqConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.GROQ_API_KEY ?? "",
      model: config.model ?? "llama-3.1-70b",
      baseUrl: "https://api.groq.com",
      timeoutMs: 120_000,
    });
  }

  async complete(request: NormalizedRequest, options?: ModelCallOptions): Promise<NormalizedResponse> {
    return complete("groq", this._model, request, {
      apiKey: this._apiKey,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }

  async *stream(request: NormalizedRequest, options?: ModelCallOptions): AsyncGenerator<StreamChunk> {
    yield* stream("groq", this._model, request, {
      apiKey: this._apiKey,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }
}