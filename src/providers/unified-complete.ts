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
]);

const PROVIDER_KEY_ENV: Record<string, string> = {
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
  const res = await fetchWithRetry(spec.baseUrl, {
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
  const res = await _fetch(spec.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...spec.authHeader(apiKey) },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    yield { type: "error", error: spec.toErrorMessage(res.status, errBody) };
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
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
}