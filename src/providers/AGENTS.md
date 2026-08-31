# src/providers — Model Adapters & Routing

Purpose: thin per-provider `ModelAdapter` adapters, the provider registry, request/response normalization, capability-aware routing (with circuit breakers and free-model fallback), and OpenRouter's free-tier resolution.

## Ownership

| File | Responsibility |
|------|----------------|
| `registry.ts` | `createProvider` (single choke point) + module-level `providerCache` keyed `provider:model:apiKey` (never auto-cleared; lazy registry maps id → class). Accepts a `ModelConfig`-shape `{provider, name?, selection?}` or legacy `{provider, model}`; resolves non-null `selection` to a concrete id before construction |
| `base.ts` | `ApiError(status, detail)`, `BaseProvider` abstract adapter, shared response parsing helpers |
| `openrouter-provider.ts` | OpenRouter adapter; `openrouter/free` self-healing free route; **access-control classification** (`classifyProviderAccess`, `ProviderAccessError`) |
| `access-restriction-registry.ts` | Bounded-lifetime (TTL) registry of models refused by access-control 403s; excluded from free-candidate selection until the TTL expires, then revalidated |
| `model-resolver.ts` | Capability-aware selection of a concrete model from discovery. Shared capability vocabulary (`deriveRequestRequirements`/`supportsRequest`); `selectModelFromDiscovery` maps a `ModelSelectionPolicy` (cost/capabilities/minContext) onto it; `resolveModelSelectionId` is the async discovery seam (OpenRouter catalog or `listModels` + restriction registry) shared by `createProvider` and `buildRoutingAdapter`; `resolveConcreteFreeModel` is the free-route request-derived helper |
| `model-discovery.ts` | Fetches/caches the full OpenRouter model catalog (`discoverOpenRouterModels`, returns free + paid `DiscoveredModel`s; test hooks `_setOpenRouterDiscoveryFetch`/`_resetOpenRouterDiscoveryCache`) |
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
- **Bounded-lifetime access-restriction (durable):** when a free-route candidate is refused by an access-control 403 (`model_access_restricted`/`guardrail_blocked`), the model id is recorded in `access-restriction-registry.ts` and excluded from future free-candidate selection for a bounded TTL (default 10 min) — NEVER permanently — then revalidated (re-recorded only if refused again). Account-rejection (`allowed-providers`) is NOT recorded: it self-heals per-request via the `tried` exclude set.
- **Policy-driven selection (durable):** `ModelConfig.selection` (`ModelSelectionPolicy`: `provider`/`cost`/`capabilities`/`minContext`) expresses requirements; discovery supplies the model id. The single discovery seam is `resolveModelSelectionId` (`model-resolver.ts`), used by `createProvider` (the registry choke point — every consumer with a `selection` resolves here) and `buildRoutingAdapter` (which pre-resolves so its fallback chain/labels see a concrete `name`). Effective model = `name ?? model`; non-null `selection` overrides both unless unsatisfiable, in which case an explicit `name` is kept or a clear error is thrown. `cost: free` is served by models with `costPerMTokIn === 0`; `paid`/non-openrouter via `listModels`. `isValidModelConfig` accepts `provider && (name || selection)`. This also fixes the historical `.model`-undefined bug: call sites that pass a full `ModelConfig` (`plan`, runtime routes) now deliver `.name`. Design rule: the current free-model list is never hard-coded.
- **Free route:** `openrouter/free` (and any `:free`) resolves a concrete free model per request via `resolveConcreteFreeModel` (request-derived requirements, `needsTools` forced true), filtering the full discovery catalog to `costPerMTokIn === 0` and excluding bound-lifetime access-restricted ids + already-tried ids. Never globally cached.
- **Routing:** `RoutingModelAdapter` tries candidates in order; only retryable statuses (429, 500–504) trip a candidate's breaker; non-retryable errors reset (don't trip) the breaker and propagate immediately.
- **API keys:** resolved store-only by callers (`apiKeyFor`/`getApiKey`); provider classes receive the key via constructor. Env is never a resolution source.

## Verification

```bash
pnpm vitest run tests/providers   # adapters, free route, access classification + bounded-lifetime registry, routing
pnpm build                        # typecheck + build (must be green)
```
