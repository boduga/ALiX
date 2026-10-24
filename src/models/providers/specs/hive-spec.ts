import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";

/**
 * Hive (thehive.ai) inference API root.
 *
 * OpenAI-compatible chat-completions protocol. The root already carries the
 * API version segment (`/api/v3`), so the chat endpoint is
 * `${root}/chat/completions` — note this differs from the `/v1` convention used
 * by other OpenAI-compatible vendors. Override per install via
 * `ModelConfig.hiveBaseUrl`.
 */
export const DEFAULT_HIVE_BASE_URL = "https://api-cdn.thehive.ai/api/v3";

/**
 * Default model. Verified against `GET /api/v3/models` (2026-10-22): the
 * catalog currently exposes `deepseek-ai/deepseek-v4.1-flash-1017` and
 * `zai-org/glm-5.3-flash`. The served model id is pinned with the `-1017`
 * date suffix; the shorter `deepseek-ai/deepseek-v4.1-flash` alias accepts
 * requests but answers with the dated id, so the dated id is used here to keep
 * the resolved model name matching what the provider reports.
 */
export const DEFAULT_HIVE_MODEL = "deepseek-ai/deepseek-v4.1-flash-1017";

/** Output ceiling. Matches the `output` limit published for the model entry. */
export const HIVE_OUTPUT_TOKEN_LIMIT = 32_768;

/** Context window for models the vendor catalog does not report a limit for. */
export const HIVE_DEFAULT_INPUT_LIMIT = 1_048_576;

/**
 * Per-model context windows. The Hive model listing does not publish context
 * sizes, so these come from the model card for the DeepSeek V4.1 Flash entry
 * (1M). Unknown models fall back to {@link HIVE_DEFAULT_INPUT_LIMIT}.
 */
export const HIVE_MODEL_INPUT_LIMITS: Readonly<Record<string, number>> = {
  "deepseek-ai/deepseek-v4.1-flash-1017": 1_048_576,
  "deepseek-ai/deepseek-v4.1-flash": 1_048_576,
  "zai-org/glm-5.3-flash": 1_048_576,
};

/** Resolve a model's input context limit from the table above. */
export function hiveInputLimitFor(model: string): number {
  return HIVE_MODEL_INPUT_LIMITS[model] ?? HIVE_DEFAULT_INPUT_LIMIT;
}

/**
 * Convert ALiX `ContentPart[]` into OpenAI content parts.
 *
 * Hive follows the OpenAI vision shape (`image_url` object). Unlike Intern it
 * does not require `detail`, so it is omitted rather than guessed.
 */
function toOpenAIContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((part: any) => {
    if (part?.type === "text") return { type: "text", text: part.text };
    if (part?.type === "image") return { type: "image_url", image_url: { url: part.source } };
    return part;
  });
}

export const hiveSpec: ProviderSpec = {
  ...openaiBaseSpec,
  baseUrl: `${DEFAULT_HIVE_BASE_URL}/chat/completions`,

  /**
   * Two additions over the OpenAI base:
   * 1. Multimodal messages: convert `ContentPart[]` into OpenAI content parts.
   * 2. Structured output: pass the caller's `structuredOutputSchema` through as
   *    an OpenAI `response_format: json_schema` (mirrors intern/local-llama).
   *
   * Reasoning models: Hive returns a private `reasoning_content` field on the
   * assistant message and `delta.reasoning_content` while streaming. The
   * inherited OpenAI base already surfaces both (`NormalizedResponse.reasoning`
   * and `reasoning_delta` chunks), so no request-side change is needed — but it
   * is the reason `hive` defaults to a large total timeout below.
   */
  toRequestBody: (req) => {
    const body = openaiBaseSpec.toRequestBody(req) as Record<string, any>;
    body.messages = (body.messages as any[]).map((m) =>
      Array.isArray(m?.content) ? { ...m, content: toOpenAIContent(m.content) } : m,
    );
    if (req.structuredOutputSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: req.structuredOutputSchema.name,
          strict: true,
          schema: {
            type: "object",
            properties: req.structuredOutputSchema.properties,
            required: req.structuredOutputSchema.required,
          },
        },
      };
    }
    return body;
  },
};
