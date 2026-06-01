// src/mcp/retry.ts

export type RetryOptions = {
  maxRetries: number;
  baseDelayMs: number;
  isRetryable?: (err: Error) => boolean;
};

const defaultIsRetryable = (err: Error): boolean => {
  const msg = err.message.toLowerCase();
  return msg.includes("econnrefused") ||
         msg.includes("timeout") ||
         msg.includes("etimedout") ||
         msg.includes("econnreset");
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const isRetryable = options.isRetryable ?? defaultIsRetryable;
  let lastErr: Error | undefined;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (attempt === options.maxRetries) break;
      if (!isRetryable(e)) break;

      const delay = options.baseDelayMs * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastErr;
}
