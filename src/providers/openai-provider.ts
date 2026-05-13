import type {
  ModelAdapter,
  NormalizedRequest,
  NormalizedResponse,
  ToolCall,
  ToolDef,
  TokenUsage,
  ContentPart,
} from "./types.js";

export type OpenAIConfig = {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
};

const ALIX_TOOLS: ToolDef[] = [
  {
    name: "alix_file_read",
    description: "Read the contents of a file from the workspace.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Root directory (defaults to workspace)" },
        path: { type: "string", description: "Relative path to the file" }
      },
      required: ["path"]
    }
  },
  {
    name: "alix_dir_search",
    description: "Search for a pattern across files in the workspace.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Root directory (defaults to workspace)" },
        pattern: { type: "string", description: "Text pattern to search for" },
        extensions: { type: "array", items: { type: "string" } }
      },
      required: ["pattern"]
    }
  },
  {
    name: "alix_shell_run",
    description: "Run a shell command in the workspace.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute" },
        cwd: { type: "string", description: "Working directory" },
        timeoutMs: { type: "number", description: "Timeout in ms" }
      },
      required: ["command"]
    }
  },
  {
    name: "alix_patch_apply",
    description: "Apply a code patch using search/replace.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Root directory" },
        format: { type: "string", description: "search_replace or structured_patch" },
        patchText: { type: "string", description: "The patch content" }
      },
      required: ["format", "patchText"]
    }
  }
];

export class OpenAIProvider implements ModelAdapter {
  id = "openai";
  editFormatPreference = "search_replace" as const;
  longContextStrategy = "trimmed_context" as const;

  private _apiKey: string;
  private _model: string;
  private _maxTokens: number;

  constructor(config: OpenAIConfig = {}) {
    this._apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this._model = config.model ?? "gpt-4o";
    this._maxTokens = config.maxTokens ?? 8192;
  }

  get capabilities() {
    return {
      provider: "openai" as const,
      model: this._model,
      inputTokenLimit: 128_000,
      outputTokenLimit: this._maxTokens,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsVision: true
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) throw new Error("OPENAI_API_KEY is not set");

    const tools = request.tools ?? ALIX_TOOLS;
    const messages: Array<{ role: string; content: string; tool_call_id?: string }> = [
      { role: "system", content: request.systemPrompt },
      ...request.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : (m.content as ContentPart[]).map(p => p.text).join("")
      }))
    ];

    if (request.toolResults) {
      for (const tr of request.toolResults) {
        messages.push({
          role: "tool",
          tool_call_id: tr.toolUseId,
          content: tr.content
        });
      }
    }

    const body: Record<string, unknown> = {
      model: this._model,
      messages,
      max_tokens: this._maxTokens,
      tools: tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: t.input_schema.properties,
            required: t.input_schema.required
          }
        }
      }))
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this._apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000)
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          role: string;
          content: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
        finish_reason: string;
      }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    const choice = data.choices[0];
    const toolCalls: ToolCall[] = [];
    let text = choice.message.content ?? "";

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments)
        });
      }
    }

    const usage: TokenUsage = {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens
    };

    return {
      text,
      toolCalls,
      usage,
      finishReason: choice.finish_reason
    };
  }
}