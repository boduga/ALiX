/**
 * Detect and redact secrets from strings.
 * Used to sanitize tool results, prompts, logs, and UI streams.
 */

const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Bearer tokens
  { pattern: /(?<![a-zA-Z0-9])[bB]earer\s+[A-Za-z0-9_\-]{10,}/g, label: "[BEARER_TOKEN]" },
  // Generic API keys (various formats)
  { pattern: /(?<![a-zA-Z0-9])(?:api[_-]?key|apikey|apiSecret|api_secret)\s*[:=]\s*["']?([A-Za-z0-9_\-]{16,})["']?/gi, label: "[API_KEY]" },
  // AWS access keys
  { pattern: /(?<![A-Za-z0-9/])AKIA[0-9A-Z]{16}(?![A-Za-z0-9/])/g, label: "[AWS_KEY]" },
  // AWS secret keys
  { pattern: /(?<![a-zA-Z0-9])[A-Za-z0-9/+=]{40}(?![a-zA-Z0-9/+=])/g, label: "[AWS_SECRET]" },
  // GitHub tokens
  { pattern: /(?<![a-zA-Z0-9])gh[pousr]_[A-Za-z0-9_]{36,}/g, label: "[GITHUB_TOKEN]" },
  // OpenAI / generic sk- keys
  { pattern: /(?<![a-zA-Z0-9])sk-[A-Za-z0-9_\-]{20,}/g, label: "[API_TOKEN]" },
  // Anthropic keys
  { pattern: /(?<![a-zA-Z0-9])sk-ant-[A-Za-z0-9_\-]{30,}/g, label: "[API_TOKEN]" },
  // Google API keys
  { pattern: /(?<![a-zA-Z0-9])AIza[0-9A-Za-z_-]{30,}/g, label: "[API_KEY]" },
  // Private keys (PEM, RSA, EC)
  { pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g, label: "[PRIVATE_KEY]" },
  { pattern: /-----BEGIN\s+EC\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+EC\s+PRIVATE\s+KEY-----/g, label: "[PRIVATE_KEY]" },
  // JWT tokens
  { pattern: /(?<![a-zA-Z0-9])eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+(?![a-zA-Z0-9])/g, label: "[JWT_TOKEN]" },
  // Generic secret values (long alphanumeric strings that look like tokens)
  { pattern: /(?<![a-zA-Z0-9])[a-zA-Z0-9_\-]{40,}(?![a-zA-Z0-9])(?=\s|$)/g, label: "[SECRET]" },
  // Connection strings with credentials
  { pattern: /(?:password|passwd|pwd|secret)\s*[:=]\s*["']?([^\s'"]{8,})["']?/gi, label: "[SECRET]" },
];

/**
 * Redact secrets from a string. Returns a new string with secrets replaced by labels.
 */
export function redactSecrets(input: string): string {
  let result = input;
  for (const { pattern, label } of SECRET_PATTERNS) {
    result = result.replace(pattern, label);
  }
  return result;
}

/**
 * Check if a string contains any secrets.
 */
export function containsSecrets(input: string): boolean {
  for (const { pattern } of SECRET_PATTERNS) {
    if (pattern.test(input)) return true;
  }
  return false;
}

export type RedactedValue<T> = {
  original: T;
  redacted: T;
  hadSecrets: boolean;
};

/**
 * Redact secrets from a value, returning both original and redacted versions.
 * Works on strings, arrays of strings, and objects with string values.
 */
export function redactValue<T extends string | string[] | Record<string, unknown>>(value: T): RedactedValue<T> {
  if (typeof value === "string") {
    const redacted = redactSecrets(value);
    return { original: value, redacted: redacted as T, hadSecrets: value !== redacted };
  }
  if (Array.isArray(value)) {
    const redactedArr = value.map((v) => redactSecrets(v));
    const hadSecrets = value.some((v) => v !== redactSecrets(v));
    return { original: value, redacted: redactedArr as T, hadSecrets };
  }
  if (value !== null && typeof value === "object") {
    const redactedObj = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        typeof v === "string" ? redactSecrets(v) : v,
      ])
    );
    const hadSecrets = Object.values(value as Record<string, unknown>).some(
      (v) => typeof v === "string" && v !== redactSecrets(v)
    );
    return { original: value, redacted: redactedObj as T, hadSecrets };
  }
  return { original: value, redacted: value, hadSecrets: false };
}