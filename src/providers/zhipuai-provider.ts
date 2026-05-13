import { BaseProvider } from "./base.js";
import type { ModelCapabilities, NormalizedRequest, NormalizedResponse } from "./types.js";

export type ZhipuAIConfig = {
  apiKey?: string;
  model?: string;
};

export class ZhipuAIProvider extends BaseProvider {
  id = "zhipuai";
  editFormatPreference = "search_replace" as const;
  longContextStrategy = "trimmed_context" as const;

  constructor(config: ZhipuAIConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.ZHIPUAI_API_KEY ?? "",
      model: config.model ?? "glm-4-flash",
      baseUrl: "https://open.bigmodel.cn",
    });
  }

  get capabilities(): ModelCapabilities {
    return {
      provider: "zhipuai",
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: 8_192,
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
    return fetch(`${this._baseUrl}/api/paas/v4/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) throw new Error("ZHIPUAI_API_KEY is not set");

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
      throw new Error(`ZhipuAI API error ${response.status}: ${err}`);
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