import { ApiError } from "./base.js";
import { openaiSpec } from "./specs/openai-spec.js";
import { anthropicSpec } from "./specs/anthropic-spec.js";
import { googleSpec } from "./specs/google-spec.js";
import { ollamaSpec } from "./specs/ollama-spec.js";
import { mockSpec } from "./specs/mock-spec.js";
import { groqSpec } from "./specs/groq-spec.js";
import { deepseekSpec } from "./specs/deepseek-spec.js";
import { perplexitySpec } from "./specs/perplexity-spec.js";
import { minimaxSpec } from "./specs/minimax-spec.js";
import { zhipuaiSpec } from "./specs/zhipuai-spec.js";
import { grokaiSpec } from "./specs/grokai-spec.js";
import { openrouterSpec } from "./specs/openrouter-spec.js";
import { localLlamaSpec } from "./specs/local-llama-spec.js";
import type { ProviderSpec } from "./spec-types.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

const SPECS = new Map<string, ProviderSpec>([
  ["openai", openaiSpec],
  ["anthropic", anthropicSpec],
  ["google", googleSpec],
  ["ollama", ollamaSpec],
  ["mock", mockSpec],
  ["groq", groqSpec],
  ["deepseek", deepseekSpec],
  ["perplexity", perplexitySpec],
  ["minimax", minimaxSpec],
  ["zhipuai", zhipuaiSpec],
  ["grokai", grokaiSpec],
  ["openrouter", openrouterSpec],
  ["local-llama", localLlamaSpec],
]);

export const PROVIDER_KEY_ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  ollama: "",
  groq: "GROQ_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  minimax: "MINIMAX_API_KEY",
  zhipuai: "ZHIPUAI_API_KEY",
  grokai: "GROKAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mock: "",
  local_llama: "",
};

let _fetch: typeof fetch = globalThis.fetch;
export function _setFetchForTesting(f: typeof fetch) { _fetch = f; }

function resolveApiKey(provider: string, override?: string): string {
  if (override) return override;
  const envVar = PROVIDER_KEY_ENV[provider];
  if (!envVar) return "";
  return process.env[envVar] ?? "";
}

async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 3): Promise<Response> {
  let lastErr: Response | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await _fetch(url, init);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        lastErr = res;
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = new Response(JSON.stringify({ error: { message: String(e) } }), { status: 503 });
    }
  }
  return lastErr!;
}

export async function complete(
  provider: string,
  model: string,
  request: NormalizedRequest,
  options: { apiKey?: string } = {}
): Promise<NormalizedResponse> {
  const spec = SPECS.get(provider);
  if (!spec) throw new Error(`Unknown provider: ${provider}`);

  const apiKey = resolveApiKey(provider, options.apiKey);
  const body = spec.toRequestBody({ ...request, model });
  const hasTools = !!(request.tools && request.tools.length > 0);
  const base = hasTools && spec.toolCallUrl ? spec.toolCallUrl : spec.baseUrl;
  const url = base.replace("{model}", encodeURIComponent(model));
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...spec.authHeader(apiKey) },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(res.status, spec.toErrorMessage(res.status, errBody));
  }
  const json = await res.json();
  return spec.fromResponse(json);
}

export async function* stream(
  provider: string,
  model: string,
  request: NormalizedRequest,
  options: { apiKey?: string } = {}
): AsyncGenerator<StreamChunk> {
  const spec = SPECS.get(provider);
  if (!spec) throw new Error(`Unknown provider: ${provider}`);

  const apiKey = resolveApiKey(provider, options.apiKey);
  const body = spec.toRequestBody({ ...request, model, stream: true });
  const hasTools = !!(request.tools && request.tools.length > 0);
  const streamBase = spec.streamUrl ?? (hasTools && spec.toolCallUrl ? spec.toolCallUrl : spec.baseUrl);
  const url = streamBase.replace("{model}", encodeURIComponent(model));

  // Retry the initial HTTP request on transient failure.
  // Once the stream is established and chunks are yielded, we cannot retry
  // without re-yielding already-sent chunks, so mid-stream errors are terminal.
  const maxRetries = 2;
  let res: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      res = await _fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...spec.authHeader(apiKey) },
        body: JSON.stringify(body),
      });
      if (res.ok) break;
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const delay = Math.floor(Math.random() * 1000 * Math.pow(2, attempt));
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      const errBody = await res.json().catch(() => ({}));
      yield { type: "error", error: spec.toErrorMessage(res.status, errBody) };
      return;
    } catch (e: any) {
      if (attempt < maxRetries) {
        const delay = Math.floor(Math.random() * 1000 * Math.pow(2, attempt));
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      yield { type: "error", error: `Stream request failed: ${e.message}` };
      return;
    }
  }

  // Stream established — no retry from here onward
  const reader = res!.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const chunk = spec.fromStreamChunk(line.trim());
        if (chunk) yield chunk;
      }
    }
  } catch (e: any) {
    yield { type: "error", error: `Stream read failed: ${e.message}` };
  }
}