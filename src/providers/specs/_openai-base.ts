// src/providers/specs/_openai-base.ts
import type { ProviderSpec } from "../spec-types.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "../types.js";

/**
 * OpenAI chat-completions wire format.
 *
 * This is the BASE for 7 providers that use OpenAI's API shape:
 * - openai, groq, deepseek, perplexity, minimax, zhipuai, grokai, openrouter
 *
 * Inheriting specs override only `baseUrl` (and occasionally auth).
 */
export const openaiBaseSpec: ProviderSpec = {
  baseUrl: "",  // must be overridden

  authHeader: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),

  toRequestBody: (req) => {
    const messages: any[] = [];
    if (req.systemPrompt) {
      messages.push({ role: "system", content: req.systemPrompt });
    }
    for (const m of req.messages) {
      messages.push({ role: m.role, content: m.content });
    }
    const body: any = { model: req.model, messages };
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxOutputTokens !== undefined) body.max_tokens = req.maxOutputTokens;
    if (req.stream) body.stream = true;
    return body;
  },

  fromResponse: (res) => {
    const r = res as any;
    const choice = r.choices?.[0];
    const text = choice?.message?.content ?? "";
    const toolCalls = (choice?.message?.tool_calls ?? []).map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments || "{}"),
    }));
    return {
      text,
      toolCalls,
      usage: r.usage ? {
        inputTokens: r.usage.prompt_tokens,
        outputTokens: r.usage.completion_tokens,
      } : undefined,
      finishReason: choice?.finish_reason,
    };
  },

  fromStreamChunk: (line) => {
    if (!line.startsWith("data: ")) return null;
    const data = line.slice(6).trim();
    if (data === "[DONE]") return { type: "done" };
    try {
      const obj = JSON.parse(data);
      const delta = obj.choices?.[0]?.delta;
      if (delta?.content) return { type: "text_delta", text: delta.content };
      if (delta?.tool_calls) {
        const tc = delta.tool_calls[0];
        return {
          type: "tool_call",
          toolCall: { id: tc.id, name: tc.function.name, args: JSON.parse(tc.function.arguments || "{}") },
        };
      }
      if (obj.usage) {
        return { type: "usage", usage: { inputTokens: obj.usage.prompt_tokens, outputTokens: obj.usage.completion_tokens } };
      }
    } catch {}
    return null;
  },

  toErrorMessage: (status, body) => {
    const b = body as any;
    return b?.error?.message ?? `OpenAI-compat API error ${status}`;
  },
};