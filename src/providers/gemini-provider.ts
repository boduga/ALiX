import { randomUUID } from "node:crypto";
import type {
  ModelAdapter,
  NormalizedRequest,
  NormalizedResponse,
  ToolCall,
  ToolDef,
  TokenUsage,
  ContentPart,
} from "./types.js";

export type GeminiConfig = {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
};

const ALIX_TOOLS: ToolDef[] = [
  {
    name: "alix_file_read",
    description: "Read a file from the workspace.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Root directory" },
        path: { type: "string", description: "Relative path" }
      },
      required: ["path"]
    }
  },
  {
    name: "alix_dir_search",
    description: "Search for a pattern in files.",
    input_schema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Root directory" },
        pattern: { type: "string", description: "Text pattern to search for" },
        extensions: { type: "array", items: { type: "string" } }
      },
      required: ["pattern"]
    }
  },
  {
    name: "alix_shell_run",
    description: "Run a shell command.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to run" },
        cwd: { type: "string", description: "Working directory" },
        timeoutMs: { type: "number", description: "Timeout in ms" }
      },
      required: ["command"]
    }
  },
  {
    name: "alix_patch_apply",
    description: "Apply a code patch.",
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

export class GeminiProvider implements ModelAdapter {
  id = "gemini";
  editFormatPreference = "search_replace" as const;
  longContextStrategy = "expanded_context" as const; // Gemini's strength: large context

  private _apiKey: string;
  private _model: string;
  private _maxTokens: number;

  constructor(config: GeminiConfig = {}) {
    this._apiKey = config.apiKey ?? process.env.GEMINI_API_KEY ?? "";
    this._model = config.model ?? "gemini-2.0-flash";
    this._maxTokens = config.maxTokens ?? 8192;
  }

  get capabilities() {
    return {
      provider: "gemini" as const,
      model: this._model,
      inputTokenLimit: 1_000_000, // Gemini 2.0 supports 1M token context
      outputTokenLimit: 8192,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsVision: true
    };
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!this._apiKey) throw new Error("GEMINI_API_KEY is not set");

    const tools = request.tools ?? ALIX_TOOLS;

    // Gemini uses role="model" for assistant, "user" for user
    const contents = request.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        {
          text: typeof m.content === "string" ? m.content : (m.content as ContentPart[]).map(p => p.text).join("")
        }
      ]
    }));

    // Append tool results as user messages
    if (request.toolResults) {
      for (const tr of request.toolResults) {
        contents.push({
          role: "user",
          parts: [{ text: `<tool_result id="${tr.toolUseId}">\n${tr.content}\n</tool_result>` }]
        });
      }
    }

    const body = {
      contents,
      system_instruction: { parts: [{ text: request.systemPrompt }] },
      tools: {
        function_declarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: t.input_schema.properties,
            required: t.input_schema.required
          }
        }))
      },
      generationConfig: { maxOutputTokens: this._maxTokens }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this._model}:generateContent?key=${this._apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000)
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      candidates: Array<{
        content: {
          parts: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }>;
        };
        finishReason?: string;
      }>;
      usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
    };

    const candidate = data.candidates?.[0];
    if (!candidate) return { text: "", toolCalls: [] };

    const toolCalls: ToolCall[] = [];
    let text = "";

    for (const part of candidate.content.parts) {
      if (part.text) text += part.text;
      else if (part.functionCall) {
        toolCalls.push({
          id: randomUUID(),
          name: part.functionCall.name,
          args: part.functionCall.args
        });
      }
    }

    const usage: TokenUsage | undefined = data.usageMetadata
      ? { inputTokens: data.usageMetadata.promptTokenCount, outputTokens: data.usageMetadata.candidatesTokenCount }
      : undefined;

    return {
      text: text.trim(),
      toolCalls,
      usage,
      finishReason: candidate.finishReason
    };
  }
}
