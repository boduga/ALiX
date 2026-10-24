import { ApiError, BaseProvider, mergeSignals } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import {
  DEFAULT_HIVE_BASE_URL,
  DEFAULT_HIVE_MODEL,
  HIVE_OUTPUT_TOKEN_LIMIT,
  hiveInputLimitFor,
} from "./specs/hive-spec.js";
import type { ModelCallOptions, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type HiveConfig = {
  apiKey?: string;
  model?: string;
  /** Inference API root ending in `/api/v3` (ModelConfig.hiveBaseUrl). */
  baseUrl?: string;
  /** Total call timeout (ms). Defaults to 300s: DeepSeek reasoning runs long. */
  timeoutMs?: number;
};

/**
 * Hive (thehive.ai) inference adapter — OpenAI-compatible chat-completions wire
 * format via `hiveSpec`. Supports text + image input, streaming, tools and
 * structured output.
 *
 * The API root carries its own version segment (`/api/v3`), verified live
 * against `GET /api/v3/models`; the vendor also serves `zai-org/glm-5.3-flash`
 * through the same wire format.
 */
export class HiveProvider extends BaseProvider {
  id = "hive";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "expanded_context" as const;

  get capabilities() {
    return {
      provider: "hive",
      model: this._model,
      inputTokenLimit: hiveInputLimitFor(this._model),
      outputTokenLimit: HIVE_OUTPUT_TOKEN_LIMIT,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: true,
      parallelToolCalls: this.parallelToolCallsResolved,
    };
  }

  constructor(config: HiveConfig = {}) {
    super({
      apiKey: config.apiKey ?? "",
      model: config.model ?? DEFAULT_HIVE_MODEL,
      baseUrl: config.baseUrl ?? DEFAULT_HIVE_BASE_URL,
      timeoutMs: config.timeoutMs ?? 300_000,
    });
  }

  /** Full chat-completions endpoint derived from the configured API root. */
  private endpoint(): string {
    return `${this._baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }

  /**
   * Hive reports `finish_reason: "stop"` even when the output budget was
   * exhausted — and the budget covers the reasoning trace, so a small
   * `max_tokens` can burn entirely on reasoning and return EMPTY `content`.
   * Verified live (2026-10-22): `max_tokens: 300` returned `content: ""` with
   * `completion_tokens: 300` and `finish_reason: "stop"`.
   *
   * That signature is indistinguishable from a legitimately empty answer, so it
   * must fail closed: ALiX's truncation handling keys on `finishReason ===
   * "length"` (which this provider never sends), so silently accepting an empty
   * answer would drop the continuation re-prompt and present nothing as the
   * result. `outputTokenLimit` and the elevated output cap make this rare; the
   * guard makes it impossible to be silent.
   */
  private assertNotReasoningStarved(
    request: NormalizedRequest,
    text: string,
    reasoning: string | undefined,
    usage: { outputTokens?: number } | undefined,
  ): void {
    if (text.trim().length > 0) return;
    if (!reasoning || reasoning.trim().length === 0) return;
    const limit = request.maxOutputTokens;
    const spent = usage?.outputTokens;
    const exhausted = typeof limit === "number" && typeof spent === "number" && spent >= limit;
    if (!exhausted) return;
    throw new ApiError(
      400,
      `Hive returned an empty answer after exhausting the ${limit}-token output budget on reasoning; ` +
        `finish_reason was "stop", so this is not a detectable truncation. Raise the output cap or retry.`,
    );
  }

  async complete(request: NormalizedRequest, options?: ModelCallOptions): Promise<NormalizedResponse> {
    const response = await complete("hive", this._model, request, {
      apiKey: this._apiKey,
      signal: mergeSignals(AbortSignal.timeout(this._timeoutMs), options?.signal),

      ...(options?.onAttempt ? { onAttempt: options.onAttempt } : {}),
      baseUrl: this.endpoint(),
    });
    this.assertNotReasoningStarved(request, response.text, response.reasoning, response.usage);
    return response;
  }

  async *stream(request: NormalizedRequest, options?: ModelCallOptions): AsyncGenerator<StreamChunk> {
    let text = "";
    let reasoning = "";
    let usage: { outputTokens?: number } | undefined;
    for await (const chunk of stream("hive", this._model, request, {
      apiKey: this._apiKey,
      signal: mergeSignals(AbortSignal.timeout(this._timeoutMs), options?.signal),

      ...(options?.onAttempt ? { onAttempt: options.onAttempt } : {}),
      baseUrl: this.endpoint(),
    })) {
      if (chunk.type === "text_delta") text += chunk.text;
      else if (chunk.type === "reasoning_delta") reasoning += chunk.text;
      else if (chunk.type === "usage") usage = chunk.usage;
      yield chunk;
    }
    this.assertNotReasoningStarved(request, text, reasoning, usage);
  }
}
