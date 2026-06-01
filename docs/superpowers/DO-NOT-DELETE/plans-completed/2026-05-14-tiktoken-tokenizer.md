# Model Context Limits + Tiktoken Tokenizer Plan

> **Status: COMPLETED** — All tasks implemented across `context-limit-resolver` and related branches.

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

- [x] **Step 1: Add maxContextTokens to ModelConfig in schema.ts**

Added `maxContextTokens?: number` to `ModelConfig` in `src/config/schema.ts`.

- [x] **Step 2: Create src/config/context-limits.ts**

Created `src/config/context-limits.ts` with:
- `EncodingName` type (`"cl100k_base" | "o200k_base" | "char4"`)
- `PROVIDER_DEFAULTS` map with defaults for all 12 providers
- `MODEL_OVERRIDES` map for known exact model overrides
- `resolveContextLimit()` with three-tier resolution
- `getEncoding()` function returning encoding name per provider

- [x] **Step 3: Run build, commit**

`npm run build` — PASS
Commit: `feat: add maxContextTokens to model config and tiered context limit resolver`

---

### Task 2: Swap char/4 for tiktoken with encoding-aware token counting

**Files:**
- Modify: `src/utils/tokens.ts` — replace CHARS_PER_TOKEN with encoding-aware encoder cache
- Modify: `src/run.ts` — wire in resolved limit and encoding
- Test: `tests/token-budget.test.ts` (update for encoding parameter)

- [x] **Step 1: Install tiktoken**

`npm install tiktoken` — installed as `"tiktoken": "^1.0.22"` in package.json.

- [x] **Step 2: Rewrite tokens.ts**

Rewrote `src/utils/tokens.ts` with:
- `encoderCache` Map<EncodingName, tiktoken encoder>
- `ensureEncoder(encoding)` — lazy-loads and caches encoders (skips char4)
- `countTokens(text, encoding)` — uses tiktoken or falls back to ceil(len/4)
- `estimateTokens(text | unknown[], encoding)` — string or ContentPart[]
- `estimateMessageTokens(msg, encoding)` — role (5) + name overhead + content
- `truncateToTokenBudget(messages, maxTokens, encoding)` — keeps most recent within budget, returns `{ kept, dropped }`

- [x] **Step 3: Update run.ts**

In `src/run.ts`:
- Imported `resolveContextLimit`, `getEncoding` from `./config/context-limits.js`
- Imported `ensureEncoder`, `estimateTokens`, `truncateToTokenBudget` from `./utils/tokens.js`
- After config load: `userOverride` check → API lookup → provider default
- `await ensureEncoder(encoding)` before the run loop
- Truncation check uses `estimateTokens(m.content, encoding)` and `truncateToTokenBudget()` with encoding parameter

- [x] **Step 4: Update tests**

In `tests/token-budget.test.ts`:
- All `truncateToTokenBudget` calls updated to pass third `encoding` argument
- Added test for char/4 fallback when no encoder cached

- [x] **Step 5: Run build + tests**

Run: `npm run build && node --test dist/tests/token-budget.test.js` — PASS

- [x] **Step 6: Commit**

Commit: `feat: use tiktoken for accurate token counting with API-based context resolution`

---

### Self-Review

- [x] **Spec coverage:** Both tasks fully implemented
- [x] **No placeholders:** All code is complete and committed
- [x] **Encoding consistency:** `cl100k_base` for most providers, `o200k_base` for Google, `char4` for mock
- [x] **Graceful fallback:** `countTokens()` falls back to `ceil(len/4)` when no encoder cached
- [x] **User override wins:** `model.maxContextTokens` in config bypasses API lookup

### Notes

- **API lookup is async** — called once at session start, not in the hot loop
- **Graceful fallback chain** — exact model → API → provider default → 64K catch-all
- **char/4 fallback** — if tiktoken WASM fails to load, `countTokens()` returns `ceil(len/4)` — never breaks the truncation logic
- **Encoding per provider** — `cl100k_base` for most, `o200k_base` for Google, `char4` for mock
- **Future: LiteLLM** — could add `litellm.get_max_tokens()` as a second-tier lookup if the standalone API approach proves incomplete for OpenAI / OpenRouter models