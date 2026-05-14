import { BaseProvider, ApiError } from "./base.js";
import type { ModelCapabilities, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

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
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
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

    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));
    }

    if (request.temperature !== undefined) body.temperature = request.temperature;

    if (request.structuredOutputSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: request.structuredOutputSchema.name, schema: request.structuredOutputSchema },
      };
    }

    const response = await this.post(body);
    if (!response.ok) {
      const err = await response.text();
      throw new ApiError(response.status, err);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: string;
    };

    if (data.error) throw new Error(`Ollama: ${data.error}`);

    const choice = (data as { choices?: Array<{ message?: { content?: string | null } }> }).choices?.at(-1);
    const toolCalls = choice ? this.parseChoiceToolCalls(choice as any) : [];
    const text = typeof choice?.message?.content === "string" ? choice.message.content : "";

    return { text: text.trim(), toolCalls };
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    const body: Record<string, unknown> = {
      model: this._model,
      messages: request.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content })),
      stream: true,
    };
    if (request.systemPrompt) body.messages = [{ role: "system", content: request.systemPrompt }, ...(body.messages as object[])];
    if (request.tools?.length) body.tools = request.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    if (request.temperature !== undefined) body.temperature = request.temperature;

    const res = await this.post(body);
    yield* this.streamSSE(res);
  }
}