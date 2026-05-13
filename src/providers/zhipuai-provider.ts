import { randomUUID } from "node:crypto";
import type { ModelAdapter, ModelCapabilities, NormalizedRequest, NormalizedResponse, ToolCall } from "./types.js";

export type ZhipuAIConfig = {
  apiKey?: string;
  model?: string;
};

export class ZhipuAIProvider implements ModelAdapter {
  id = "zhipuai";
  editFormatPreference = "search_replace" as const;
  longContextStrategy = "trimmed_context" as const;

  private _apiKey: string;
  private _model: string;

  constructor(config: ZhipuAIConfig = {}) {
    this._apiKey = config.apiKey ?? process.env.ZHIPUAI_API_KEY ?? "";
    this._model = config.model ?? "glm-4-flash";
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

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));
    }

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens;

    const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

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

    const choice = data.choices.at(-1);
    let text = "";
    const toolCalls: ToolCall[] = [];

    if (typeof choice?.message?.content === "string") text = choice.message.content;
    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          id: tc.id ?? randomUUID(),
          name: tc.function.name,
          args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
        });
      }
    }

    return { text: text.trim(), toolCalls };
  }
}
