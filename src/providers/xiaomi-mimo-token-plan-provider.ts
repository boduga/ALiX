import { BaseProvider, mergeSignals } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import { DEFAULT_XIAOMI_MIMO_BASE_URL } from "./specs/xiaomi-mimo-token-plan-spec.js";
import type { ModelCallOptions, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type XiaomiMimoTokenPlanConfig = {
  apiKey?: string;
  model?: string;
  /** Token Plan API root ending in `/v1` (ModelConfig.xiaomiMimoBaseUrl). */
  baseUrl?: string;
  /** Total call timeout (ms). Defaults to 300s: MiMo deep-thinking can run long. */
  timeoutMs?: number;
};

export class XiaomiMimoTokenPlanProvider extends BaseProvider {
  id = "xiaomi-mimo-token-plan";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "expanded_context" as const;

  get capabilities() {
    return {
      provider: "xiaomi-mimo-token-plan",
      model: this._model,
      inputTokenLimit: 1_000_000,
      outputTokenLimit: 128_000,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: true,
      parallelToolCalls: this.parallelToolCallsResolved,
    };
  }

  constructor(config: XiaomiMimoTokenPlanConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.XIAOMI_MIMO_TOKEN_PLAN_KEY ?? "",
      model: config.model ?? "mimo-v2.6-pro",
      baseUrl: config.baseUrl ?? DEFAULT_XIAOMI_MIMO_BASE_URL,
      timeoutMs: config.timeoutMs ?? 300_000,
    });
  }

  /** Full chat-completions endpoint derived from the configured API root. */
  private endpoint(): string {
    return `${this._baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }

  async complete(request: NormalizedRequest, options?: ModelCallOptions): Promise<NormalizedResponse> {
    return complete("xiaomi-mimo-token-plan", this._model, request, {
      apiKey: this._apiKey,
      signal: mergeSignals(AbortSignal.timeout(this._timeoutMs), options?.signal),
      baseUrl: this.endpoint(),
    });
  }

  async *stream(request: NormalizedRequest, options?: ModelCallOptions): AsyncGenerator<StreamChunk> {
    yield* stream("xiaomi-mimo-token-plan", this._model, request, {
      apiKey: this._apiKey,
      signal: mergeSignals(AbortSignal.timeout(this._timeoutMs), options?.signal),
      baseUrl: this.endpoint(),
    });
  }
}
