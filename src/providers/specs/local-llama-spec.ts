import type { ProviderSpec } from "../spec-types.js";
import type { NormalizedRequest, NormalizedResponse, ToolCall, TokenUsage } from "../types.js";
import { buildToolCallSchema } from "./_tool-schema.js";

/**
 * Provider spec for llama-server (local LLM inference).
 *
 * Uses llama-server's OpenAI-compat endpoint at /v1/chat/completions.
 * For tool calling, leverages the `response_format.json_schema` field
 * to force the model to output valid JSON tool calls via grammar-constrained
 * generation.
 *
 * The output is parsed back to ALiX's ToolCall[] format.
 *
 * Default base URL assumes llama-server running locally on port 8080.
 * Override at provider creation time for custom URLs (e.g., Tailscale IP).
 */
export const localLlamaSpec: ProviderSpec = {
  baseUrl: "http://localhost:8080/v1/chat/completions",
  authHeader: () => ({}),

  toRequestBody: (req) => {
    const body: any = {
      model: req.model,
      messages: [
        ...(req.systemPrompt ? [{ role: "system", content: req.systemPrompt }] : []),
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    };

    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxOutputTokens !== undefined) body.max_tokens = req.maxOutputTokens;
    if (req.stream) body.stream = true;

    // If tools are provided, force structured tool-call output via JSON schema
    if (req.tools && req.tools.length > 0) {
      const toolSchema = buildToolCallSchema(req.tools);
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: "tool_call",
          schema: toolSchema,
        },
      };
    }

    return body;
  },

  fromResponse: (res) => {
    const r = res as any;
    const choice = r.choices?.[0];
    const content = choice?.message?.content ?? "";

    // Try to parse as a tool call
    const toolCalls: ToolCall[] = [];
    let text = content;

    if (content.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed.name === "string" && parsed.arguments && typeof parsed.arguments === "object") {
          toolCalls.push({
            id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: parsed.name,
            args: parsed.arguments,
          });
          // Tool call succeeded; suppress text output
          text = "";
        }
      } catch {
        // Not valid JSON — treat as plain text
      }
    }

    return {
      text,
      toolCalls,
      usage: r.usage ? {
        inputTokens: r.usage.prompt_tokens ?? 0,
        outputTokens: r.usage.completion_tokens ?? 0,
      } : undefined,
      finishReason: choice?.finish_reason,
    };
  },

  fromStreamChunk: (line) => {
    // Streaming not supported in v1
    if (!line.startsWith("data: ")) return null;
    const data = line.slice(6).trim();
    if (data === "[DONE]") return { type: "done" };
    try {
      const obj = JSON.parse(data);
      const delta = obj.choices?.[0]?.delta;
      if (delta?.content) return { type: "text_delta", text: delta.content };
    } catch {}
    return null;
  },

  toErrorMessage: (status, body) => {
    const b = body as any;
    return b?.error?.message ?? `llama-server error ${status}`;
  },
};