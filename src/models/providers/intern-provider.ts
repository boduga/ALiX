import { BaseProvider, mergeSignals } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import {
  DEFAULT_INTERN_BASE_URL,
  DEFAULT_INTERN_MODEL,
  INTERN_OUTPUT_TOKEN_LIMIT,
  internInputLimitFor,
} from "./specs/intern-spec.js";
import type { ModelCallOptions, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type InternConfig = {
  apiKey?: string;
  model?: string;
  /** Token Plan API root ending in `/v1` (ModelConfig.internBaseUrl). */
  baseUrl?: string;
  /** Total call timeout (ms). Defaults to 300s: reasoning models can run long. */
  timeoutMs?: number;
};

/**
 * Intern InkStone (intern-ai.org.cn) Token Plan adapter — OpenAI-compatible
 * chat-completions wire format via `internSpec`. Supports text + image input,
 * streaming, tools, and structured output. The input context limit is resolved
 * per-model from the vendor table (1M for deepseek-v4-*, glm-5.3, minimax-m3;
 * 256K otherwise).
 */
export class InternProvider extends BaseProvider {
  id = "intern";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "expanded_context" as const;

  get capabilities() {
    return {
      provider: "intern",
      model: this._model,
      inputTokenLimit: internInputLimitFor(this._model),
      outputTokenLimit: INTERN_OUTPUT_TOKEN_LIMIT,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: true,
      parallelToolCalls: this.parallelToolCallsResolved,
    };
  }

  constructor(config: InternConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.INTERN_API_KEY ?? "",
      model: config.model ?? DEFAULT_INTERN_MODEL,
      baseUrl: config.baseUrl ?? DEFAULT_INTERN_BASE_URL,
      timeoutMs: config.timeoutMs ?? 300_000,
    });
  }

  /** Full chat-completions endpoint derived from the configured API root. */
  private endpoint(): string {
    return `${this._baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }

  async complete(request: NormalizedRequest, options?: ModelCallOptions): Promise<NormalizedResponse> {
    return complete("intern", this._model, request, {
      apiKey: this._apiKey,
      signal: mergeSignals(AbortSignal.timeout(this._timeoutMs), options?.signal),
      baseUrl: this.endpoint(),
    });
  }

  async *stream(request: NormalizedRequest, options?: ModelCallOptions): AsyncGenerator<StreamChunk> {
    yield* stream("intern", this._model, request, {
      apiKey: this._apiKey,
      signal: mergeSignals(AbortSignal.timeout(this._timeoutMs), options?.signal),
      baseUrl: this.endpoint(),
    });
  }
}
