import type { ProviderSpec } from "../spec-types.js";

export const ollamaSpec: ProviderSpec = {
  baseUrl: "http://localhost:11434/api/generate",

  authHeader: () => ({}),

  toRequestBody: (req) => {
    const lastUserMsg = [...req.messages].reverse().find((m) => m.role === "user");
    const prompt = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";
    const body: any = { model: req.model, prompt, stream: req.stream ?? false };
    if (req.systemPrompt) body.system = req.systemPrompt;
    return body;
  },

  fromResponse: (res) => {
    const r = res as any;
    return {
      text: r.response ?? "",
      toolCalls: [],
      usage: r.eval_count ? { inputTokens: r.prompt_eval_count ?? 0, outputTokens: r.eval_count } : undefined,
      finishReason: r.done ? "stop" : undefined,
    };
  },

  fromStreamChunk: (line) => {
    try {
      const obj = JSON.parse(line);
      if (obj.response) return { type: "text_delta", text: obj.response };
      if (obj.done) return { type: "done" };
    } catch {}
    return null;
  },

  toErrorMessage: (status, body) => {
    const b = body as any;
    return b?.error ?? `Ollama API error ${status}`;
  },
};
