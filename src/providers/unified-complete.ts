import { ApiError, extractSummary } from "./base.js";
import { openaiSpec } from "./specs/openai-spec.js";
import { anthropicSpec } from "./specs/anthropic-spec.js";
import { googleSpec } from "./specs/google-spec.js";
import { ollamaSpec } from "./specs/ollama-spec.js";
import { mockSpec } from "./specs/mock-spec.js";
import { groqSpec } from "./specs/groq-spec.js";
import { deepseekSpec } from "./specs/deepseek-spec.js";
import { perplexitySpec } from "./specs/perplexity-spec.js";
import { minimaxSpec } from "./specs/minimax-spec.js";
import { minimaxTokenPlanSpec } from "./specs/minimax-token-plan-spec.js";
import { zhipuaiSpec } from "./specs/zhipuai-spec.js";
import { grokaiSpec } from "./specs/grokai-spec.js";
import { openrouterSpec } from "./specs/openrouter-spec.js";
import { localLlamaSpec } from "./specs/local-llama-spec.js";
import type { ProviderSpec } from "./spec-types.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk, ToolCall } from "./types.js";

export const SPECS = new Map<string, ProviderSpec>([
  ["openai", openaiSpec],
  ["anthropic", anthropicSpec],
  ["google", googleSpec],
  ["ollama", ollamaSpec],
  ["mock", mockSpec],
  ["groq", groqSpec],
  ["deepseek", deepseekSpec],
  ["perplexity", perplexitySpec],
  ["minimax", minimaxSpec],
  ["minimax-token-plan", minimaxTokenPlanSpec],
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
  "minimax-token-plan": "MINIMAX_TOKEN_PLAN_KEY",
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

type PartialToolCall = {
  id: string;
  name: string;
  argsText: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOpenAiToolDeltaLine(
  line: string,
  partialTools: Map<number, PartialToolCall>,
): { handled: boolean; chunks: StreamChunk[] } {
  if (!line.startsWith("data: ")) return { handled: false, chunks: [] };

  const data = line.slice(6).trim();
  if (data === "[DONE]") return { handled: false, chunks: [] };

  let event: any;
  try {
    event = JSON.parse(data);
  } catch {
    return { handled: false, chunks: [] };
  }

  const toolDeltas = event?.choices?.[0]?.delta?.tool_calls;
  if (!Array.isArray(toolDeltas)) return { handled: false, chunks: [] };

  const chunks: StreamChunk[] = [];
  for (const delta of toolDeltas) {
    const index = typeof delta?.index === "number" ? delta.index : 0;
    const existing = partialTools.get(index);
    const id = typeof delta?.id === "string" ? delta.id : existing?.id;
    const name = typeof delta?.function?.name === "string" ? delta.function.name : existing?.name;

    if (!id && !existing) continue;

    const partial: PartialToolCall = existing ?? { id: id ?? "", name: name ?? "", argsText: "" };
    if (id) partial.id = id;
    if (name) partial.name = name;

    const rawArgs = delta?.function?.arguments;
    if (rawArgs !== undefined) {
      partial.argsText += typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs);
    }

    partialTools.set(index, partial);

    if (!partial.id || !partial.name || partial.argsText.trim() === "") continue;

    try {
      const args = JSON.parse(partial.argsText) as unknown;
      if (!isRecord(args)) continue;
      const summary = extractSummary(args);
      const toolCall: ToolCall = { id: partial.id, name: partial.name, args, summary };
      chunks.push({ type: "tool_call", toolCall });
      partialTools.delete(index);
    } catch {
      // Arguments JSON can be split across many deltas.
    }
  }

  return { handled: true, chunks };
}

/**
 * Accumulate Anthropic-format streamed tool calls (content_block_start →
 * input_json_delta → content_block_stop), keyed by content-block `index`.
 *
 * Anthropic streams tool arguments as `input_json_delta` fragments on
 * `content_block_delta` events; the `content_block_start` event only carries
 * `input: {}` (arguments are explicitly incomplete at that point). Naively
 * reading `input` at block start yields an empty-args tool call. So:
 *
 *   - content_block_start (tool_use) → seed a partial entry, emit nothing
 *   - content_block_delta (input_json_delta) → append partial_json
 *   - content_block_stop → JSON.parse the accumulated fragments and emit the
 *     tool call; preserve `{}` when no fragments arrived; emit a stream error
 *     (never a manufactured `{}`) when the accumulated JSON is malformed.
 *
 * Mirrors `parseOpenAiToolDeltaLine` (same orchestration layer, same
 * per-index accumulator) so the pure `spec.fromStreamChunk` stays stateless.
 */
function parseAnthropicToolDeltaLine(
  line: string,
  partialTools: Map<number, PartialToolCall>,
): { handled: boolean; chunks: StreamChunk[] } {
  if (!line.startsWith("data: ")) return { handled: false, chunks: [] };

  const data = line.slice(6).trim();
  if (data === "[DONE]") return { handled: false, chunks: [] };

  let event: any;
  try {
    event = JSON.parse(data);
  } catch {
    return { handled: false, chunks: [] };
  }

  if (typeof event?.type !== "string") return { handled: false, chunks: [] };
  const index = typeof event.index === "number" ? event.index : 0;

  if (event.type === "content_block_start") {
    const block = event.content_block;
    if (block?.type !== "tool_use") return { handled: false, chunks: [] };
    partialTools.set(index, { id: block.id ?? "", name: block.name ?? "", argsText: "" });
    return { handled: true, chunks: [] };
  }

  if (event.type === "content_block_delta") {
    if (event.delta?.type !== "input_json_delta") return { handled: false, chunks: [] };
    const partial = partialTools.get(index);
    if (!partial) return { handled: false, chunks: [] };
    const raw = event.delta.partial_json;
    partial.argsText += typeof raw === "string" ? raw : JSON.stringify(raw);
    return { handled: true, chunks: [] };
  }

  if (event.type === "content_block_stop") {
    const partial = partialTools.get(index);
    if (!partial) return { handled: false, chunks: [] };
    partialTools.delete(index);

    const raw = partial.argsText.trim();
    if (raw === "") {
      // No fragments streamed — legitimate empty-args tool call. Preserve
      // `{}` rather than inventing an error.
      const summary = extractSummary({});
      return {
        handled: true,
        chunks: [{
          type: "tool_call",
          toolCall: { id: partial.id, name: partial.name, args: {}, ...(summary ? { summary } : {}) },
        }],
      };
    }

    let args: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw) as unknown;
      args = isRecord(parsed) ? parsed : {};
    } catch {
      return {
        handled: true,
        chunks: [{
          type: "error",
          error: `Failed to parse streamed tool arguments for ${partial.name}: ${raw.slice(0, 120)}`,
        }],
      };
    }

    const summary = extractSummary(args);
    return {
      handled: true,
      chunks: [{
        type: "tool_call",
        toolCall: { id: partial.id, name: partial.name, args, ...(summary ? { summary } : {}) },
      }],
    };
  }

  return { handled: false, chunks: [] };
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
  const partialTools = new Map<number, PartialToolCall>();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmedLine = line.trim();
        const toolDelta = parseOpenAiToolDeltaLine(trimmedLine, partialTools);
        if (toolDelta.handled) {
          for (const chunk of toolDelta.chunks) yield chunk;
          continue;
        }

        const anthropicToolDelta = parseAnthropicToolDeltaLine(trimmedLine, partialTools);
        if (anthropicToolDelta.handled) {
          for (const chunk of anthropicToolDelta.chunks) yield chunk;
          continue;
        }

        const chunk = spec.fromStreamChunk(trimmedLine);
        if (chunk) yield chunk;
      }
    }
  } catch (e: any) {
    yield { type: "error", error: `Stream read failed: ${e.message}` };
  }
}
