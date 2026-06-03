import type { ProviderSpec } from "../spec-types.js";
import type { NormalizedRequest, NormalizedResponse, ToolCall } from "../types.js";
import { buildToolCallSchema } from "./_tool-schema.js";

/**
 * Provider spec for llama-server (local LLM inference).
 *
 * Uses grammar-constrained JSON schema to handle tool calling.
 * The model outputs either:
 *   - {"type": "text", "content": "..."} for natural responses
 *   - {"type": "tool", "name": "<real_tool>", "arguments": {...}} for tool calls
 *
 * The name field is constrained to an enum of valid tools,
 * preventing small models from hallucinating fake names.
 *
 * Default base URL: http://localhost:8080/v1/chat/completions
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
    if (req.tools && req.tools.length > 0) {
      // Filter out MCP tools — local models shouldn't call them directly
      const localTools = req.tools.filter((t) => !t.name.startsWith("mcp.") && !t.name.startsWith("mcp_"));
      if (localTools.length > 0) {
        // Add a system hint to discourage unnecessary tool use (common with small models)
        const toolNames = localTools.map(t => t.name).join(", ");
        const toolHint = `\n\nYou have access to these tools: ${toolNames}. For simple chat like greetings, use {"type":"text","content":"..."}. Only call a tool when you need to read files, search code, or take an action. Don't call tools for casual conversation.`;
        if (body.messages[0]?.role === "system") {
          body.messages[0].content += toolHint;
        }
        body.response_format = {
          type: "json_schema",
          json_schema: { name: "agent_response", strict: true, schema: buildToolCallSchema(localTools) },
        };
      }
    }
    return body;
  },

  fromResponse: (res) => {
    const r = res as any;
    const choice = r.choices?.[0];
    const content = choice?.message?.content ?? "";
    const toolCalls: ToolCall[] = [];
    let text = content;
    if (content.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(content);
        if (parsed?.type === "text" && typeof parsed.content === "string") {
          text = parsed.content;
        } else if (parsed?.type === "tool" && typeof parsed.name === "string") {
          toolCalls.push({ id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: parsed.name, args: parsed.arguments ?? {} });
          text = "";
        } else if (typeof parsed.name === "string" && parsed.arguments) {
          toolCalls.push({ id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: parsed.name, args: parsed.arguments });
          text = "";
        }
      } catch {}
    }
    return {
      text, toolCalls,
      usage: r.usage ? { inputTokens: r.usage.prompt_tokens ?? 0, outputTokens: r.usage.completion_tokens ?? 0 } : undefined,
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