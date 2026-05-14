import { get_encoding } from "tiktoken";
import type { EncodingName } from "../config/context-limits.js";

// Cache: encoding name → loaded encoder (WASM parsed once, reused)
const encoderCache: Map<EncodingName, ReturnType<typeof get_encoding>> = new Map();

export async function ensureEncoder(encoding: EncodingName): Promise<void> {
  if (encoding === "char4") return;
  if (encoderCache.has(encoding)) return;
  try {
    const enc = get_encoding(encoding as "cl100k_base" | "o200k_base");
    encoderCache.set(encoding, enc);
  } catch (err) {
    console.warn(`[tokens] Failed to load tiktoken encoder '${encoding}': ${err instanceof Error ? err.message : String(err)} — falling back to char/4`);
  }
}

function countTokens(text: string, encoding: EncodingName): number {
  if (encoding === "char4") return Math.ceil(text.length / 4);
  const enc = encoderCache.get(encoding);
  if (!enc) return Math.ceil(text.length / 4);
  return enc.encode(text).length;
}

export function estimateTokens(text: string | unknown[], encoding: EncodingName): number {
  const str = Array.isArray(text) ? JSON.stringify(text) : text;
  return countTokens(str, encoding);
}

export function estimateMessageTokens(
  msg: { role: string; name?: string; content: string | unknown[] },
  encoding: EncodingName
): number {
  const roleOverhead = 5;
  const nameOverhead = msg.name ? estimateTokens(msg.name, encoding) + 6 : 0;
  const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
  return roleOverhead + nameOverhead + estimateTokens(content, encoding);
}

export function truncateToTokenBudget(
  messages: Array<{ role: string; name?: string; content: string | unknown[] }>,
  maxTokens: number,
  encoding: EncodingName
): { kept: typeof messages; dropped: typeof messages } {
  const result: typeof messages = [];
  let totalTokens = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const cost = estimateMessageTokens(msg, encoding);
    if (totalTokens + cost > maxTokens && result.length > 0) break;
    result.unshift(msg);
    totalTokens += cost;
  }
  return { kept: result, dropped: messages.slice(0, messages.length - result.length) };
}