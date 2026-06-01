import { BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type MiniMaxConfig = {
  apiKey?: string;
  model?: string;
  groupId?: string;
};

export class MiniMaxProvider extends BaseProvider {
  id = "minimax";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  get capabilities() {
    return {
      provider: "minimax",
      model: this._model,
      inputTokenLimit: 100_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsVision: false,
    };
  }

  constructor(config: MiniMaxConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.MINIMAX_API_KEY ?? "",
      model: config.model ?? "abab6.5s-chat",
      baseUrl: "https://api.minimax.chat",
      timeoutMs: 120_000,
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    return complete("minimax", this._model, request, { apiKey: this._apiKey });
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    yield* stream("minimax", this._model, request, { apiKey: this._apiKey });
  }
}
