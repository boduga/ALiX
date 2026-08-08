import { get_encoding } from "tiktoken";
import { SAFETY_FACTOR } from "../config/context-limits.js";
import type { TokenizerName } from "../config/context-limits.js";

/** Estimation metadata recorded for future C2 analysis (E1). */
export interface EstimationMetadata {
  tokenizer: TokenizerName;
  /** Unpadded base tokenizer estimate. */
  rawEstimate: number;
  /** 1.20 — the padding applied for admission (E1). */
  safetyFactor: number;
  /** ceil(rawEstimate × safetyFactor) — the budget-admission number. */
  budgetEstimate: number;
}

// Cache: tokenizer name → loaded encoder (WASM parsed once, reused)
const encoderCache: Map<TokenizerName, ReturnType<typeof get_encoding>> = new Map();

export async function ensureEncoder(tokenizer: TokenizerName): Promise<void> {
  if (encoderCache.has(tokenizer)) return;
  try {
    const enc = get_encoding(tokenizer);
    encoderCache.set(tokenizer, enc);
  } catch (err) {
    console.warn(`[tokens] Failed to load tiktoken encoder '${tokenizer}': ${err instanceof Error ? err.message : String(err)} — falling back to char/4`);
  }
}

function countTokens(text: string, tokenizer: TokenizerName): number {
  const enc = encoderCache.get(tokenizer);
  // Fail-soft last resort only: char/4 is never chosen as an admission
  // estimator (E1) — it is reachable only when the encoder has not been
  // loaded and tiktoken cannot be used at all.
  if (!enc) return Math.ceil(text.length / 4);
  return enc.encode(text).length;
}

export function estimateTokens(text: string | unknown[], tokenizer: TokenizerName): number {
  const str = Array.isArray(text) ? JSON.stringify(text) : text;
  return countTokens(str, tokenizer);
}

export function estimateMessageTokens(
  msg: { role: string; name?: string; content: string | unknown[] },
  tokenizer: TokenizerName
): number {
  const roleOverhead = 5;
  const nameOverhead = msg.name ? estimateTokens(msg.name, tokenizer) + 6 : 0;
  const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
  return roleOverhead + nameOverhead + estimateTokens(content, tokenizer);
}

/**
 * Padded admission estimator (E1): `ceil(baseTokenizerTokens × SAFETY_FACTOR)`.
 * The estimate is the budget-admission number, and the full estimation
 * metadata is returned for C2 analysis. The tokenizer encoder is ensured
 * before counting, so the estimate is tokenizer-based, not char/4.
 */
export async function estimateBudgetTokens(
  text: string | unknown[],
  tokenizer: TokenizerName
): Promise<EstimationMetadata> {
  await ensureEncoder(tokenizer);
  const rawEstimate = estimateTokens(text, tokenizer);
  return {
    tokenizer,
    rawEstimate,
    safetyFactor: SAFETY_FACTOR,
    budgetEstimate: Math.ceil(rawEstimate * SAFETY_FACTOR),
  };
}

/** Padded admission estimator over a message, preserving the 5-token role /
 * 6-token name overheads (E1, Further Notes). */
export async function estimateMessageBudgetTokens(
  msg: { role: string; name?: string; content: string | unknown[] },
  tokenizer: TokenizerName
): Promise<EstimationMetadata> {
  await ensureEncoder(tokenizer);
  const rawEstimate = estimateMessageTokens(msg, tokenizer);
  return {
    tokenizer,
    rawEstimate,
    safetyFactor: SAFETY_FACTOR,
    budgetEstimate: Math.ceil(rawEstimate * SAFETY_FACTOR),
  };
}

