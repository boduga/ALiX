import { BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type GrokAIConfig = {
  apiKey?: string;
  model?: string;
};

export class GrokAIProvider extends BaseProvider {
  id = "grokai";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  get capabilities() {
    return {
      provider: "grokai",
      model: this._model,
      inputTokenLimit: 131_072,
      outputTokenLimit: 32_768,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsVision: false,
    };
  }

  constructor(config: GrokAIConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.GROKAI_API_KEY ?? "",
      model: config.model ?? "grok-2",
      baseUrl: "https://api.grok.ai",
      timeoutMs: 120_000,
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    return complete("grokai", this._model, request, { apiKey: this._apiKey });
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    yield* stream("grokai", this._model, request, { apiKey: this._apiKey });
  }
}