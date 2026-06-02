# Sub-Project #1: Unified LLM API Abstraction

**Date:** 2026-05-31
**Status:** Completed (2026-05-31)
**Parent Project:** What ALiX Can Learn From Pi Agent
**Source:** Comparison with [earendil-works/pi](https://github.com/earendil-works/pi) (`@earendil-works/pi-ai`)

## Motivation

ALiX has 12 LLM providers in `src/providers/`. Each is a class with `complete()` and `stream()` methods that reimplement the same translation logic:
- Request body shaping (system prompt, messages, tools)
- Response parsing (text, tool calls, usage)
- Error normalization
- Streaming chunk conversion
- Auth header construction

This is **2167 lines of provider code** with significant duplication. Adding a 13th provider means writing 100-200 lines of new code that mostly duplicates existing patterns.

Pi Agent solves this with `@earendil-works/pi-ai`: a unified multi-provider API where each provider is a small spec module of pure functions, dispatched by a single core. No OOP inheritance for translation logic.

## Goals

1. **Reduce provider surface area** from 2167 → ~900 lines (60% reduction)
2. **Make adding providers trivial** — ~30-40 lines per new spec, not 100-200
3. **Improve testability** — pure functions instead of mocked classes
4. **Preserve the `ModelAdapter` interface** — zero changes to consumers
5. **Enable spec inheritance** — 7+ OpenAI-compatible providers share one base spec

## Non-Goals

- Changing the `ModelAdapter` interface (consumers don't need to update)
- Replacing `BaseProvider`'s HTTP/retry logic (kept, used by dispatcher)
- Adding new providers in this sub-project
- Changing the catalog or registry (they keep working unchanged)

## Architecture

```
src/providers/
├── specs/                    ← NEW (12 spec modules, ~30-40 lines each)
│   ├── _openai-base.ts       (shared base, ~30 lines)
│   ├── openai-spec.ts        (uses _openai-base)
│   ├── groq-spec.ts          (overrides baseUrl)
│   ├── deepseek-spec.ts      (overrides baseUrl)
│   ├── perplexity-spec.ts    (overrides baseUrl)
│   ├── minimax-spec.ts       (overrides baseUrl)
│   ├── zhipuai-spec.ts       (overrides baseUrl)
│   ├── grokai-spec.ts        (overrides baseUrl)
│   ├── openrouter-spec.ts    (overrides baseUrl)
│   ├── anthropic-spec.ts     (unique, ~40 lines)
│   ├── google-spec.ts        (unique, ~40 lines)
│   ├── ollama-spec.ts        (unique, ~30 lines)
│   └── mock-spec.ts          (~20 lines, no HTTP)
├── base.ts                   ← KEEP (HTTP/retry/timeout helpers)
├── unified-complete.ts       ← NEW (dispatcher, ~150 lines)
├── catalog.ts                ← KEEP (model registry)
├── registry.ts               ← KEEP (provider lookup)
├── spec-types.ts             ← NEW (ProviderSpec type, ~20 lines)
└── types.ts                  ← KEEP (NormalizedRequest, etc.)
```

### Spec Inheritance Map

```
openai (base) ──┬── groq
               ├── deepseek
               ├── perplexity
               ├── minimax
               ├── zhipuai
               ├── grokai
               └── openrouter

anthropic (standalone)
google (standalone)
ollama (standalone)
mock (standalone)
```

8 of 12 providers share OpenAI's wire format with 1-2 line overrides. Only 4 specs need to be written from scratch.

## Components

### 1. `ProviderSpec` type (`spec-types.ts`)

```typescript
export type ProviderSpec = {
  baseUrl: string;
  authHeader: (apiKey: string) => Record<string, string>;
  toRequestBody: (req: NormalizedRequest & { model: string }) => unknown;
  fromResponse: (res: unknown) => NormalizedResponse;
  fromStreamChunk: (chunk: string) => StreamChunk | null;
  toErrorMessage: (status: number, body: unknown) => string;
};
```

### 2. OpenAI base spec (`specs/_openai-base.ts`)

Pure functions for OpenAI's chat completions wire format. ~30 lines.

```typescript
export const openaiBaseSpec: ProviderSpec = {
  baseUrl: "",  // each provider overrides
  authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  toRequestBody: (req) => ({ /* OpenAI body shape */ }),
  fromResponse: (res) => /* parse OpenAI response */,
  fromStreamChunk: (chunk) => /* parse SSE line */,
  toErrorMessage: (status, body) => /* format error */,
};
```

### 3. Provider specs (e.g., `groq-spec.ts`)

```typescript
import { openaiBaseSpec } from "./_openai-base.js";

export const groqSpec: ProviderSpec = {
  ...openaiBaseSpec,
  baseUrl: "https://api.groq.com/openai/v1/chat/completions",
};
```

### 4. Dispatcher (`unified-complete.ts`)

```typescript
const SPECS = new Map<string, ProviderSpec>([
  ["openai", openaiSpec],
  ["groq", groqSpec],
  // ... 12 entries
]);

export async function complete(
  provider: string,
  model: string,
  request: NormalizedRequest
): Promise<NormalizedResponse> {
  const spec = SPECS.get(provider);
  if (!spec) throw new Error(`Unknown provider: ${provider}`);
  
  const apiKey = resolveApiKey(provider);
  const body = spec.toRequestBody({ ...request, model });
  const res = await fetchWithRetry(spec.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...spec.authHeader(apiKey) },
    body: JSON.stringify(body),
  });
  
  if (!res.ok) throw new ApiError(spec.toErrorMessage(res.status, await res.json()));
  return spec.fromResponse(await res.json());
}

export async function* stream(
  provider: string,
  model: string,
  request: NormalizedRequest
): AsyncGenerator<StreamChunk> {
  const spec = SPECS.get(provider)!;
  const apiKey = resolveApiKey(provider);
  const body = spec.toRequestBody({ ...request, model, stream: true });
  const res = await fetch(spec.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...spec.authHeader(apiKey) },
    body: JSON.stringify(body),
  });
  
  for await (const line of parseSSE(res)) {
    const chunk = spec.fromStreamChunk(line);
    if (chunk) yield chunk;
  }
}
```

### 5. Compatibility shim (existing providers)

Each existing provider class becomes a thin wrapper:

```typescript
// Before (anthropic-provider.ts, ~200 lines)
class AnthropicProvider extends BaseProvider {
  async complete(req: NormalizedRequest) {
    // 50 lines: request shaping, fetch, response parsing
  }
  async *stream(req) {
    // 60 lines: SSE parsing
  }
}

// After (anthropic-provider.ts, ~30 lines)
class AnthropicProvider extends BaseProvider {
  id = "anthropic";
  editFormatPreference = "structured_patch";
  longContextStrategy = "trimmed_context";
  
  async complete(req: NormalizedRequest) {
    return complete("anthropic", this._model, req);
  }
  async *stream(req: NormalizedRequest) {
    yield* stream("anthropic", this._model, req);
  }
}
```

The `ModelAdapter` interface is preserved. Consumers (`run.ts`, catalog, registry) don't change.

## Data Flow

```
run.ts → provider.complete(req)
   ↓
[AnthropicProvider.complete(req)]  (compatibility shim, ~5 lines)
   ↓
unified-complete.complete("anthropic", model, req)
   ↓
[Spec.toRequestBody(req)]  →  POST https://api.anthropic.com/v1/messages
   ↓                                            ↓
[Spec.fromResponse(json)]  ←──────────────  JSON response
   ↓
NormalizedResponse (text, toolCalls, usage, finishReason)
```

## Error Handling

- **Network errors**: `fetchWithRetry` handles 3 retries with exponential backoff for 429/5xx
- **Provider errors**: Each spec's `toErrorMessage(status, body)` formats provider-specific error
- **Unknown provider**: Dispatcher throws clear `Error("Unknown provider: X")`
- **Missing API key**: `resolveApiKey` throws with hint to set env var
- **Streaming errors**: `StreamChunk { type: "error", error: "..." }` yielded; consumer's loop can react

## Testing Strategy (TDD)

### 1. Pure function tests (100% of specs)

```
tests/providers/specs/
├── openai-spec.test.ts        — toRequestBody, fromResponse, fromStreamChunk
├── anthropic-spec.test.ts     — same
├── google-spec.test.ts        — same (with vertex-ai vs generative-language API variants)
├── ollama-spec.test.ts        — same
├── mock-spec.test.ts          — same
├── _openai-base.test.ts       — base spec shared with 7 inheritors
└── inheritors.test.ts         — verify groq/deepseek/etc. just override baseUrl correctly
```

### 2. Dispatcher tests

```
tests/providers/unified-complete.test.ts
├── "calls the right spec for provider X"
├── "retries on 429 with backoff"
├── "retries on 5xx with backoff"
├── "throws ApiError on non-retryable 4xx"
├── "throws when provider is unknown"
├── "throws when API key is missing"
├── "formats auth header per spec"
└── "streams via SSE/NDJSON correctly"
```

### 3. Compatibility regression tests

Existing tests (`tests/config-loader.test.ts`, integration tests) must continue to pass. No changes required — the `ModelAdapter` interface is preserved.

### 4. Test helper

`tests/providers/helpers/mock-fetch.ts` — utility for injecting canned HTTP responses:

```typescript
function makeMockFetch(responses: Array<{ status: number; body: unknown }>) {
  let i = 0;
  return async () => {
    const r = responses[i++] ?? { status: 200, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status });
  };
}
```

## Files Affected

| Action | File | Reason |
|--------|------|--------|
| ➕ New | `src/providers/spec-types.ts` | `ProviderSpec` type |
| ➕ New | `src/providers/unified-complete.ts` | Dispatcher |
| ➕ New | `src/providers/specs/_openai-base.ts` | Shared base for 7 specs |
| ➕ New | `src/providers/specs/openai-spec.ts` | OpenAI spec |
| ➕ New | `src/providers/specs/groq-spec.ts` | Groq spec (1-line override) |
| ➕ New | `src/providers/specs/deepseek-spec.ts` | DeepSeek spec |
| ➕ New | `src/providers/specs/perplexity-spec.ts` | Perplexity spec |
| ➕ New | `src/providers/specs/minimax-spec.ts` | MiniMax spec |
| ➕ New | `src/providers/specs/zhipuai-spec.ts` | ZhipuAI spec |
| ➕ New | `src/providers/specs/grokai-spec.ts` | GrokAI spec |
| ➕ New | `src/providers/specs/openrouter-spec.ts` | OpenRouter spec |
| ➕ New | `src/providers/specs/anthropic-spec.ts` | Anthropic spec |
| ➕ New | `src/providers/specs/google-spec.ts` | Google spec |
| ➕ New | `src/providers/specs/ollama-spec.ts` | Ollama spec |
| ➕ New | `src/providers/specs/mock-spec.ts` | Mock spec |
| ✏️ Modify | `src/providers/anthropic-provider.ts` | Thin wrapper |
| ✏️ Modify | `src/providers/openai-provider.ts` | Thin wrapper |
| ✏️ Modify | `src/providers/deepseek-provider.ts` | Thin wrapper |
| ✏️ Modify | `src/providers/groq-provider.ts` | Thin wrapper |
| ✏️ Modify | `src/providers/ollama-provider.ts` | Thin wrapper |
| ✏️ Modify | `src/providers/perplexity-provider.ts` | Thin wrapper |
| ✏️ Modify | `src/providers/minimax-provider.ts` | Thin wrapper |
| ✏️ Modify | `src/providers/zhipuai-provider.ts` | Thin wrapper |
| ✏️ Modify | `src/providers/grokai-provider.ts` | Thin wrapper |
| ✏️ Modify | `src/providers/openrouter-provider.ts` | Thin wrapper |
| ✏️ Modify | `src/providers/gemini-provider.ts` | Thin wrapper |
| ✏️ Modify | `src/providers/mock-provider.ts` | Thin wrapper |
| ✅ Keep | `src/providers/base.ts` | HTTP helpers, used by dispatcher |
| ✅ Keep | `src/providers/catalog.ts` | Model registry |
| ✅ Keep | `src/providers/registry.ts` | Provider lookup |
| ✅ Keep | `src/providers/types.ts` | NormalizedRequest, etc. |
| ➕ New | `tests/providers/` | ~400 lines of new tests |

## Migration Strategy

1. **Add new code first** (no breaking changes): spec-types, specs/, unified-complete
2. **Add comprehensive tests** for specs and dispatcher (TDD)
3. **Migrate one provider** end-to-end (e.g., OpenAI) — verify it works via existing tests
4. **Migrate remaining 11 providers** in waves: OpenAI-compatibles (7) → standalone (3) → mock (1)
5. **Remove old `complete()` implementations** once all providers are thin wrappers
6. **Verify all existing tests pass** at each migration step

## Success Criteria

- [ ] All 12 providers migrated to spec-based implementation
- [ ] `src/providers/` line count reduced from 2167 to ~900 (60% reduction)
- [ ] Adding a 13th OpenAI-compatible provider requires only 1 new file (~30 lines) — verified by test
- [ ] All existing tests pass without modification (compatibility preserved)
- [ ] New test coverage: 100% of spec modules have dedicated tests
- [ ] `npm run build` succeeds
- [ ] `npm test` passes (currently 1155 pass, 0 fail, 4 skip)
- [ ] At least one provider verified end-to-end (e.g., OpenAI) via `alix run` with real API call

## Out of Scope (Deferred to Other Sub-Projects)

- Sub-project #2: Agent runtime split (uses this spec system but separate work)
- Sub-project #3: TUI differential rendering
- Sub-project #4: Supply-chain hardening
- Sub-project #5: Self-extensibility improvements
- Sub-project #6: Public session sharing
