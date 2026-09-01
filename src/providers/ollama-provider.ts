import { BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type OllamaConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};

export class OllamaProvider extends BaseProvider {
  id = "ollama";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  get capabilities() {
    return {
      provider: "ollama",
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: false,
    };
  }

  constructor(config: OllamaConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.OLLAMA_API_KEY ?? "",
      model: config.model ?? "llama3.2",
      baseUrl: config.baseUrl ?? "http://localhost:11434",
      // Ollama cold-starts by loading the model into RAM, which can take a
      // while on slower machines — give it extra headroom beyond the 120s
      // default, matching local-llama's intent.
      timeoutMs: 300_000,
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    return complete("ollama", this._model, request, {
      apiKey: this._apiKey,
      signal: AbortSignal.timeout(this._timeoutMs),
    });
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    yield* stream("ollama", this._model, request, {
      apiKey: this._apiKey,
      signal: AbortSignal.timeout(this._timeoutMs),
    });
  }
}