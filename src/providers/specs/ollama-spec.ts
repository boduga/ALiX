/**
 * ollama-spec.ts — Provider specification for Ollama.
 *
 * Two endpoint paths:
 *   /api/generate — for requests WITHOUT tools (prompt-based, existing behavior)
 *   /api/chat     — for requests WITH tools (message-based, native tool_calls)
 *
 * Streaming: both endpoints serve NDJSON. /api/chat streaming emits tool calls
 * as a single chunk with the full tool_calls array on the message object.
 * For P4.1b, streaming tool call support is deferred to P4.1c — streaming
 * requests without tools continue to work via /api/generate.
 */

import type { ProviderSpec } from "../spec-types.js";
import type { ToolDef } from "../types.js";
import type { DeferredToolEntry } from "../../mcp/tool-deferral.js";
import {
  extractOllamaContent,
  extractOllamaFinishReason,
  extractOllamaUsage,
  parseOllamaToolCalls,
} from "./ollama-tool-calls.js";

export const ollamaSpec: ProviderSpec = {
  baseUrl: "http://localhost:11434/api/generate",
  toolCallUrl: "http://localhost:11434/api/chat",

  authHeader: () => ({}),

  toRequestBody: (req) => {
    const body: any = { model: req.model, stream: req.stream ?? false };

    if (req.tools && req.tools.length > 0) {
      // /api/chat format — message-based with tool definitions
      const messages: Array<{ role: string; content: string }> = [];
      if (req.systemPrompt) {
        messages.push({ role: "system", content: req.systemPrompt });
      }
      for (const msg of req.messages) {
        const content = typeof msg.content === "string" ? msg.content : "";
        messages.push({ role: msg.role, content });
      }
      body.messages = messages;

      // Normalize tool definitions to Ollama's /api/chat tool format
      body.tools = req.tools.map((t: ToolDef | DeferredToolEntry) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
    } else {
      // /api/generate format — prompt-based (existing behavior)
      const lastUserMsg = [...req.messages].reverse().find((m) => m.role === "user");
      const prompt = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";
      body.prompt = prompt;
      if (req.systemPrompt) body.system = req.systemPrompt;
    }

    return body;
  },

  fromResponse: (res) => {
    const toolCalls = parseOllamaToolCalls(res, {
      allowTextFallback: false, // off by default — opt-in only
    });

    return {
      text: extractOllamaContent(res),
      toolCalls,
      usage: extractOllamaUsage(res),
      finishReason: extractOllamaFinishReason(res, toolCalls),
    };
  },

  fromStreamChunk: (line) => {
    try {
      const obj = JSON.parse(line);

      // /api/chat streaming format
      if (obj.message && typeof obj.message === "object") {
        if (typeof obj.message.content === "string" && obj.message.content.length > 0) {
          return { type: "text_delta", text: obj.message.content };
        }
        // Tool calls in streaming are deferred to P4.1c —
        // they arrive as a single chunk with the full tool_calls array
      }

      // /api/generate streaming format (existing)
      if (obj.response) return { type: "text_delta", text: obj.response };

      if (obj.done) return { type: "done" };
    } catch {
      // ignore parse errors
    }
    return null;
  },

  toErrorMessage: (status, body) => {
    const b = body as any;
    return b?.error ?? `Ollama API error ${status}`;
  },
};
