/**
 * ollama-tool-calls.ts — Pure parser for Ollama tool call responses.
 *
 * Handles three response shapes:
 *   1. Native Ollama /api/chat — { message: { content, tool_calls } }
 *   2. OpenAI-compatible          — { choices: [{ message: { content, tool_calls } }] }
 *   3. Strict textual envelope    — JSON with top-level "tool_calls" key (opt-in)
 *
 * Never throws. Deterministic IDs. No crypto dependency.
 */

import type { ToolCall } from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TOOL_CALLS = 16;
const DEFAULT_MAX_ARGUMENT_BYTES = 64_000; // ~16k tokens of arguments
const PROTO_POLLUTION_KEYS = new Set(["__proto__", "prototype", "constructor"]);

// ---------------------------------------------------------------------------
// Stable hash (DJB2 — deterministic, no crypto)
// ---------------------------------------------------------------------------

function stableHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  // Encode as unsigned base-36 (stable, short)
  return (hash >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// Parser options
// ---------------------------------------------------------------------------

export interface ParseToolCallOptions {
  /** Enable strict textual envelope fallback (off by default — prevents
   *  arbitrary JSON text from becoming an executable call). */
  allowTextFallback?: boolean;
  /** Maximum tool calls per response (default 16). */
  maxToolCalls?: number;
  /** Maximum serialized argument bytes per call (default 64KB). */
  maxArgumentBytes?: number;
}

// ---------------------------------------------------------------------------
// Argument normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a tool-call argument value into a Record<string, unknown>.
 * - If already an object (non-null, non-array): strip prototype-pollution keys
 * - If a JSON string: parse and validate
 * - Otherwise: return null (invalid)
 */
function normalizeArgs(
  raw: unknown,
  maxBytes: number,
): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;

  // Already an object
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (PROTO_POLLUTION_KEYS.has(k)) continue;
      cleaned[k] = v;
    }
    return cleaned;
  }

  // JSON string
  if (typeof raw === "string") {
    if (raw.length > maxBytes) return null;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (PROTO_POLLUTION_KEYS.has(k)) continue;
        cleaned[k] = v;
      }
      return cleaned;
    } catch {
      return null; // malformed JSON — not a tool call
    }
  }

  return null; // array, number, boolean, etc.
}

// ---------------------------------------------------------------------------
// Native Ollama /api/chat: { message: { content, tool_calls } }
// ---------------------------------------------------------------------------

function parseNativeToolCalls(
  body: any,
  maxCalls: number,
  maxBytes: number,
): ToolCall[] {
  const message = body?.message;
  if (!message || typeof message !== "object") return [];
  const rawCalls = message.tool_calls;
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) return [];

  const result: ToolCall[] = [];
  for (let i = 0; i < Math.min(rawCalls.length, maxCalls); i++) {
    const raw = rawCalls[i];
    if (!raw || typeof raw !== "object") continue;

    const fn = raw.function ?? raw;
    if (typeof fn !== "object") continue;

    const name = fn.name;
    if (typeof name !== "string" || name.trim().length === 0) continue;

    const trimmedName = name.trim();
    const args = normalizeArgs(fn.arguments, maxBytes);
    if (args === null) continue;

    result.push({
      id: `ollama_call_${i}_${stableHash(trimmedName + JSON.stringify(args))}`,
      name: trimmedName,
      args,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible: { choices: [{ message: { content, tool_calls } }] }
// ---------------------------------------------------------------------------

function parseOpenAICompatibleToolCalls(
  body: any,
  maxCalls: number,
  maxBytes: number,
): ToolCall[] {
  const choices = body?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return [];
  const message = choices[0]?.message;
  if (!message || typeof message !== "object") return [];
  const rawCalls = message.tool_calls;
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) return [];

  const result: ToolCall[] = [];
  for (let i = 0; i < Math.min(rawCalls.length, maxCalls); i++) {
    const raw = rawCalls[i];
    if (!raw || typeof raw !== "object") continue;
    const fn = raw.function;
    if (!fn || typeof fn !== "object") continue;

    const name = fn.name;
    if (typeof name !== "string" || name.trim().length === 0) continue;

    const id = raw.id && typeof raw.id === "string" && raw.id.length > 0
      ? raw.id
      : `ollama_call_${i}_${stableHash(name)}`;

    const args = normalizeArgs(fn.arguments, maxBytes);
    if (args === null) continue;

    result.push({ id, name: name.trim(), args });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Strict textual envelope: JSON with top-level "tool_calls" key
// ---------------------------------------------------------------------------

/**
 * Check if a response body is a strict textual tool-call envelope.
 * The envelope must be an object with exactly a "tool_calls" top-level key
 * whose value is a non-empty array of valid tool call objects.
 *
 * This is opt-in via `allowTextFallback`. When enabled, only this exact
 * structure is accepted — arbitrary JSON in text is never parsed as calls.
 */
function parseTextFallbackToolCalls(
  body: any,
  maxCalls: number,
  maxBytes: number,
): ToolCall[] {
  // Must be a plain object
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];

  const rawCalls = body.tool_calls;
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) return [];

  const result: ToolCall[] = [];
  for (let i = 0; i < Math.min(rawCalls.length, maxCalls); i++) {
    const raw = rawCalls[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;

    const name = raw.name;
    if (typeof name !== "string" || name.trim().length === 0) continue;

    const args = normalizeArgs(raw.arguments, maxBytes);
    if (args === null) continue;

    result.push({
      id: `ollama_call_text_${i}_${stableHash(name + JSON.stringify(args))}`,
      name: name.trim(),
      args,
    });
  }
  // Only return calls if the envelope is valid and non-empty
  return result.length > 0 ? result : [];
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

export function extractOllamaContent(response: unknown): string {
  if (!response || typeof response !== "object") return "";

  const r = response as Record<string, unknown>;

  // Native Ollama /api/chat
  if (r.message && typeof r.message === "object") {
    const msg = r.message as Record<string, unknown>;
    if (typeof msg.content === "string") return msg.content;
  }

  // OpenAI-compatible
  if (Array.isArray(r.choices) && r.choices.length > 0) {
    const choice = r.choices[0] as Record<string, unknown> | undefined;
    if (choice?.message && typeof choice.message === "object") {
      const msg = choice.message as Record<string, unknown>;
      if (typeof msg.content === "string") return msg.content;
    }
  }

  // Ollama /api/generate
  if (typeof r.response === "string") return r.response;

  return "";
}

// ---------------------------------------------------------------------------
// Usage extraction
// ---------------------------------------------------------------------------

export function extractOllamaUsage(response: unknown): { inputTokens: number; outputTokens: number } | undefined {
  if (!response || typeof response !== "object") return undefined;

  const r = response as Record<string, unknown>;

  // Ollama native
  if (typeof r.eval_count === "number") {
    return {
      inputTokens: typeof r.prompt_eval_count === "number" ? r.prompt_eval_count : 0,
      outputTokens: r.eval_count,
    };
  }

  // OpenAI-compatible
  if (r.usage && typeof r.usage === "object") {
    const u = r.usage as Record<string, unknown>;
    const inputTokens = typeof u.prompt_tokens === "number" ? u.prompt_tokens
      : typeof u.input_tokens === "number" ? u.input_tokens
      : 0;
    const outputTokens = typeof u.completion_tokens === "number" ? u.completion_tokens
      : typeof u.output_tokens === "number" ? u.output_tokens
      : 0;
    if (inputTokens > 0 || outputTokens > 0) return { inputTokens, outputTokens };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Finish reason extraction
// ---------------------------------------------------------------------------

export function extractOllamaFinishReason(
  response: unknown,
  toolCalls: ToolCall[],
): string | undefined {
  if (!response || typeof response !== "object") return undefined;

  const r = response as Record<string, unknown>;

  if (toolCalls.length > 0) return "tool_call";

  // Ollama native
  if (r.done === true) return "stop";

  // OpenAI-compatible
  if (typeof r.choices === "object") {
    const choices = r.choices as any[];
    if (choices?.[0]?.finish_reason) return choices[0].finish_reason;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Main parser entry point
// ---------------------------------------------------------------------------

/**
 * Parse tool calls from an Ollama provider response.
 *
 * Detection order:
 *   1. Native Ollama /api/chat (message.tool_calls)
 *   2. OpenAI-compatible (choices[0].message.tool_calls)
 *   3. Strict textual envelope (opt-in, allowTextFallback)
 *
 * Only one format is used per call (native takes priority).
 * Never throws — returns []. Malformed calls are silently skipped.
 */
export function parseOllamaToolCalls(
  response: unknown,
  options?: ParseToolCallOptions,
): ToolCall[] {
  const maxCalls = options?.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const maxBytes = options?.maxArgumentBytes ?? DEFAULT_MAX_ARGUMENT_BYTES;

  if (!response || typeof response !== "object") return [];

  const body = response as Record<string, unknown>;

  // 1. Native Ollama /api/chat
  if (body.message && typeof body.message === "object") {
    const calls = parseNativeToolCalls(body, maxCalls, maxBytes);
    if (calls.length > 0) return calls;
  }

  // 2. OpenAI-compatible
  if (Array.isArray(body.choices)) {
    const calls = parseOpenAICompatibleToolCalls(body, maxCalls, maxBytes);
    if (calls.length > 0) return calls;
  }

  // 3. Strict textual envelope (opt-in only)
  if (options?.allowTextFallback) {
    const calls = parseTextFallbackToolCalls(body, maxCalls, maxBytes);
    if (calls.length > 0) return calls;
  }

  return [];
}
