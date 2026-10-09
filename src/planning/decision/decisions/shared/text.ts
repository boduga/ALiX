/**
 * text.ts — Shared deterministic text helpers for decision baselines.
 *
 * Kept in one place so the claim-verification and context-relevance baselines
 * cannot drift in how they tokenize.
 */

export const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "of", "to", "in", "on", "at", "for", "and", "or", "that", "this", "it",
  "as", "by", "with", "from", "than", "then", "there", "these", "those",
]);

/** Lowercased alphanumeric tokens of length >= 3, minus stopwords. */
export function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (word) => word.length >= 3 && !STOPWORDS.has(word),
  );
}

/** Numeric literals as written (e.g. "100", "3.5"). */
export function numbers(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?/g) ?? [];
}
