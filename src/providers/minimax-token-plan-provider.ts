import { BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import type { ModelCallOptions, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

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
      parallelToolCalls: this.parallelToolCallsResolved,
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

  async complete(request: NormalizedRequest, options?: ModelCallOptions): Promise<NormalizedResponse> {
    return complete("minimax-token-plan", this._model, request, {
      apiKey: this._apiKey,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }

  async *stream(request: NormalizedRequest, options?: ModelCallOptions): AsyncGenerator<StreamChunk> {
    yield* stream("minimax-token-plan", this._model, request, {
      apiKey: this._apiKey,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }
}
