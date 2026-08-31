# Model Selection: Paid + Multi-Provider Discovery — Design

**Goal:** Extend `ModelSelectionPolicy` discovery (currently OpenRouter-free-only) to support `cost: paid` / `cost: any`, and to resolve `selection` against **any** provider — reusing the codebase's existing per-provider dynamic model discovery instead of hard-coding model ids.

**Architecture:** A single shared discovery seam that branches by provider. OpenRouter uses a richer catalog (which already contains per-model `pricing` and `supported_parameters`) for full `cost`/`capabilities` matching; every other provider uses the existing `listModels()` for the model list + context limits, ignoring the unverifiable `cost`/`capabilities` filters. Selection ranks cheapest-when-cost-known, otherwise largest-context.

**Tech Stack:** TypeScript. Existing: `src/providers/catalog.ts` (`listModels`), `src/providers/free-model-catalog.ts`, `src/providers/free-model-resolver.ts`, `src/providers/registry.ts` (`createProvider`), `src/providers/routing-adapter.ts` (`buildRoutingAdapter`). Vitest for tests.

## Global Constraints

- API keys resolve **store-only** (user prefs / AGENTS.md): never from env at resolution sites. Discovery must receive the provider key from the caller, never read `process.env` at resolution time.
- The current free/paid model list is **never hard-coded**; discovery always supplies concrete ids.
- All existing `createProvider` / `buildRoutingAdapter` `{provider, model}` callers remain byte-identical (additive + backward compatible).
- `provider` resolution behavior must be identical across every consumer (via the single shared seam).
- Node: `pnpm build`, `pnpm test:vitest`, and the compiled `pnpm test:node` suites must stay green.
- DOX (`src/providers/AGENTS.md`) must be updated to reflect the new filenames and semantics; the GitNexus index is refreshed after the rename (`node .gitnexus/run.cjs analyze`).

---

## Design

### 1. Discovery data model

A single, richer per-model descriptor replaces the free-only `FreeModelInfo`:

```ts
type DiscoveredModel = {
  id: string;
  provider: string;
  inputContextLimit?: number;   // max input tokens, when the source exposes it
  costPerMTokIn?: number;       // USD per million input tokens, only when priced (OpenRouter)
  supportsTools?: boolean;
  supportsStructuredOutput?: boolean;
  supportsVision?: boolean;     // caps only when discoverable (OpenRouter)
};
```

This is the universal shape both the OpenRouter catalog and `listModels()` map into, so the downstream selector sees one type.

### 2. Two fetchers, one selection engine

**`discoverOpenRouterModels(): Promise<DiscoveredModel[]>`**
- Generalizes today's `fetchFreeModelCatalog`: fetches `https://openrouter.ai/api/v1/models`, keeps **all** models (free + paid), parsing `pricing.prompt`/`pricing.completion` into `costPerMTokIn` and `supported_parameters` into the three capability flags.
- Same cache policy (1h TTL; use stale cache if a refetch fails; propagate only with no cache).
- `costPerMTokIn` = parseFloat of `pricing.prompt` (null when absent).
- Requires the caller-provided API key header (store-only), not env.

**`discoverProviderModels(provider, apiKey): Promise<DiscoveredModel[]>`**
- Thin wrapper over existing `listModels(provider, apiKey)` (`catalog.ts:40`), mapping `ModelInfo` → `DiscoveredModel` with `provider` set; `inputContextLimit` from `ModelInfo.maxInputTokens` where present; leaves cost/capabilities undefined (not discoverable).
- Throws for unknown providers (as `listModels` already does).

**`selectModelFromDiscovery(policy, models): DiscoveredModel | undefined`**
- Generalizes `resolveModelBySelectionPolicy`.
- Filters:
  - `minContext` — keep `inputContextLimit >= minContext` when the model exposes it.
  - `cost` — **only when the source exposes cost** (non-OpenRouter has none → filter ignored):
    - `"free"` → `costPerMTokIn === 0`; `"paid"` → `costPerMTokIn > 0`; `"any"` → no cost filter.
  - `capabilities` — **only when the source exposes capabilities** (non-OpenRouter → ignored): require the corresponding `supports*` flag true.
- Ranks:
  - If any eligible model has a known `costPerMTokIn` → sort cheapest first (`costPerMTokIn` asc), tie-break largest `inputContextLimit`, then `id` alphabetical.
  - Else (no cost known) → sort largest `inputContextLimit` first, then `id` alphabetical.
- Returns first, or `undefined` if none eligible.

### 3. The discovery seam (single point of resolution)

**`resolveModelSelectionId(policy, opts: { apiKey?: string }): Promise<{ id: string } | undefined>`**
- Branches on `policy.provider`:
  - `"openrouter"` (or undefined → default openrouter) → `discoverOpenRouterModels()` then `selectModelFromDiscovery(policy, models)`.
  - otherwise → `discoverProviderModels(policy.provider, opts.apiKey)` then `selectModelFromDiscovery(policy, models)` (cost/caps ignored).
- Returns `{ id }` or `undefined` when no eligible model exists.
- This replaces the current OpenRouter-only `resolveModelSelectionId` and is the only seam `createProvider`/`buildRoutingAdapter` call.

### 4. Integration

**`createProvider(config, apiKey)` (`registry.ts`)**
- When `config.selection` present: `resolveModelSelectionId(config.selection, { apiKey })`. The passed `apiKey` is the target provider's key (callers already supply it). Resolved id overrides the effective model.
- Unsatisfiable (returns `undefined`) + explicit `name` → keep name; + no name → throw `Model selection policy could not be satisfied: <policy>`.
- `cost: paid` / non-openrouter are no longer rejected up-front — they resolve via the appropriate fetcher or fail only when nothing is eligible.
- Behavior for `{provider, model}` callers unchanged.

**`buildRoutingAdapter(model, apiKeyFor)` (`routing-adapter.ts`)**
- Passes `apiKeyFor(provider)` into `resolveModelSelectionId`. Seam semantics otherwise unchanged (pre-resolves to concrete `name` for the fallback chain).

### 5. File layout & rename

Rename for honesty (free-* names no longer accurate):

| Old | New |
|-----|-----|
| `src/providers/free-model-catalog.ts` | `src/providers/model-discovery.ts` |
| `src/providers/free-model-resolver.ts` | `src/providers/model-resolver.ts` |

Exports renamed accordingly:
- `fetchFreeModelCatalog` → `discoverOpenRouterModels`
- `resolveModelBySelectionPolicy` / `resolveConcreteFreeModel` → `selectModelFromDiscovery`
- `resolveModelSelectionId` → stays (same name, wider behavior, gains `{ apiKey }`)

Rename touches all importing callers + tests:
- `src/providers/registry.ts` (imports `resolveModelSelectionId`)
- `src/providers/routing-adapter.ts` (imports `resolveModelSelectionId`, `supportsRequest`, `deriveRequestRequirements`)
- `src/providers/openrouter-provider.ts` (uses `resolveConcreteFreeModel` / free resolver for the free route)
- `tests/config/model-selection-policy.vitest.ts`
- `tests/providers/free-model-catalog.vitest.ts`, `tests/providers/free-model-resolver.vitest.ts`, `tests/providers/openrouter-free-route.vitest.ts`, `tests/providers/resolved-model.vitest.ts`, `tests/providers/catalog.vitest.ts`, `tests/providers/access-restriction-registry.vitest.ts`
- `src/providers/AGENTS.md` (DOX) — rename rows + update the policy-selection contract bullet
- Refresh GitNexus index after rename

**OpenRouterProvider free-route note:** the self-healing free route depends on the OpenRouter free resolver. It must keep working after the rename — the free model selection remains "largest-context among currently-free" via the generalized engine, and restricted-model exclusion (access-restriction registry) is preserved as the `exclude` set passed into `selectModelFromDiscovery`.

### 6. Error handling

- Discovery network/provider failure: propagate as an error when there is no cache; otherwise use stale OpenRouter cache (preserved current behavior). `listModels` failures for non-openrouter propagate (no cache there).
- Empty eligible set (`undefined`) is distinct from failures and drives the existing fallback/throw in `createProvider` (name fallback; else throw the clear selection message).
- Unverifiable `cost`/`capabilities` on non-openrouter sources are silently ignored (per decision), not errors.

### 7. Testing

Vitest additions (extend / new file beside `model-selection-policy.vitest.ts`):
- OpenRouter `cost: paid`: picks the **cheapest** paid model among those meeting caps/minContext.
- OpenRouter `cost: any`: picks cheapest across free+paid.
- OpenRouter `cost: free`: unchanged (largest-context among free).
- Non-openrouter (mock provider via `listModels`): picks largest-context; **ignores** `capabilities`/`cost` filters.
- Non-openrouter `minContext` honored when provider exposes context limits, ignored when it doesn't.
- No eligible model → `undefined` → `createProvider` throws (no name) / falls back (name).
- ApiKey threaded into discovery (assert discovery receives the caller key, not env).

Rename fallout: update existing test imports to new file/function names; all suites stay green.

### 8. Verification

```bash
pnpm build
pnpm vitest run tests/providers tests/config/model-selection-policy.vitest.ts
# selected compiled node suites (providers, subagent-cli, route-executor, providers.test)
node dist/tests/providers/provider-registry.test.js
node dist/tests/agents/subagent-cli.test.js
node dist/tests/runtime/route-executor.test.js
node .gitnexus/run.cjs analyze   # re-index after rename
```
