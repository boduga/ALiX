import type { ProviderSpec } from "../spec-types.js";
import type { NormalizedRequest, NormalizedResponse, ToolCall, TokenUsage } from "../types.js";

/**
 * Provider spec for llama-server (local LLM inference).
 *
 * Uses llama-server's OpenAI-compat endpoint at /v1/chat/completions.
 * Requires llama-server started with --jinja flag for native tool calling.
 *
 * Tools are passed as native OpenAI tools: [...] format. The model
 * (with --jinja enabled) outputs proper tool_calls in the response.
 * Our fromResponse parses native tool_calls from the OpenAI response.
 *
 * For models without native tool support, ALiX's schema workaround
 * is available as a separate code path (see local-llama-schema.ts).
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

    // Use native OpenAI tool format (requires llama-server --jinja)
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
    }

    return body;
  },

  fromResponse: (res) => {
    const r = res as any;
    const choice = r.choices?.[0];
    const message = choice?.message ?? {};
    const content = message?.content ?? "";

    const toolCalls: ToolCall[] = [];
    let text = content;

    // Parse native tool_calls from OpenAI response (--jinja mode)
    if (message.tool_calls && Array.isArray(message.tool_calls)) {
      for (const tc of message.tool_calls) {
        // Support both object and function wrapping shapes
        const fn = tc.function || tc;
        toolCalls.push({
          id: tc.id ?? `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: fn.name,
          args: typeof fn.arguments === "string" ? JSON.parse(fn.arguments || "{}") : fn.arguments,
        });
      }
      // Tool calls were made; suppress text output
      text = "";
    }

    // Legacy fallback: parse JSON schema output (for models without --jinja)
    if (toolCalls.length === 0 && content.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(content);
        if (parsed?.type === "text" && typeof parsed.content === "string") {
          text = parsed.content;
        } else if (parsed?.type === "tool" && typeof parsed.name === "string") {
          toolCalls.push({
            id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: parsed.name,
            args: parsed.arguments ?? {},
          });
          text = "";
        } else if (typeof parsed.name === "string") {
          // Old format without type field
          toolCalls.push({
            id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: parsed.name,
            args: parsed.arguments ?? {},
          });
          text = "";
        }
      } catch {
        // Not JSON — keep as text
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