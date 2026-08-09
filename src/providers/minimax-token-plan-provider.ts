import { BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type MiniMaxTokenPlanConfig = {
  apiKey?: string;
  model?: string;
};

export class MiniMaxTokenPlanProvider extends BaseProvider {
  id = "minimax-token-plan";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "expanded_context" as const;

  get capabilities() {
    return {
      provider: "minimax-token-plan",
      model: this._model,
      inputTokenLimit: 1_000_000,
      outputTokenLimit: 64_000,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: true,
    };
  }

  constructor(config: MiniMaxTokenPlanConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.MINIMAX_TOKEN_PLAN_KEY ?? "",
      model: config.model ?? "MiniMax-M3",
      baseUrl: "https://api.minimax.io/anthropic",
      timeoutMs: 120_000,
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    return complete("minimax-token-plan", this._model, request, { apiKey: this._apiKey });
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    yield* stream("minimax-token-plan", this._model, request, { apiKey: this._apiKey });
  }
}
