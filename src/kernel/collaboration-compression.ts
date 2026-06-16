/**
 * collaboration-compression.ts — Safe context compression with metadata tracking.
 *
 * Supports Unicode-safe truncation and extractive excerpt modes.
 * Never reports model_summary — that is a separate optional implementation.
 * All operations are deterministic.
 */

import { createHash } from "node:crypto";

export type CompressionMode = "none" | "truncated" | "extractive";

export type CompressedContent = {
  text: string;
  digest: string;
  meta: { mode: CompressionMode; originalTokens: number; includedTokens: number; };
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function unicodeSafeSlice(text: string, maxChars: number): string {
  // Use Array.from to count Unicode code points, not UTF-16 code units
  const chars = Array.from(text);
  return chars.slice(0, maxChars).join("");
}

/**
 * Truncation mode: cut at maxChars, prefer sentence boundary.
 */
function truncateAtBoundary(text: string, maxChars: number): string {
  const truncated = unicodeSafeSlice(text, maxChars);
  // Try to end at a sentence boundary
  const lastPeriod = truncated.lastIndexOf(".");
  const lastNewline = truncated.lastIndexOf("\n");
  const boundary = Math.max(lastPeriod, lastNewline);
  if (boundary > maxChars * 0.8) return truncated.slice(0, boundary + 1) + "\n...[truncated]";
  return truncated + "\n...[truncated]";
}

/**
 * Interface for deterministic context compression.
 */
export interface ContextCompressor {
  compress(content: string, options: { maxTokens: number; mode: "truncated" | "extractive" }): Promise<CompressedContent>;
}

/**
 * Default compressor — deterministic, no model calls.
 */
export class DefaultContextCompressor implements ContextCompressor {
  async compress(content: string, options: { maxTokens: number; mode: "truncated" | "extractive" }): Promise<CompressedContent> {
    const originalTokens = estimateTokens(content);
    const maxChars = options.maxTokens * 4;

    if (originalTokens <= options.maxTokens) {
      return {
        text: content,
        digest: createHash("sha256").update(content).digest("hex"),
        meta: { mode: "none", originalTokens, includedTokens: originalTokens },
      };
    }

    if (options.mode === "extractive") {
      // Extractive: take first and last paragraphs
      const half = Math.floor(maxChars / 2);
      const firstHalf = unicodeSafeSlice(content, half);
      const lastHalf = unicodeSafeSlice(content.slice(-half), half);
      const result = firstHalf + "\n...[extract]...\n" + lastHalf;
      return {
        text: result,
        digest: createHash("sha256").update(result).digest("hex"),
        meta: { mode: "extractive", originalTokens, includedTokens: estimateTokens(result) },
      };
    }

    // Default: truncated with boundary preference
    const result = truncateAtBoundary(content, maxChars);
    return {
      text: result,
      digest: createHash("sha256").update(result).digest("hex"),
      meta: { mode: "truncated", originalTokens, includedTokens: estimateTokens(result) },
    };
  }
}
