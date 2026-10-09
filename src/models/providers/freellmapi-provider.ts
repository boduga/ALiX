import { BaseProvider, mergeSignals } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import { DEFAULT_FREELLMAPI_BASE_URL } from "./specs/freellmapi-spec.js";
import type { ModelCallOptions, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type FreeLLMAPIConfig = {
  apiKey?: string;
  model?: string;
  /** Server base URL (ModelConfig.freellmapiBaseUrl). Defaults to the LAN server. */
  baseUrl?: string;
  /** Total call timeout (ms). Defaults to 300s: free-tier routing can queue behind rate limits. */
  timeoutMs?: number;
};

export class FreeLLMAPIProvider extends BaseProvider {
  id = "freellmapi";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  get capabilities() {
    return {
      provider: "freellmapi",
      model: this._model,
      // Generic caps: the router serves many upstreams, so these are
      // conservative defaults, not per-model claims.
      inputTokenLimit: 128_000,
      outputTokenLimit: 16_384,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: false,
      parallelToolCalls: this.parallelToolCallsResolved,
    };
  }

  constructor(config: FreeLLMAPIConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.FREELLMAPI_API_KEY ?? "",
      model: config.model ?? "nvidia/nemotron-3-super-120b-a12b:free",
      baseUrl: config.baseUrl ?? DEFAULT_FREELLMAPI_BASE_URL,
      timeoutMs: config.timeoutMs ?? 300_000,
    });
  }

  /** Full chat-completions endpoint derived from the configured server address. */
  private endpoint(): string {
    return `${this._baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  }

  async complete(request: NormalizedRequest, options?: ModelCallOptions): Promise<NormalizedResponse> {
    return complete("freellmapi", this._model, request, {
      apiKey: this._apiKey,
      signal: mergeSignals(AbortSignal.timeout(this._timeoutMs), options?.signal),
      baseUrl: this.endpoint(),
    });
  }

  async *stream(request: NormalizedRequest, options?: ModelCallOptions): AsyncGenerator<StreamChunk> {
    yield* stream("freellmapi", this._model, request, {
      apiKey: this._apiKey,
      signal: mergeSignals(AbortSignal.timeout(this._timeoutMs), options?.signal),
      baseUrl: this.endpoint(),
    });
  }
}
