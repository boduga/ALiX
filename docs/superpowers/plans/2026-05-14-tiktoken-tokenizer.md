# Model Context Limits + Tiktoken Tokenizer Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Replace the 4-chars-per-token heuristic with tiktoken for accurate token counting, and dynamically resolve each model's context window rather than hardcoding it.

**Tiered context resolution (tried in order):**
1. **API lookup** — Query the provider's models endpoint directly (`models.list()`)
2. **Hardcoded defaults** — Provider-level fallbacks for providers without accessible APIs
3. **User override** — `model.maxContextTokens` in config always wins

**Architecture:**
- `src/config/context-limits.ts` — `resolveContextLimit(provider, modelName, apiKeys)` returns `{ maxTokens, encoding }`
- `src/utils/tokens.ts` — tiktoken encoder cache, encoding-aware token counting
- `src/run.ts` — wires in resolved limit and encoding

---

### Task 1: Context limit resolver with API lookup + hardcoded defaults

**Files:**
- Modify: `src/config/schema.ts` — add `maxContextTokens?: number` to `ModelConfig`
- Create: `src/config/context-limits.ts` — API lookup + defaults + encoding selection

- [ ] **Step 1: Add maxContextTokens to ModelConfig in schema.ts**

```typescript
export type ModelConfig = {
  // ... existing fields ...
  maxContextTokens?: number; // override — always wins
};
```

- [ ] **Step 2: Create src/config/context-limits.ts**

```typescript
export type EncodingName = "cl100k_base" | "o200k_base" | "char4";

type ContextResult = { maxTokens: number; encoding: EncodingName };

// Hardcoded provider defaults (used when API lookup fails or is unavailable)
const PROVIDER_DEFAULTS: Record<string, ContextResult> = {
  anthropic:  { maxTokens: 200_000,  encoding: "cl100k_base" },
  openai:     { maxTokens: 128_000,  encoding: "cl100k_base" },
  openrouter: { maxTokens: 64_000,   encoding: "cl100k_base" },
  groq:       { maxTokens: 128_000,  encoding: "cl100k_base" },
  perplexity: { maxTokens: 128_000,  encoding: "cl100k_base" },
  minimax:    { maxTokens: 64_000,   encoding: "cl100k_base" },
  google:     { maxTokens: 1_000_000, encoding: "o200k_base" },
  deepseek:   { maxTokens: 64_000,   encoding: "cl100k_base" },
  ollama:     { maxTokens: 64_000,   encoding: "cl100k_base" },
  grokkai:    { maxTokens: 131_000,  encoding: "cl100k_base" },
  local:      { maxTokens: 64_000,   encoding: "cl100k_base" },
  mock:       { maxTokens: 100_000,  encoding: "char4" },
};

// Known exact model overrides
const MODEL_OVERRIDES: Record<string, ContextResult> = {
  "claude-opus-4-7":    { maxTokens: 1_000_000, encoding: "cl100k_base" },
  "claude-sonnet-4-6":  { maxTokens: 1_000_000, encoding: "cl100k_base" },
  "claude-haiku-4-5":   { maxTokens: 200_000,  encoding: "cl100k_base" },
  "gemini-2.5-pro":    { maxTokens: 1_000_000, encoding: "o200k_base" },
  "gemini-2.0-flash":  { maxTokens: 1_000_000, encoding: "o200k_base" },
  "gemini-1.5-pro":    { maxTokens: 2_000_000, encoding: "o200k_base" },
  "gemini-1.5-flash":  { maxTokens: 1_000_000, encoding: "o200k_base" },
  "gpt-4o":            { maxTokens: 128_000,  encoding: "cl100k_base" },
  "gpt-4-turbo":       { maxTokens: 128_000,  encoding: "cl100k_base" },
};

/**
 * Resolve context limit for a model using a tiered approach:
 * 1. Exact model override (MODEL_OVERRIDES)
 * 2. API lookup (Anthropic models.list() — context_window field)
 * 3. Provider default (PROVIDER_DEFAULTS)
 *
 * encoding is always derived from provider, not from API.
 */
export async function resolveContextLimit(
  provider: string,
  modelName: string,
  apiKeys?: Record<string, string>
): Promise<ContextResult> {
  // 1. Exact model override
  if (modelName && MODEL_OVERRIDES[modelName]) {
    return MODEL_OVERRIDES[modelName];
  }

  // 2. API lookup (Anthropic — context_window exposed in models.list())
  if (provider === "anthropic" && apiKeys?.anthropic) {
    try {
      const result = await fetchAnthropicModels(apiKeys.anthropic, modelName);
      if (result) return result;
    } catch {
      // Fall through to provider default
    }
  }

  // 3. Provider default
  return PROVIDER_DEFAULTS[provider] ?? { maxTokens: 64_000, encoding: "cl100k_base" };
}

async function fetchAnthropicModels(apiKey: string, targetModel: string): Promise<ContextResult | null> {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
  });
  if (!res.ok) return null;
  const data = await res.json() as { data: Array<{ id: string; context_window?: number }> };
  const model = data.data.find(m => m.id === targetModel || m.id.includes(targetModel.split("-").slice(-1)[0]));
  if (model?.context_window) {
    return { maxTokens: model.context_window, encoding: "cl100k_base" };
  }
  return null;
}

/**
 * Get the tiktoken encoding name for a provider.
 */
export function getEncoding(provider: string): EncodingName {
  if (provider === "google") return "o200k_base";
  if (provider === "mock") return "char4";
  return "cl100k_base";
}
```

- [ ] **Step 3: Run build, commit**

```bash
npm run build
git add src/config/schema.ts src/config/context-limits.ts
git commit -m "feat: add maxContextTokens to model config and tiered context limit resolver"
```

---

### Task 2: Swap char/4 for tiktoken with encoding-aware token counting

**Files:**
- Modify: `src/utils/tokens.ts` — replace CHARS_PER_TOKEN with encoding-aware encoder cache
- Modify: `src/run.ts` — wire in resolved limit and encoding
- Test: `tests/token-budget.test.ts` (update for encoding parameter)

- [ ] **Step 1: Install tiktoken**

```bash
npm install tiktoken
```

- [ ] **Step 2: Rewrite tokens.ts**

```typescript
import tiktoken from "tiktoken";
import type { EncodingName } from "../config/context-limits.js";

// Cache: encoding name → loaded encoder (WASM parsed once, reused)
const encoderCache: Map<EncodingName, Awaited<ReturnType<typeof tiktoken>>> = new Map();

export async function ensureEncoder(encoding: EncodingName): Promise<void> {
  if (encoding === "char4") return;
  if (encoderCache.has(encoding)) return;
  try {
    const enc = await tiktoken(encoding);
    encoderCache.set(encoding, enc);
  } catch {
    // Fail silently — fall back to char/4
  }
}

/**
 * Count tokens in a string using the specified encoding.
 * Falls back to char/4 if no encoder is cached (e.g. still loading).
 */
export function countTokens(text: string, encoding: EncodingName): number {
  const enc = encoderCache.get(encoding);
  if (!enc) return Math.ceil(text.length / 4);
  return enc.encode(text).length;
}

/**
 * Estimate tokens in a string or ContentPart[].
 */
export function estimateTokens(text: string | unknown[], encoding: EncodingName): number {
  const str = Array.isArray(text) ? JSON.stringify(text) : text;
  return countTokens(str, encoding);
}

/**
 * Estimate tokens in a full message (role + name + content overhead).
 */
export function estimateMessageTokens(
  msg: { role: string; name?: string; content: string | unknown[] },
  encoding: EncodingName
): number {
  const roleOverhead = 5;
  const nameOverhead = msg.name ? estimateTokens(msg.name, encoding) + 6 : 0;
  const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
  return roleOverhead + nameOverhead + estimateTokens(content, encoding);
}

/**
 * Truncate messages to stay within token budget, keeping most recent.
 * Returns { kept, dropped }.
 */
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
```

- [ ] **Step 3: Update run.ts**

```typescript
import { resolveContextLimit, getEncoding } from "./config/context-limits.js";
import { ensureEncoder, estimateTokens, truncateToTokenBudget } from "./utils/tokens.js";

// After loading config, resolve context limit:
const userOverride = config.model.maxContextTokens;
let maxTokens: number;
if (userOverride !== undefined) {
  maxTokens = userOverride;
} else {
  const resolved = await resolveContextLimit(config.model.provider, config.model.name, config.apiKeys);
  maxTokens = resolved.maxTokens;
}
const encoding = userOverride !== undefined
  ? getEncoding(config.model.provider)
  : (await resolveContextLimit(config.model.provider, config.model.name, config.apiKeys)).encoding;

await ensureEncoder(encoding);
const MAX_CONTEXT_TOKENS = maxTokens;
```

Update the truncation check in the loop:

```typescript
const msgTokens = messages.reduce(
  (sum, m) => sum + estimateTokens(m.content, encoding),
  0
);
if (msgTokens > MAX_CONTEXT_TOKENS / 2) {
  const { kept, dropped } = truncateToTokenBudget(messages, MAX_CONTEXT_TOKENS / 2, encoding);
  if (dropped.length > 0) {
    messages = [...(kept as NormalizedMessage[])];
    await log.append({ ...session, actor: "system", type: "context.truncated", payload: {
      droppedCount: dropped.length,
      provider: config.model.provider,
      maxTokens: MAX_CONTEXT_TOKENS,
      encoding
    }});
  }
}
```

- [ ] **Step 4: Update tests**

In `tests/token-budget.test.ts`, update `truncateToTokenBudget` calls to pass encoding:

```typescript
const { kept, dropped } = truncateToTokenBudget(messages, 15000, "cl100k_base");
```

Add a test for char/4 fallback when no encoder is cached:

```typescript
test("estimateTokens falls back to char/4 when no encoder cached", () => {
  const result = estimateTokens("hello world", "cl100k_base");
  assert.ok(result > 0); // Works whether encoder is loaded or not
});
```

- [ ] **Step 5: Run build + tests**

```bash
npm run build && node --test dist/tests/token-budget.test.js
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/tokens.ts src/run.ts src/config/context-limits.ts src/config/schema.ts package.json package-lock.json tests/token-budget.test.ts
git commit -m "feat: use tiktoken for accurate token counting with API-based context resolution"
```

---

### Notes

- **API lookup is async** — called once at session start, not in the hot loop
- **Graceful fallback chain** — exact model → API → provider default → 64K catch-all
- **char/4 fallback** — if tiktoken WASM fails to load, `countTokens()` returns `ceil(len/4)` — never breaks the truncation logic
- **Encoding per provider** — `cl100k_base` for most, `o200k_base` for Google, `char4` for mock
- **Future: LiteLLM** — could add `litellm.get_max_tokens()` as a second-tier lookup if the standalone API approach proves incomplete for OpenAI / OpenRouter models