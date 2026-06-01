import type { ProviderSpec } from "../spec-types.js";

export const anthropicSpec: ProviderSpec = {
  baseUrl: "https://api.anthropic.com/v1/messages",

  authHeader: (apiKey) => ({
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  }),

  toRequestBody: (req) => {
    const body: any = {
      model: req.model,
      system: req.systemPrompt,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: req.maxOutputTokens ?? 4096,
    };
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.stream) body.stream = true;
    return body;
  },

  fromResponse: (res) => {
    const r = res as any;
    let text = "";
    const toolCalls: any[] = [];
    for (const block of r.content ?? []) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, args: block.input });
      }
    }
    return {
      text,
      toolCalls,
      usage: r.usage ? { inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens } : undefined,
      finishReason: r.stop_reason,
    };
  },

  fromStreamChunk: (line) => {
    if (!line.startsWith("data: ")) return null;
    try {
      const obj = JSON.parse(line.slice(6));
      if (obj.type === "content_block_delta" && obj.delta?.type === "text_delta") {
        return { type: "text_delta", text: obj.delta.text };
      }
      if (obj.type === "content_block_start" && obj.content_block?.type === "tool_use") {
        return { type: "tool_call", toolCall: { id: obj.content_block.id, name: obj.content_block.name, args: obj.content_block.input } };
      }
      if (obj.type === "message_stop") return { type: "done" };
      if (obj.type === "message_delta" && obj.usage) {
        return { type: "usage", usage: { inputTokens: obj.usage.input_tokens, outputTokens: obj.usage.output_tokens } };
      }
    } catch {}
    return null;
  },

  toErrorMessage: (status, body) => {
    const b = body as any;
    return b?.error?.message ?? `Anthropic API error ${status}`;
  },
};
