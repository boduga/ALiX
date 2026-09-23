import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";

/**
 * Default Token Plan base URL (OpenAI-compatible protocol). Token Plan
 * subscriptions expose an exclusive base URL per region/account, so this is a
 * default — override per install via ModelConfig.xiaomiMimoBaseUrl. The value
 * is the API root (ends in `/v1`); the chat endpoint is `${root}/chat/completions`.
 */
export const DEFAULT_XIAOMI_MIMO_BASE_URL = "https://token-plan-sgp.xiaomimimo.com/v1";

export const xiaomiMimoTokenPlanSpec: ProviderSpec = {
  ...openaiBaseSpec,
  baseUrl: `${DEFAULT_XIAOMI_MIMO_BASE_URL}/chat/completions`,

  /**
   * MiMo's OpenAI-compatible API takes `max_completion_tokens` (thinking +
   * answer share one budget); `max_tokens` is not the documented field. Rename
   * the base spec's `max_tokens` and leave every other field untouched.
   */
  toRequestBody: (req) => {
    const body = openaiBaseSpec.toRequestBody(req) as Record<string, unknown>;
    if (body.max_tokens !== undefined) {
      body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
    }
    return body;
  },
};
