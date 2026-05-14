// Rough token estimation: ~4 chars per token on average
const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count for a string. Uses char count / 4 as a rough proxy.
 */
export function estimateTokens(text: string | unknown[]): number {
  const str = Array.isArray(text) ? JSON.stringify(text) : text;
  return Math.ceil(str.length / CHARS_PER_TOKEN);
}

/**
 * Estimate tokens for a full message (role + name + content).
 */
export function estimateMessageTokens(msg: { role: string; name?: string; content: string | unknown[] }): number {
  const roleOverhead = 5; // {"role":"user"} ≈ 5 tokens
  const nameOverhead = msg.name ? estimateTokens(msg.name) + 6 : 0;
  const contentStr = Array.isArray(msg.content) ? JSON.stringify(msg.content) : msg.content;
  return roleOverhead + nameOverhead + estimateTokens(contentStr);
}

/**
 * Truncate messages array to stay within token budget, keeping the most recent.
 * Returns { kept, dropped }.
 */
export function truncateToTokenBudget(
  messages: Array<{ role: string; name?: string; content: string | unknown[] }>,
  maxTokens: number
): { kept: typeof messages; dropped: typeof messages } {
  const result: typeof messages = [];
  let totalTokens = 0;
  // Iterate newest to oldest, keep adding until budget hit
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const cost = estimateMessageTokens(msg);
    if (totalTokens + cost > maxTokens && result.length > 0) break;
    result.unshift(msg);
    totalTokens += cost;
  }
  return { kept: result, dropped: messages.slice(0, messages.length - result.length) };
}