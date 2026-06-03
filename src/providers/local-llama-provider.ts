import { BaseProvider } from "./base.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";
import { complete, stream } from "./unified-complete.js";
import { ensureLlamaServer, type LlamaServerOptions } from "./local-llama-launcher.js";

/**
 * LocalLlamaProvider — thin wrapper around the local-llama spec.
 *
 * Auto-starts llama-server if it's not already running, using the
 * ALIX_LLAMA_MODEL_PATH env var to find the GGUF model file.
 *
 * Default base URL: http://localhost:8080/v1/chat/completions
 * Override with ALIX_LLAMA_BASE_URL env var.
 *
 * The model file path can be set via:
 *   - config.localModelPath in .alix/config.json
 *   - ALIX_LLAMA_MODEL_PATH env var
 *   - ALIX_LLAMA_SERVER_PATH env var (for non-default binary location)
 */
export type LocalLlamaConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /** Path to the GGUF model (overrides ALIX_LLAMA_MODEL_PATH) */
  localModelPath?: string;
};

export class LocalLlamaProvider extends BaseProvider {
  id = "local-llama";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  get capabilities() {
    return {
      provider: "local-llama",
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: 16_384,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsVision: false,
    };
  }
  private launchedProcess: AbortController | null = null;
  private baseUrl: string;
  private localModelPath?: string;

  constructor(config: LocalLlamaConfig = {}) {
    const baseUrl = config.baseUrl
      ?? process.env.ALIX_LLAMA_BASE_URL
      ?? "http://localhost:8080/v1/chat/completions";
    super({
      apiKey: config.apiKey ?? "",
      model: config.model ?? "local-model",
      baseUrl,
      timeoutMs: 300_000,
    });
    this.baseUrl = baseUrl;
    this.localModelPath = config.localModelPath ?? process.env.ALIX_LLAMA_MODEL_PATH;
  }

  /**
   * Ensure llama-server is running. Idempotent — only starts once per session.
   */
  private async ensureRunning(): Promise<void> {
    if (this.launchedProcess) return; // already attempted this session

    const result = await ensureLlamaServer(this.baseUrl, {
      modelPath: this.localModelPath,
    });

    if (result.process) {
      this.launchedProcess = new AbortController();
      result.process.on("exit", () => {
        this.launchedProcess = null;
      });
      // Detach on process exit
      process.on("beforeExit", () => {
        result.process?.kill();
      });
    }
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    await this.ensureRunning();
    return complete("local-llama", this._model, request, { apiKey: this._apiKey });
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    await this.ensureRunning();
    yield* stream("local-llama", this._model, request, { apiKey: this._apiKey });
  }
}
