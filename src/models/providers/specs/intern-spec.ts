import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";

/**
 * Default Intern InkStone Token Plan API root (OpenAI-compatible protocol).
 * Token Plan subscriptions expose a per-account key; the API root ends in
 * `/v1` and the chat endpoint is `${root}/chat/completions`. Override per
 * install via ModelConfig.internBaseUrl.
 */
export const DEFAULT_INTERN_BASE_URL = "https://discovery-api.intern-ai.org.cn/v1";

/** Default model: 1M-context, text + image (vendor model table). */
export const DEFAULT_INTERN_MODEL = "deepseek-v4-flash-vision";

/** Conservative output ceiling — the vendor table does not publish max output. */
export const INTERN_OUTPUT_TOKEN_LIMIT = 32_768;

/** Context window for models the vendor table does not list as 1M. */
export const INTERN_DEFAULT_INPUT_LIMIT = 262_144;

/**
 * Per-model context windows from the vendor "模型列表" table (quick-start/
 * 04-model-limits-and-pricing). All other models use
 * {@link INTERN_DEFAULT_INPUT_LIMIT}.
 */
export const INTERN_MODEL_INPUT_LIMITS: Readonly<Record<string, number>> = {
  "deepseek-v4-flash-0731": 1_048_576,
  "deepseek-v4-flash-vision": 1_048_576,
  "deepseek-v4-pro-0813": 1_048_576,
  "glm-5.3": 1_048_576,
  "minimax-m3": 1_048_576,
};

/** Resolve a model's input context limit from the vendor table. */
export function internInputLimitFor(model: string): number {
  return INTERN_MODEL_INPUT_LIMITS[model] ?? INTERN_DEFAULT_INPUT_LIMIT;
}

/**
 * Convert ALiX `ContentPart[]` into OpenAI content parts. Images carry the
 * `image_url` object; `detail` is required by the Intern API (docs:
 * api-reference/03-chat-completions — "image_url.detail 为必填参数").
 */
function toOpenAIContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((part: any) => {
    if (part?.type === "text") return { type: "text", text: part.text };
    if (part?.type === "image") {
      return { type: "image_url", image_url: { url: part.source, detail: "auto" } };
    }
    return part;
  });
}

export const internSpec: ProviderSpec = {
  ...openaiBaseSpec,
  baseUrl: `${DEFAULT_INTERN_BASE_URL}/chat/completions`,

  /**
   * Two additions over the OpenAI base:
   * 1. Multimodal messages: convert `ContentPart[]` (text/image) into OpenAI
   *    content parts so vision-capable models receive `image_url` with the
   *    required `detail`.
   * 2. Structured output: pass the caller's `structuredOutputSchema` through as
   *    an OpenAI `response_format: json_schema` (mirrors local-llama-spec).
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
