// src/providers/specs/_openai-base.ts
import type { ProviderSpec } from "../spec-types.js";
import type { ModelCapabilities } from "../types.js";
import { shouldRequestParallelTools } from "../parallel-tool-calls.js";
import { extractSummary, parseToolArgs } from "../base.js";

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
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: "object",
            properties: {
              ...(t.input_schema?.properties ?? {}),
              summary: {
                type: "string",
                description: "2-5 word explanation of why this tool is being called. Helps the operator follow progress at a glance. Example: 'Locating config file' or 'Running typecheck'",
              },
            },
            ...(t.input_schema && 'required' in t.input_schema ? { required: t.input_schema.required } : {}),
          },
        },
      }));
      // T2 — single helper gate for parallel_tool_calls (request layer).
      const anyReq = req as unknown as {
        capabilities?: Pick<ModelCapabilities, "parallelToolCalls">;
        parallelToolCalls?: boolean;
        provider?: string;
      };
      if (
        shouldRequestParallelTools({
          provider: anyReq.provider,
          model: (req as any).model,
          tools: body.tools,
          capabilities: anyReq.capabilities as any,
          parallelToolCalls: anyReq.parallelToolCalls,
        })
      ) {
        body.parallel_tool_calls = true;
      }
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
    const rawToolCalls = choice?.message?.tool_calls;
    const toolCalls: any[] = [];
    if (Array.isArray(rawToolCalls)) {
      for (let i = 0; i < rawToolCalls.length; i++) {
        const tc = rawToolCalls[i] as any;
        if (!tc || typeof tc !== "object") continue;
        const fn = tc.function;
        if (!fn || typeof fn !== "object") continue;
        const name = fn.name;
        if (typeof name !== "string" || name.trim().length === 0) continue;
        const args = parseToolArgs(fn.arguments);
        if (args === undefined) continue;
        const summary = extractSummary(args);
        const id = typeof tc.id === "string" && tc.id.length > 0
          ? tc.id
          : `call_${i}_${Date.now().toString(36)}_${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
        toolCalls.push({ id, name: name.trim(), args, summary });
      }
    }
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
        const args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
        const summary = extractSummary(args);
        return {
          type: "tool_call",
          toolCall: { id: tc.id, name: tc.function.name, args, summary },
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