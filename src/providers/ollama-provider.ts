import { BaseProvider, mergeSignals } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import type { ModelCallOptions, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type OllamaConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /** Total call timeout (ms). Defaults to 300s for cold-load headroom. */
  timeoutMs?: number;
};

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

/** Resolve the Ollama server root: config > env > default. */
export function resolveOllamaBaseUrl(configBaseUrl?: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = configBaseUrl ?? env.OLLAMA_BASE_URL ?? env.OLLAMA_HOST ?? DEFAULT_OLLAMA_BASE_URL;
  return raw.replace(/\/+$/, "");
}

export class OllamaProvider extends BaseProvider {
  id = "ollama";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  get capabilities() {
    return {
      provider: "ollama",
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: false,
      parallelToolCalls: this.parallelToolCallsResolved,
    };
  }

  constructor(config: OllamaConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.OLLAMA_API_KEY ?? "",
      model: config.model ?? "llama3.2",
      baseUrl: resolveOllamaBaseUrl(config.baseUrl),
      // Dead-line for cold loads: Ollama loads the model into RAM on first
      // call, which can take a while on slower machines. `createProvider`
      // threads the effective configured timeout in; keep generous headroom
      // (300s) when unset, matching local-llama's intent.
      timeoutMs: config.timeoutMs ?? 300_000,
    });
  }

  /** Full chat-completions-style endpoint for the current request shape. */
  private endpoint(hasTools: boolean): string {
    return hasTools ? `${this._baseUrl}/api/chat` : `${this._baseUrl}/api/generate`;
  }

  async complete(request: NormalizedRequest, options?: ModelCallOptions): Promise<NormalizedResponse> {
    // The adapter's own wall-clock timeout is a hard ceiling; an operator
    // cancel signal (ModelCallOptions.signal) aborts the request EARLIER.
    // mergeSignals keeps both: whichever fires first aborts the fetch.
    const hasTools = !!(request.tools && request.tools.length > 0);
    return complete("ollama", this._model, request, {
      apiKey: this._apiKey,
      signal: mergeSignals(AbortSignal.timeout(this._timeoutMs), options?.signal),
      baseUrl: this.endpoint(hasTools),
    });
  }

  async *stream(request: NormalizedRequest, options?: ModelCallOptions): AsyncGenerator<StreamChunk> {
    const hasTools = !!(request.tools && request.tools.length > 0);
    yield* stream("ollama", this._model, request, {
      apiKey: this._apiKey,
      signal: mergeSignals(AbortSignal.timeout(this._timeoutMs), options?.signal),
      baseUrl: this.endpoint(hasTools),
    });
  }
}
