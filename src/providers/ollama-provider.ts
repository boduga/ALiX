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
      timeoutMs: 120_000,
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    return complete("ollama", this._model, request, { apiKey: this._apiKey });
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    yield* stream("ollama", this._model, request, { apiKey: this._apiKey });
  }
}