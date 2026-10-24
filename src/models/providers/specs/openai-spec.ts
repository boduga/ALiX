import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";

/**
 * OpenAI's newer reasoning models (the `o`-series: o1, o3, o4-mini, …) reject
 * `max_tokens` and require `max_completion_tokens` instead:
 *
 *   API error (400): Unsupported parameter: 'max_tokens' is not supported with
 *   this model. Use 'max_completion_tokens' instead.
 *
 * Non-reasoning chat models (gpt-4, gpt-4o, …) accept `max_tokens` and are left
 * on the base behaviour. The rename is therefore MODEL-AWARE rather than applied
 * to every OpenAI model, unlike the Xiaomi MiMo spec which renames
 * unconditionally because that provider documents only the newer field.
 *
 * Detection is by model id prefix: the o-series ids all start with `o` followed
 * by a digit (`o1`, `o1-mini`, `o3`, `o4-mini`, dated variants like
 * `o4-mini-2025-04-16`). A bare `o` is not enough — that would also catch
 * non-reasoning ids such as `openchat`.
 */
function isOpenAIReasoningModel(model: string): boolean {
  return /^o\d/i.test(model);
}

export const openaiSpec: ProviderSpec = {
  ...openaiBaseSpec,
  baseUrl: "https://api.openai.com/v1/chat/completions",

  /**
   * Reasoning models take `max_completion_tokens` (reasoning + answer share one
   * budget). Rename only for those models and leave every other field untouched.
   */
  toRequestBody: (req) => {
    const body = openaiBaseSpec.toRequestBody(req) as Record<string, unknown>;
    if (isOpenAIReasoningModel(req.model) && body.max_tokens !== undefined) {
      body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
    }
    return body;
  },
};
