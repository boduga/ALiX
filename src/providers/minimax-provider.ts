import type { ModelCapabilities, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";
import { BaseProvider } from "./base.js";

export type MiniMaxConfig = {
  apiKey?: string;
  model?: string;
  groupId?: string;
};

export class MiniMaxProvider extends BaseProvider {
  id = "minimax";
  editFormatPreference = "search_replace" as const;
  longContextStrategy = "trimmed_context" as const;

  private _groupId: string;

  constructor(config: MiniMaxConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.MINIMAX_API_KEY ?? "",
      model: config.model ?? "MiniMax-Text-01",
      baseUrl: "https://api.minimax.chat",
    });
    this._groupId = config.groupId ?? "";
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "minimax",
      model: this._model,
      inputTokenLimit: 100_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsVision: false,
    };
  }

  private async fetch(body: Record<string, unknown>): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this._apiKey) {
      headers["Authorization"] = `Bearer ${this._apiKey}`;
    }
    return fetch(`${this._baseUrl}/v1/text/chatcompletion_v2`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) throw new Error("MINIMAX_API_KEY is not set");

    const messages: Array<{ role: string; content: string }> = request.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : String(m.content),
    }));

    if (request.systemPrompt) {
      messages.unshift({ role: "system", content: request.systemPrompt });
    }

    const body: Record<string, unknown> = {
      model: this._model,
      messages,
    };

    if (this._groupId) body.group_id = this._groupId;

    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));
    }

    if (request.temperature !== undefined) body.temperature = request.temperature;

    const response = await this.fetch(body);

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`MiniMax API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
    };

    const choice = data.choices?.at(-1)!;
    const toolCalls = this.parseChoiceToolCalls(choice as any);
    let text = "";
    if (typeof choice?.message?.content === "string") text = choice.message.content;

    return { text: text.trim(), toolCalls };
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    if (!this._apiKey) throw new Error("MINIMAX_API_KEY is not set");

    const messages: Array<{ role: string; content: string }> = request.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : String(m.content),
    }));
    if (request.systemPrompt) messages.unshift({ role: "system", content: request.systemPrompt });

    const body: Record<string, unknown> = { model: this._model, messages, stream: true };
    if (this._groupId) body.group_id = this._groupId;
    if (request.tools?.length) body.tools = request.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    if (request.temperature !== undefined) body.temperature = request.temperature;

    const res = await this.fetch(body);
    yield* this.streamSSE(res);
  }
}
