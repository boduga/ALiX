import { BaseProvider } from "./base.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";
import { complete, stream } from "./unified-complete.js";

/**
 * LocalLlamaProvider — thin wrapper around the local-llama spec.
 *
 * Wraps llama-server (or any OpenAI-compat local server) with grammar-
 * constrained tool calling via the `response_format.json_schema` field.
 *
 * Default base URL: http://localhost:8080/v1/chat/completions
 * Override with ALIX_LLAMA_BASE_URL env var.
 */
export type LocalLlamaConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};

export class LocalLlamaProvider extends BaseProvider {
  id = "local-llama";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  constructor(config: LocalLlamaConfig = {}) {
    const baseUrl = config.baseUrl
      ?? process.env.ALIX_LLAMA_BASE_URL
      ?? "http://localhost:8080/v1/chat/completions";
    super({
      apiKey: config.apiKey ?? "",
      model: config.model ?? "local-model",
      baseUrl,
      timeoutMs: 300_000,  // Local inference can be slow
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    // baseUrl may have been overridden via env; pass to dispatcher
    // For now, dispatcher uses spec's baseUrl. Future: support per-call baseUrl.
    return complete("local-llama", this._model, request, { apiKey: this._apiKey });
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    yield* stream("local-llama", this._model, request, { apiKey: this._apiKey });
  }
}
