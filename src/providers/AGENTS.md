# src/providers — Model Adapters & Routing

Purpose: thin per-provider `ModelAdapter` adapters, the provider registry, request/response normalization, capability-aware routing (with circuit breakers and free-model fallback), and OpenRouter's free-tier resolution.

## Ownership

| File | Responsibility |
|------|----------------|
| `registry.ts` | `createProvider` + module-level `providerCache` keyed `provider:model:apiKey` (never auto-cleared; lazy registry maps id → class) |
| `base.ts` | `ApiError(status, detail)`, `BaseProvider` abstract adapter, shared response parsing helpers |
| `openrouter-provider.ts` | OpenRouter adapter; `openrouter/free` self-healing free route; **access-control classification** (`classifyProviderAccess`, `ProviderAccessError`) |
| `free-model-resolver.ts` | Capability-aware selection of a concrete free model from the catalog |
| `free-model-catalog.ts` | Fetches/caches the OpenRouter free-model catalog (test hooks `_setCatalogFetchForTesting`/`_resetCatalogCacheForTesting`) |
| `routing-adapter.ts` | `buildRoutingAdapter` (primary → openrouter/free → explicit fallbacks); `RoutingModelAdapter` with per-candidate circuit breakers |
| `circuit-breaker.ts` | Per-candidate failure/threshold/cooldown breaker; only retryable statuses (429/5xx) trip it |
| `unified-complete.ts` | Provider-agnostic `complete`/`stream` HTTP execution + retry (mocked via `_setFetchForTesting`) |
| `specs/*` | Per-provider request/response/error schemas; `toErrorMessage` extracts `error.message` into `ApiError.detail` |

## Local Contracts

- **Error surface:** every provider error is an `ApiError(status, detail)`; `detail` is the human message (for OpenAI-compatible providers, `error.message`).
- **OpenRouter access-classification (durable):** 403 refusals are NOT one class. `classifyProviderAccess(status, detail)` returns:
  - `model_access_restricted` — 403 + `agentic harness` (model's own access policy; e.g. `:free` models restricted to recognized agentic harnesses). A payload/tool change cannot fix it; do NOT blind-fallback/resend.
  - `guardrail_blocked` — 403 + `Request blocked:` (content filter / prompt-injection).
  - `account_rejection` — 403/404 + `allowed-providers` (backing provider not opted into): the free route self-heals by re-resolving to another model.
  - `unknown`.
  - `ProviderAccessError extends ApiError` and carries `accessClass` (`src/providers/openrouter-provider.ts`). Thrown for non-account-rejection 403/404s in `complete()` and for pre-commit error chunks in `stream()` so fallback/governance treat the classes distinctly.
- **Free route:** `openrouter/free` (and any `:free`) resolves a concrete free model per request (never globally cached). Account-rejection 403/404 re-resolves excluding the failed model.
- **Routing:** `RoutingModelAdapter` tries candidates in order; only retryable statuses (429, 500–504) trip a candidate's breaker; non-retryable errors reset (don't trip) the breaker and propagate immediately.
- **API keys:** resolved store-only by callers (`apiKeyFor`/`getApiKey`); provider classes receive the key via constructor. Env is never a resolution source.

## Verification

```bash
pnpm vitest run tests/providers   # adapters, free route, access classification, routing
pnpm build                        # typecheck + build (must be green)
```
