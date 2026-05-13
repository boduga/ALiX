import { BaseProvider } from "./base.js";
import type { ModelCapabilities, NormalizedRequest, NormalizedResponse } from "./types.js";

export type GrokAIConfig = {
  apiKey?: string;
  model?: string;
};

export class GrokAIProvider extends BaseProvider {
  id = "grokai";
  editFormatPreference = "search_replace" as const;
  longContextStrategy = "trimmed_context" as const;

  constructor(config: GrokAIConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.GROKAI_API_KEY ?? "",
      model: config.model ?? "grok-2",
      baseUrl: "https://api.grok.ai",
    });
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "grokai",
      model: this._model,
      inputTokenLimit: 131_072,
      outputTokenLimit: 32_768,
      supportsTools: true,
      supportsStreaming: false,
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
    return fetch(`${this._baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) throw new Error("GROKAI_API_KEY is not set");

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

    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));
    }

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens;

    const response = await this.fetch(body);

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`GrokAI API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
    };

    const choice = data.choices.at(-1)!;
    const toolCalls = this.parseChoiceToolCalls(choice as any);
    let text = "";
    if (typeof choice.message?.content === "string") text = choice.message.content;

    return { text: text.trim(), toolCalls };
  }
}