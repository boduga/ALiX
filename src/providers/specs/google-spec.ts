import type { ProviderSpec } from "../spec-types.js";

export const googleSpec: ProviderSpec = {
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
  streamUrl: "https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse",

  authHeader: (apiKey) => ({ "x-goog-api-key": apiKey }),

  toRequestBody: (req) => {
    const contents = req.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string" ? m.content : "" }],
    }));
    const body: any = { contents };
    if (req.systemPrompt) {
      body.systemInstruction = { parts: [{ text: req.systemPrompt }] };
    }
    if (req.tools && req.tools.length > 0) {
      body.tools = [{
        functionDeclarations: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        })),
      }];
    }
    if (req.maxOutputTokens !== undefined) {
      body.generationConfig = { maxOutputTokens: req.maxOutputTokens };
    }
    if (req.temperature !== undefined) {
      body.generationConfig = { ...body.generationConfig, temperature: req.temperature };
    }
    return body;
  },

  fromResponse: (res) => {
    const r = res as any;
    const cand = r.candidates?.[0];
    let text = "";
    const toolCalls: any[] = [];
    for (const part of cand?.content?.parts ?? []) {
      if (part.text) text += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: `gemini-${Date.now()}-${toolCalls.length}`,
          name: part.functionCall.name,
          args: part.functionCall.args ?? {},
        });
      }
    }
    return {
      text,
      toolCalls,
      usage: r.usageMetadata ? {
        inputTokens: r.usageMetadata.promptTokenCount,
        outputTokens: r.usageMetadata.candidatesTokenCount,
      } : undefined,
      finishReason: cand?.finishReason,
    };
  },

  fromStreamChunk: (line) => {
    if (!line.startsWith("data: ")) return null;
    try {
      const obj = JSON.parse(line.slice(6));
      const part = obj.candidates?.[0]?.content?.parts?.[0];
      if (part?.text) return { type: "text_delta", text: part.text };
      if (part?.functionCall) {
        return { type: "tool_call", toolCall: { id: `gemini-${Date.now()}`, name: part.functionCall.name, args: part.functionCall.args ?? {} } };
      }
    } catch {}
    return null;
  },

  toErrorMessage: (status, body) => {
    const b = body as any;
    return b?.error?.message ?? `Google API error ${status}`;
  },
};
