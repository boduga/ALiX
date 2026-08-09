# ALiX MiniMax Token Plan Provider — Design

**Date:** 2026-08-08
**Status:** Approved (awaiting implementation)
**Scope:** Add `minimax-token-plan` as a new provider entry to ALiX, supporting MiniMax's Token Plan keys (`sk-cp-...`) via the Anthropic-compatible protocol (`api.minimax.io/anthropic`).

## Context

The MiniMax Token Plan ([docs](https://platform.minimax.io/docs/token-plan/other-tools)) is the new way to authenticate against MiniMax M-series models. It uses a single `sk-cp-...` key (prefix-distinguished from the legacy JWT issued for M-series access) and supports two protocols:

- **OpenAI-compatible** — `https://api.minimax.io/v1`
- **Anthropic-compatible** — `https://api.minimax.io/anthropic` *(recommended by MiniMax for prompt-cache benefits)*

The current ALiX `minimax` provider was built against the OLD JWT-issued endpoint (`api.minimax.chat/v1/models` and `api.minimax.chat/v1/text/chatcompletion_v2`). This is failing for users with 401 errors (per the user's recent paste). The `cloud-minimax.json` profile already points at `MiniMax-M3` (the Token Plan model) via the broken `minimax` provider — a pre-existing misalignment.

This design adds a separate provider entry for the Token Plan so the existing `minimax` provider can stay untouched (no breaking change for any remaining JWT users) while Token Plan users get a working path.

## Decisions

- **New provider entry** — `minimax-token-plan`. The existing `minimax` provider is unchanged.
- **Protocol** — Anthropic-compatible (`https://api.minimax.io/anthropic`). Per MiniMax docs, this is the recommended choice for CLI tools and provides prompt-cache benefits.
- **Auth** — `x-api-key: <key>` + `anthropic-version: 2023-06-01` (inherited from `anthropicSpec`).
- **Default model** — `MiniMax-M3`.
- **Env var** — `MINIMAX_TOKEN_PLAN_KEY`. Catalog hint: `sk-cp-...`.
- **Profile** — `cloud-minimax.json` updated to point all 5 tiers at `minimax-token-plan`.

## Spec reuse strategy

The new spec reuses `anthropicSpec` via spread — the Token Plan is documented as "Anthropic-Compatible" so the on-the-wire format is identical:

```ts
// src/providers/specs/minimax-token-plan-spec.ts
import { anthropicSpec } from "./anthropic-spec.js";
import type { ProviderSpec } from "../spec-types.js";
export const minimaxTokenPlanSpec: ProviderSpec = {
  ...anthropicSpec,
  baseUrl: "https://api.minimax.io/anthropic",
};
```

This means message-format conversion, stream parsing, error mapping, and tool-call handling are all inherited from `anthropicSpec`. The only delta is the base URL.

## Files

### Add

| File | Lines | Purpose |
|------|-------|---------|
| `src/providers/minimax-token-plan-provider.ts` | ~45 | Provider class, mirrors `anthropic-provider.ts` |
| `src/providers/specs/minimax-token-plan-spec.ts` | 5 | Spec that extends `anthropicSpec` |
| `tests/providers/minimax-token-plan.test.ts` | ~40 | Capability + identity tests |

### Modify

| File | Change |
|------|--------|
| `src/providers/catalog.ts` | Add `minimax-token-plan` to `PROVIDERS` (line 33 area); add `listModels` switch case (after line 135); add `DEFAULT_MODELS["minimax-token-plan"] = "MiniMax-M3"` (line 171 area) |
| `src/providers/unified-complete.ts` | Register `["minimax-token-plan", minimaxTokenPlanSpec]` in `SPECS` Map (line 18-32); add `minimax-token-plan: "MINIMAX_TOKEN_PLAN_KEY"` to `PROVIDER_KEY_ENV` (line 34-48) |
| `src/providers/registry.ts` | Register lazy provider (line 19-33); add to `listProviders()` (line 61-76) |
| `src/security/credentials/credential-migration.ts` | Add to `PROVIDER_ENV_MAP` (line 60-71) |
| `src/config/context-limits.ts` | Add `minimax-token-plan: { contextWindowTokens: 1_048_576, tokenizer: "cl100k_base" }` (alongside line 38) |
| `src/config/profiles/cloud-minimax.json` | Change `provider: "minimax"` → `provider: "minimax-token-plan"` in all 5 tiers (lines 8-12) |
| `tests/manual/run-cli.ts` | Add `minimax-token-plan: "MINIMAX_TOKEN_PLAN_KEY"` to `PROVIDER_ENV_VARS` (line 21-33) |
| `tests/providers/streaming-regression.test.ts` | Add `[name, spec]` to `STREAMING_SPECS` (line 25) |

### No changes (auto-covered)

- `tests/providers/catalog.vitest.ts` — picks up via `PROVIDERS` array
- `tests/cli/helpers/provider-selection.vitest.ts` — picks up via `PROVIDERS` array
- `tests/cli/helpers/api-keys.vitest.ts` — provider-agnostic

## Components

### PROVIDERS entry (`catalog.ts`)

```ts
{ id: "minimax-token-plan", name: "MiniMax (Token Plan)", env: "MINIMAX_TOKEN_PLAN_KEY", hint: "sk-cp-..." }
```

### listModels switch case (`catalog.ts`)

```ts
case "minimax-token-plan": {
  const response = await fetch("https://api.minimax.io/anthropic/v1/models", {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  const data = (await response.json()) as { data: Array<{ id: string; display_name?: string; max_input_tokens?: number; max_tokens?: number }> };
  return data.data.map((m) => ({
    id: m.id,
    displayName: m.display_name ?? m.id,
    maxInputTokens: m.max_input_tokens,
    maxOutputTokens: m.max_tokens,
  }));
}
```

### DEFAULT_MODELS entry

```ts
minimax-token-plan: "MiniMax-M3",
```

### Provider class (`minimax-token-plan-provider.ts`)

```ts
import { BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type MiniMaxTokenPlanConfig = {
  apiKey?: string;
  model?: string;
};

export class MiniMaxTokenPlanProvider extends BaseProvider {
  id = "minimax-token-plan";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "expanded_context" as const;

  get capabilities() {
    return {
      provider: "minimax-token-plan",
      model: this._model,
      inputTokenLimit: 1_000_000,
      outputTokenLimit: 64_000,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: true,
    };
  }

  constructor(config: MiniMaxTokenPlanConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.MINIMAX_TOKEN_PLAN_KEY ?? "",
      model: config.model ?? "MiniMax-M3",
      baseUrl: "https://api.minimax.io/anthropic",
      timeoutMs: 120_000,
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    return complete("minimax-token-plan", this._model, request, { apiKey: this._apiKey });
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    yield* stream("minimax-token-plan", this._model, request, { apiKey: this._apiKey });
  }
}
```

### Profile update (`cloud-minimax.json`)

```diff
- "default":    { "provider": "minimax", "name": "MiniMax-M3", "temperature": 0.3, "contextWindow": 1048576 }
- "planner":    { "provider": "minimax", "name": "MiniMax-M3", "temperature": 0.2, "contextWindow": 1048576 }
- "coder":      { "provider": "minimax", "name": "MiniMax-M3", "temperature": 0.1, "contextWindow": 1048576 }
- "researcher": { "provider": "minimax", "name": "MiniMax-M3", "temperature": 0.3, "contextWindow": 1048576 }
- "critic":     { "provider": "minimax", "name": "MiniMax-M3", "temperature": 0.2, "contextWindow": 1048576 }
+ "default":    { "provider": "minimax-token-plan", "name": "MiniMax-M3", "temperature": 0.3, "contextWindow": 1048576 }
+ "planner":    { "provider": "minimax-token-plan", "name": "MiniMax-M3", "temperature": 0.2, "contextWindow": 1048576 }
+ "coder":      { "provider": "minimax-token-plan", "name": "MiniMax-M3", "temperature": 0.1, "contextWindow": 1048576 }
+ "researcher": { "provider": "minimax-token-plan", "name": "MiniMax-M3", "temperature": 0.3, "contextWindow": 1048576 }
+ "critic":     { "provider": "minimax-token-plan", "name": "MiniMax-M3", "temperature": 0.2, "contextWindow": 1048576 }
```

(`embeddings` tier stays on `openai` — unchanged.)

### context-limits entry

```ts
minimax-token-plan: { contextWindowTokens: 1_048_576, tokenizer: "cl100k_base" }
```

## Data flow

1. User runs `alix config set-default-model` → menu now includes `MiniMax (Token Plan)` (option 9).
2. User picks it → prompts for `sk-cp-...` key.
3. `setApiKey("minimax-token-plan", key)` writes to `~/.config/alix/config.json` `apiKeys["minimax-token-plan"]` and injects `process.env.MINIMAX_TOKEN_PLAN_KEY` for the current process.
4. `getAvailableModels("minimax-token-plan")` → `listModels` calls `https://api.minimax.io/anthropic/v1/models` with `x-api-key` header.
5. Live list returned (expected `[MiniMax-M3]`) — user picks `MiniMax-M3`.
6. Writes `model: { provider: "minimax-token-plan", name: "MiniMax-M3" }` to `.alix/config.json`.
7. `alix run` invokes `createProvider(...)` → `MiniMaxTokenPlanProvider` instance via `lazyProviders`.
8. `complete(...)` → `unified-complete.ts` looks up `minimaxTokenPlanSpec` from `SPECS` → `toRequestBody` (inherited from `anthropicSpec`) → POST to `https://api.minimax.io/anthropic/v1/messages`.

## Error handling

Inherited from existing infrastructure; no new error paths:

- **401 from listModels** — NOT retried (per `isRetryable` at `provider-selection.ts:122-137` — 4xx is permanent). Falls back to `DEFAULT_MODELS["minimax-token-plan"] = "MiniMax-M3"` via the warn-once guard in `_modelWarned`.
- **401 from completion** — Bubbled up as `ApiError` (from `base.ts`). The `withProviderContracts` wrapper in `registry.ts:56` catches it and surfaces a diagnostic.
- **5xx / network error** — One retry through `unified-complete.ts:60 fetchWithRetry`; terminal failure surfaces to the user.
- **Missing key** — `getApiKey` returns `undefined` → CLI prompts (`cli.ts:696`), saves to `~/.config/alix/config.json` via `setApiKey`.
- **Spec mismatch** — If `api.minimax.io/anthropic` returns a non-Anthropic-compat response, `fromResponse` would fail to parse. The current Anthropic spec has been stable for production usage, so this risk is low.

## Testing

### New tests

`tests/providers/minimax-token-plan.test.ts` (new file, ~40 lines):
- `createProvider("minimax-token-plan", ...)` returns `MiniMaxTokenPlanProvider`
- `id` is `"minimax-token-plan"`
- Default model is `MiniMax-M3`
- `capabilities.inputTokenLimit === 1_000_000`
- `capabilities.outputTokenLimit === 64_000`
- `capabilities.supportsVision === true`
- `capabilities.supportsStructuredOutput === true`
- `complete` and `stream` delegate to `unified-complete.ts` (call it with provider id `"minimax-token-plan"`)

### Modified tests

`tests/providers/streaming-regression.test.ts` — add `[name, spec]` to `STREAMING_SPECS` (line 25) so the streaming regression suite covers the new spec (inheriting `anthropicSpec`'s wire-format tests).

### No new tests (auto-covered)

- `tests/providers/catalog.vitest.ts` — `PROVIDERS` array change automatically extends `ALL_ENV_VARS` and `detectProvider` precedence order.
- `tests/cli/helpers/provider-selection.vitest.ts` — `resolveProviders` tests automatically include the new provider.
- `tests/cli/helpers/api-keys.vitest.ts` — `getApiKey`/`setApiKey` precedence is provider-agnostic.

### Verification

End-to-end smoke:
1. `pnpm build && pnpm test:vitest` — all green.
2. `alix config set-default-model` → menu shows `MiniMax (Token Plan)` as a new option.
3. Enter a valid `sk-cp-...` key → live fetch returns `MiniMax-M3` → set.
4. `alix run --message "hello"` — successful completion to `api.minimax.io/anthropic/v1/messages`.
5. Check `~/.config/alix/config.json` `apiKeys["minimax-token-plan"]` has the key and `model.provider === "minimax-token-plan"`.
6. Check `.alix/config.json` (if in a git repo) `model.provider === "minimax-token-plan"`.

## Risks

- **API drift** — If `api.minimax.io/anthropic` diverges from `api.anthropic.com` (e.g., custom headers, different streaming protocol), the spec reuse will silently break. Mitigation: the streaming regression test suite validates the new spec against the same wire-format expectations as the Anthropic spec; divergence would surface in tests.
- **Token Plan deprecation** — If MiniMax migrates to a new auth scheme, this provider will need a similar follow-up. The drift is tracked via the `chat-classify-similar-issues` map (per standing rules).
- **Capability numbers** — `inputTokenLimit: 1_000_000` and `outputTokenLimit: 64_000` are best-effort estimates from the docs. Future M3 context budgeting (T6 C1 observability) will validate these against actual response usage.

## Out of scope

- Updating the existing `minimax` provider's default model or hint (kept as-is to avoid breaking JWT users).
- OpenAI-compatible Token Plan variant (separate provider entry — deferred).
- Per-provider calibration wiring for `minimax-token-plan` (the spec says `providerCalibration` is per provider id; this falls out naturally once `token.calibration` events land per Task 1).
- Doc updates beyond the spec itself (deferred to a separate doc-pr task).
