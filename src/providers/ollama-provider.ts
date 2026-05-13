import { BaseProvider } from "./base.js";
import type { ModelCapabilities, NormalizedRequest, NormalizedResponse } from "./types.js";

export type OllamaConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};

export class OllamaProvider extends BaseProvider {
  id = "ollama";
  editFormatPreference = "search_replace" as const;
  longContextStrategy = "trimmed_context" as const;

  constructor(config: OllamaConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.OLLAMA_API_KEY ?? "",
      model: config.model ?? "llama3",
      baseUrl: config.baseUrl ?? "http://localhost:11434",
    });
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "ollama",
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: 8_192,
      supportsTools: false,
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsVision: false,
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    const body: Record<string, unknown> = {
      model: this._model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : m.content,
      })),
      stream: false,
    };

    if (request.systemPrompt) {
      body.messages = [
        { role: "system", content: request.systemPrompt },
        ...(body.messages as object[]),
      ];
    }

    if (request.temperature !== undefined) body.temperature = request.temperature;

    const response = await this.post(body);
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: string;
    };

    if (data.error) throw new Error(`Ollama: ${data.error}`);

    const text = data.choices?.[0]?.message?.content ?? "";
    const toolCalls: NormalizedResponse["toolCalls"] = [];

    return { text: text.trim(), toolCalls };
  }
}