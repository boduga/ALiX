import { BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type ZhipuAIConfig = {
  apiKey?: string;
  model?: string;
};

export class ZhipuAIProvider extends BaseProvider {
  id = "zhipuai";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  get capabilities() {
    return {
      provider: "zhipuai",
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsVision: false,
    };
  }

  constructor(config: ZhipuAIConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.ZHIPUAI_API_KEY ?? "",
      model: config.model ?? "glm-4",
      baseUrl: "https://open.bigmodel.cn",
      timeoutMs: 120_000,
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    return complete("zhipuai", this._model, request, { apiKey: this._apiKey });
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    yield* stream("zhipuai", this._model, request, { apiKey: this._apiKey });
  }
}