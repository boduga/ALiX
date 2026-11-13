# Model Providers & Routing

## Overview

`src/models/providers` contains the model-access layer: thin per-provider
`ModelAdapter` implementations, the `createProvider` construction choke point,
shared request/response normalization types, contract validation and timeout
wrapping, capability-aware model resolution against live discovery, and a
retrying routing adapter with per-candidate circuit breakers and a free-model
fallback chain. It also holds provider locality/redaction predicates, the
keyless-provider source of truth, and the local `llama-server` launcher.

Provider-specific wire schemas live under `./specs/`.

## Interface

- `ProviderConfig` and `createProvider(config, apiKey?)` — the single adapter construction path `[registry.ts:ProviderConfig]` `[registry.ts:createProvider]`.
- `listProviders()` and the `lazyProviders` registry mapping provider ids to lazily imported adapter classes `[registry.ts:listProviders]` `[registry.ts:lazyProviders]`.
- Core contracts: `ModelAdapter`, `NormalizedRequest`, `NormalizedResponse`, `StreamChunk`, `ModelCapabilities`, `ToolDef`, `ToolCall`, `TokenUsage`, `NormalizedMessage`, `assertCorrelatedToolResult` `[types.ts:ModelAdapter]` `[types.ts:assertCorrelatedToolResult]`.
- `BaseProvider`, `ApiError`, `mergeSignals`, `extractSummary`, `parseToolArgs` `[base.ts:BaseProvider]` `[base.ts:ApiError]`.
- `withProviderContracts`, `validateNormalizedRequest`, `validateNormalizedResponse`, `validateStreamChunk`, `ContractValidationError` `[provider-contract-validation.ts:withProviderContracts]`.
- `buildRoutingAdapter`, `RoutingModelAdapter`, `buildFallbackChain`, `RoutingOptions`, `RoutingCandidate` `[routing-adapter.ts:buildRoutingAdapter]` `[routing-adapter.ts:buildFallbackChain]`.
- `CircuitBreaker` `[circuit-breaker.ts:CircuitBreaker]`.
- Discovery and selection: `deriveRequestRequirements`, `supportsRequest`, `discoverProviderModels`, `selectDiscoveredModel`, `resolveSelectionModelId`, `resolveConcreteFreeSelection` `[model-resolver.ts:selectDiscoveredModel]` `[model-resolver.ts:resolveConcreteFreeSelection]`.
- Discovery cache: `discoverOpenRouterModels`, `DiscoveredModel`, `isFreeModel`, plus test-only cache hooks `[model-discovery.ts:discoverOpenRouterModels]`.
- Localization and access gating: `isLocalProvider`, `isRemoteProvider`, `LOCAL_PROVIDERS`, `KEYLESS_PROVIDERS`, `isKeylessProvider`, `recordAccessRestricted` `[provider-locality.ts:isRemoteProvider]` `[keyless-providers.ts:KEYLESS_PROVIDERS]` `[access-restriction-registry.ts:recordAccessRestricted]`.
- Catalog and helpers: `PROVIDERS`, `listModels`, `getDefaultModel`, `detectProvider`, `getInstalledOllamaModels`, GGUF helpers `listLocalLlamaGgufModels` / `localLlamaMaxInputTokens` / `resolveLocalLlamaScanDir` `[catalog.ts:listModels]` `[catalog.ts:getInstalledOllamaModels]`.
- `checkProvider`, `ProviderHealthResult` `[provider-doctor.ts:checkProvider]`.
- `ensureLlamaServer`, `resolveLlamaKnobs`, `buildLlamaServerArgs` `[local-llama-launcher.ts:ensureLlamaServer]`.
- `redactOutboundRequest`, `isRemoteProvider` gating `[outbound-redaction.ts:redactOutboundRequest]`.
- Child contract: [specs](./specs/README.md).

## Invariants

- `ProviderConfig` accepts either the legacy `{ provider, model }` shape or `{ provider, name, selection }`, plus `timeoutMs`, `streamIdleTimeoutMs`, per-provider base URLs, and local GGUF/launcher options `[registry.ts:ProviderConfig]`.
- `createProvider` is the construction choke point; its in-memory cache key includes provider, resolved model, API key, every base-URL override, both timeout overrides, and `localModelPath`, so a changed bound can never silently reuse a previously built adapter `[registry.ts:createProvider]`.
- An unknown provider id throws `Unknown provider: <id>` rather than falling back to another adapter `[registry.ts:createProvider]`.
- `lazyProviders` covers every implemented provider plus the `mock` and `scripted-mock` doubles `[registry.ts:lazyProviders]`.
- The default total call timeout is `180_000` ms; `ollama`, `local-llama`, `freellmapi`, `xiaomi-mimo-token-plan`, `intern`, and `hive` default to `300_000` ms; the default stream idle timeout is `60_000` ms `[registry.ts:DEFAULT_TIMEOUT_MS]` `[registry.ts:DEFAULT_STREAM_IDLE_TIMEOUT_MS]`.
- `withProviderContracts` validates requests, responses, and stream chunks, clamps output tokens to the adapter ceiling, redacts remote outbound text, enforces both timeouts, and emits one model span per physical request `[provider-contract-validation.ts:withProviderContracts]`.
- Locality fails closed: any provider id not explicitly local is treated as remote and is subject to outbound redaction `[provider-locality.ts:isRemoteProvider]`.
- The keyless provider set is exactly `ollama`, `local-llama`, and `mock`, and every keyless check must read from that module `[keyless-providers.ts:KEYLESS_PROVIDERS]`.
- `redactOutboundRequest` returns a new request with redacted message/tool-result content and never throws `[outbound-redaction.ts:redactOutboundRequest]`.
- The routing adapter retries only `429`, `500`, `502`, `503`, and `504`, and its per-candidate breaker defaults to a failure threshold of 2 with a 60s cooldown `[routing-adapter.ts:RETRYABLE_STATUS]` `[routing-adapter.ts:DEFAULT_BREAKER]`.
- `buildFallbackChain` inserts `openrouter/free` first only when `routing.freeFallback` is set and the primary provider is OpenRouter, then appends explicit fallbacks `[routing-adapter.ts:buildFallbackChain]`.
- The standalone `CircuitBreaker` defaults to a failure threshold of 3 and a 30s cooldown, transitioning open → half-open after the cooldown `[circuit-breaker.ts:CircuitBreaker]`.
- The OpenRouter discovery cache TTL is one hour, and a stale cache is served when a refetch fails `[model-discovery.ts:discoverOpenRouterModels]` `[model-discovery.ts:TTL_MS]`.
- Access-restricted models are excluded from free-candidate selection for a default TTL of 10 minutes, after which they are revalidated `[access-restriction-registry.ts:recordAccessRestricted]` `[access-restriction-registry.ts:DEFAULT_TTL_MS]`.
- `unified-complete` retries `429` and `5xx` responses with exponential backoff capped at 8000 ms and a default budget of 3 attempts `[unified-complete.ts:fetchWithRetry]`.
- `ensureLlamaServer` resolves each launcher knob by precedence config → `ALIX_LLAMA_*` environment → default, and throws when the model path or `llama-server` binary is missing `[local-llama-launcher.ts:ensureLlamaServer]` `[local-llama-launcher.ts:resolveLlamaKnobs]`.

## Side Effects

- Performs outbound network provider calls and retries them on retryable statuses `[unified-complete.ts:fetchWithRetry]` `[routing-adapter.ts:RETRYABLE_STATUS]`.
- Writes contract diagnostics to the `.alix/diagnostics` store sink `[provider-contract-validation.ts:diagSink]`.
- Reads user config and executes `ollama list` (3s timeout, failures return `[]`) during catalog discovery `[catalog.ts:loadUserConfigApiKeys]` `[catalog.ts:getInstalledOllamaModels]`.
- `ensureLlamaServer` may spawn a child `llama-server` process `[local-llama-launcher.ts:ensureLlamaServer]`.
- Retains constructed adapters in a process-wide in-memory `providerCache` that is never auto-cleared `[registry.ts:createProvider]`.

## Verification

- Run: `pnpm test`
