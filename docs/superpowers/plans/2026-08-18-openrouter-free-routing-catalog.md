# OpenRouter Free Models & Capability-Aware Routing — Revised Implementation Plan

> **Status: UPDATED AFTER ARCHITECTURAL REVIEW**
>
> **Verdict:** Implementation should **not** begin from the previous version. This revision incorporates the blocking correctness findings around request-dependent free-model resolution, streaming fallback commitment, capability-aware candidate selection, and circuit-breaker ownership.
>
> **Goal:** Add OpenRouter free-model support and ordered model routing to ALiX without changing the existing single-provider execution path, while accurately recording the concrete model actually served.

---

# 1. Goal

Implement a governed model-routing layer with three capabilities:

1. **OpenRouter free-model discovery**

   * Fetch and cache the OpenRouter `/models` catalog.
   * Identify free models using the project's locked pricing semantics.
   * Expose capabilities relevant to ALiX execution.

2. **Capability-aware `openrouter/free` resolution**

   * Treat `openrouter/free` as a logical model route.
   * Resolve it to a concrete free model **per request**.
   * Never globally cache a request-dependent concrete model.

3. **Ordered fallback routing**

   * Preserve the existing primary model as the first candidate.
   * Optionally fall back to OpenRouter free routing.
   * Optionally use explicitly configured fallback candidates.
   * Retry only retryable failures.
   * Never fall back after streaming output has been committed.

The system must also capture the **actual provider-served model** as `resolvedModel` so telemetry can distinguish:

```text
requested model:
    openrouter/free

actual model:
    qwen/qwen3-14b:free
```

The existing no-routing path must remain behaviorally unchanged.

---

# 2. Locked architectural invariants

These invariants are mandatory.

## INV-1 — Existing default path is unchanged

When no `models.default.routing` configuration exists:

```ts
buildRoutingAdapter(...)
```

must return the same provider adapter that `createProvider(...)` currently returns.

No routing wrapper is introduced.

No behavior changes.

No new retry semantics.

No capability negotiation changes.

---

## INV-2 — Catalog caching and model selection are separate

The OpenRouter model catalog may be cached.

The concrete model selected from that catalog **must not be globally cached**.

Correct:

```text
OpenRouter /models
       ↓
cached catalog
       ↓
request requirements
       ↓
resolver
       ↓
concrete model
```

Incorrect:

```text
OpenRouter /models
       ↓
resolver
       ↓
global cached concrete model
       ↓
all future requests
```

The concrete selection is request-dependent.

---

## INV-3 — Free-model resolution is capability-aware

A free model is eligible only if it can satisfy the current request's required capabilities.

At minimum the resolver must account for:

* tools
* structured output
* vision
* input-token/context requirement where available

The resolver must not select a model that is known to be incapable of serving the request.

---

## INV-4 — Routing candidates are capability-filtered

Capability awareness applies to **all routing candidates**, not only `openrouter/free`.

Before attempting a candidate:

```ts
supportsRequest(candidate.adapter.capabilities, deriveRequestRequirements(request))
```

must determine whether the candidate is eligible.

An incompatible candidate is skipped rather than invoked and allowed to fail with a non-retryable provider error.

---

## INV-5 — Streaming fallback has a commitment boundary

Streaming fallback is allowed only before externally visible output has been committed.

Before the first committed chunk:

```text
retryable provider failure
        ↓
try next candidate
```

After committed output:

```text
retryable provider failure
        ↓
DO NOT fallback
        ↓
propagate failure
```

This prevents:

```text
model A output
+
model B output
```

from being concatenated into one response.

---

## INV-6 — Circuit breaker owns candidate suppression

The router must not create a second independent cooldown state machine if the existing `CircuitBreaker` already provides candidate suppression.

The breaker owns:

```text
closed
open
half-open/recovery
```

The router owns:

```text
candidate ordering
candidate eligibility
fallback policy
```

The router must not duplicate breaker state with a parallel `cooldowns` map.

---

## INV-7 — Retryability is explicit

Only these HTTP statuses are retryable:

```ts
429
500
502
503
504
```

Non-retryable errors such as:

```text
400
401
403
404
```

must not be silently converted into fallback attempts.

---

## INV-8 — `resolvedModel` is optional and additive

Existing consumers must continue to work.

The new field:

```ts
resolvedModel?: string
```

is additive to:

* `NormalizedResponse`
* stream `done` chunk
* usage event payload

Existing TUI/executive consumers must remain valid.

---

## INV-9 — Provider-reported model wins

For OpenRouter:

```text
requested = openrouter/free
```

does not identify the actual model.

The provider response's:

```json
{
  "model": "qwen/qwen3-14b:free"
}
```

is authoritative for `resolvedModel`.

---

## INV-10 — No new runtime dependencies

Use existing repository infrastructure and native APIs.

---

# 3. Architecture

```text
                    ModelConfig
                         │
                         ▼
              ┌────────────────────┐
              │ RoutingModelAdapter │
              └─────────┬──────────┘
                        │
            ordered candidate list
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
       Primary     OpenRouter/free   Explicit
       adapter         route        fallback
                         │
                         ▼
                ┌──────────────────┐
                │ Cached free      │
                │ model catalog    │
                └────────┬─────────┘
                         │
                         ▼
                request requirements
                         │
                         ▼
                ┌──────────────────┐
                │ Pure resolver    │
                └────────┬─────────┘
                         │
                         ▼
                  concrete model
```

Telemetry path:

```text
Provider response
      │
      ▼
resolvedModel
      │
      ├── NormalizedResponse
      │
      ├── stream done chunk
      │
      ├── streamToResponse
      │
      ├── model.usage
      │
      └── m09.metric
```

---

# 4. File structure

| File                                     | Responsibility                                                    |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `src/providers/types.ts`                 | `NormalizedResponse.resolvedModel?`, stream done `resolvedModel?` |
| `src/providers/spec-types.ts`            | optional `ProviderSpec.resolveModel`                              |
| `src/providers/specs/openrouter-spec.ts` | extract provider-reported model                                   |
| `src/providers/unified-complete.ts`      | attach `resolvedModel` to complete/stream                         |
| `src/contracts/llm-schemas.ts`           | widen normalized response/done schemas                            |
| `src/providers/free-model-catalog.ts`    | catalog fetch, parsing, caching                                   |
| `src/providers/free-model-resolver.ts`   | pure request-aware free-model selection                           |
| `src/providers/openrouter-provider.ts`   | `openrouter/free` logical route                                   |
| `src/providers/routing-adapter.ts`       | ordered capability-aware routing                                  |
| `src/config/schema.ts`                   | routing configuration                                             |
| `src/agent/agent.ts`                     | routing adapter composition                                       |
| `src/run/helpers.ts`                     | collect `resolvedModel` from stream                               |
| `src/agent/messages.ts`                  | usage payload                                                     |
| `src/run/task-loop.ts`                   | usage + metric resolved model                                     |
| `src/models/routing-cli.ts`              | catalog/routing descriptions                                      |
| `src/cli/commands/models.ts`             | CLI commands                                                      |

Tests:

```text
tests/providers/resolved-model.vitest.ts
tests/providers/free-model-catalog.vitest.ts
tests/providers/free-model-resolver.vitest.ts
tests/providers/openrouter-free-route.vitest.ts
tests/providers/routing-adapter.vitest.ts
tests/config/routing-config.vitest.ts
tests/cli/models-routing-command.vitest.ts
```

---

# Task 1: Resolved-model capture foundation

## Files

Modify:

```text
src/providers/types.ts
src/providers/spec-types.ts
src/providers/specs/openrouter-spec.ts
src/providers/unified-complete.ts
src/contracts/llm-schemas.ts
src/run/helpers.ts
```

Test:

```text
tests/providers/resolved-model.vitest.ts
```

## Step 1 — Write failing tests

Create `tests/providers/resolved-model.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import { openrouterSpec } from "../../src/providers/specs/openrouter-spec.js";
import { complete, stream, _setFetchForTesting } from "../../src/providers/unified-complete.js";
import { streamToResponse } from "../../src/run/helpers.js";
import type { ModelAdapter, NormalizedRequest } from "../../src/providers/types.js";

const req: NormalizedRequest = { systemPrompt: "s", messages: [{ role: "user", content: "hi" }] };

describe("resolved-model capture", () => {
  it("openrouterSpec.resolveModel reads res.model", () => {
    expect(openrouterSpec.resolveModel?.({ model: "qwen/qwen3-14b:free", choices: [] })).toBe("qwen/qwen3-14b:free");
    expect(openrouterSpec.resolveModel?.({})).toBeUndefined();
  });

  it("complete() attaches resolvedModel when the spec provides one", async () => {
    _setFetchForTesting(async () => new Response(JSON.stringify({
      model: "qwen/qwen3-14b:free",
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    try {
      const res = await complete("openrouter", "openrouter/free", req, { apiKey: "k" });
      expect(res.resolvedModel).toBe("qwen/qwen3-14b:free");
    } finally {
      _setFetchForTesting(globalThis.fetch);
    }
  });

  it("stream() emits done with resolvedModel sniffed from SSE lines", async () => {
    const lines = [
      "data: {\"id\":\"x\",\"model\":\"qwen/qwen3-14b:free\",\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}",
      "data: {\"id\":\"x\",\"model\":\"qwen/qwen3-14b:free\",\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}",
      "data: [DONE]",
    ];
    _setFetchForTesting(async () => new Response(lines.join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    try {
      const chunks = [];
      for await (const c of stream("openrouter", "openrouter/free", req, { apiKey: "k" })) chunks.push(c);
      const done = chunks.find((c) => c.type === "done");
      expect(done).toEqual({ type: "done", resolvedModel: "qwen/qwen3-14b:free" });
    } finally {
      _setFetchForTesting(globalThis.fetch);
    }
  });

  it("streamToResponse surfaces resolvedModel from the done chunk", async () => {
    const fake: ModelAdapter = {
      id: "openrouter",
      editFormatPreference: "search_replace",
      longContextStrategy: "trimmed_context",
      capabilities: { provider: "openrouter", model: "openrouter/free", inputTokenLimit: 200_000, outputTokenLimit: 8192, supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true },
      stream: async function* () {
        yield { type: "text_delta", text: "hi" };
        yield { type: "done", resolvedModel: "qwen/qwen3-14b:free" };
      },
    };
    const out = await streamToResponse(fake, req);
    expect(out.resolvedModel).toBe("qwen/qwen3-14b:free");
  });
});
```

## Step 2 — Verify failure

Run:

```bash
pnpm vitest run tests/providers/resolved-model.vitest.ts --config vitest.config.mts
```

Expected: FAIL — `openrouterSpec.resolveModel` is not a function; `complete` response has no `resolvedModel`; done chunk has no `resolvedModel`.

## Step 3 — Implement

### `src/providers/types.ts`

Add to `NormalizedResponse`:

```ts
  /** Provider-reported model actually served (e.g. `openrouter/free` → concrete free id). */
  resolvedModel?: string;
```

Widen the done chunk:

```ts
  | { type: "done"; resolvedModel?: string }
```

### `src/providers/spec-types.ts`

Add to `ProviderSpec`:

```ts
  /** Extract the provider-reported model actually served, if the response reports one. */
  resolveModel?: (res: unknown) => string | undefined;
```

### `src/providers/specs/openrouter-spec.ts`

```ts
export const openrouterSpec: ProviderSpec = {
  ...openaiBaseSpec,
  baseUrl: "https://openrouter.ai/api/v1/chat/completions",
  resolveModel: (res) => {
    const r = res as { model?: unknown };
    return typeof r.model === "string" ? r.model : undefined;
  },
};
```

### `src/providers/unified-complete.ts` — `complete()`

After `const json = await res.json();`:

```ts
  const json = await res.json();
  const response = spec.fromResponse(json);
  if (spec.resolveModel) {
    const resolvedModel = spec.resolveModel(json);
    if (resolvedModel) response.resolvedModel = resolvedModel;
  }
  return response;
```

### `src/providers/unified-complete.ts` — `stream()`

In the line loop, BEFORE the `parseOpenAiToolDeltaLine` call:

```ts
        const sse = tryParseSseLine(line);
        if (sse && typeof sse.model === "string" && Array.isArray(sse.choices)) streamModel = sse.model;
```

Declare the holder at the top of the `try` block (with the other stream state):

```ts
  let streamModel: string | undefined;
```

Wrap the spec dispatch so the terminal done chunk carries the sniffed model:

```ts
        const chunk = spec.fromStreamChunk(trimmedLine);
        if (chunk && chunk.type === "done" && streamModel) yield { ...chunk, resolvedModel: streamModel };
        else if (chunk) yield chunk;
```

### `src/contracts/llm-schemas.ts`

`NormalizedResponseSchema`:

```ts
export const NormalizedResponseSchema = Schema.Struct({
  text: Schema.String,
  toolCalls: Schema.Array(ToolCallSchema),
  usage: Schema.optional(TokenUsageSchema),
  finishReason: Schema.optional(Schema.String),
  resolvedModel: Schema.optional(Schema.String),
});
```

`DoneChunkSchema`:

```ts
export const DoneChunkSchema = Schema.Struct({
  type: Schema.Literal("done"),
  resolvedModel: Schema.optional(Schema.String),
});
```

### `src/run/helpers.ts` — `streamToResponse`

Add state:

```ts
  let resolvedModel: string | undefined;
```

In the chunk loop, next to the `usage` line:

```ts
      if (chunk.type === "done" && chunk.resolvedModel) resolvedModel = chunk.resolvedModel;
```

Success return:

```ts
    return { text, toolCalls, usage, resolvedModel };
```

Fail-soft fallback return:

```ts
    const resp = await provider.complete(request);
    return { text: text + (resp.text ?? ""), toolCalls, usage: usage ?? resp.usage, resolvedModel: resolvedModel ?? resp.resolvedModel };
```

## Step 4 — Test

```bash
pnpm vitest run tests/providers/resolved-model.vitest.ts --config vitest.config.mts
```

Expected: PASS (4 tests).

## Step 5 — Typecheck/build

```bash
pnpm typecheck && pnpm build
```

Expected: clean.

---

# Task 2: OpenRouter free-model catalog

## Files

Create:

```text
src/providers/free-model-catalog.ts
```

Test:

```text
tests/providers/free-model-catalog.vitest.ts
```

## Free semantics

A model is free when:

```ts
pricing.prompt === "0"
&&
pricing.request === "0"
```

This deliberately matches the intended `openrouter/free` semantics.

Do not infer free status merely from:

```text
pricing.completion === "0"
```

---

## `FreeModelInfo`

Define:

```ts
export type FreeModelInfo = {
  id: string;
  name: string;
  inputTokenLimit: number | undefined;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  supportsVision: boolean;
};
```

### Important correction

Do **not** silently turn missing `context_length` into `200_000`.

Unknown metadata must remain distinguishable from a verified 200k context.

For example:

```ts
inputTokenLimit:
  typeof m.context_length === "number"
    ? m.context_length
    : undefined
```

The resolver then explicitly decides how unknown context limits are treated.

---

## Catalog fetch

Endpoint:

```text
https://openrouter.ai/api/v1/models
```

Headers:

```text
Authorization: Bearer $OPENROUTER_API_KEY
```

Optional:

```text
HTTP-Referer
X-Title
```

Filter only free models.

---

## Cache

Cache the **catalog**, not the selected model.

Target:

```text
TTL = 1 hour
```

Testing seams:

```ts
_setCatalogFetchForTesting(...)
_resetCatalogCacheForTesting()
```

### Cache failure policy

The plan should explicitly define:

* if no cache exists and fetch fails → propagate the catalog failure;
* if a non-expired cache exists → use it;
* stale-cache-on-error is optional and should not be introduced without a deliberate policy.

Do not silently use stale data indefinitely.

---

# Task 3: Pure capability-aware free-model resolver

## File

Create:

```text
src/providers/free-model-resolver.ts
```

## Interface

```ts
export type FreeModelRequirements = {
  needsTools: boolean;
  needsStructuredOutput: boolean;
  needsVision: boolean;
  maxInputTokens?: number;
};
```

```ts
export function resolveConcreteFreeModel(
  catalog: FreeModelInfo[],
  requirements: FreeModelRequirements,
): FreeModelInfo | undefined;
```

## Eligibility

A candidate must satisfy:

```text
tools requirement
structured-output requirement
vision requirement
context requirement when known
```

For context:

```ts
if (
  requirements.maxInputTokens !== undefined &&
  (
    model.inputTokenLimit === undefined ||
    model.inputTokenLimit < requirements.maxInputTokens
  )
) {
  reject;
}
```

The plan must explicitly choose this conservative interpretation:

> unknown context capacity is not eligible when a concrete context requirement exists.

---

## Deterministic selection

Sort by:

1. largest verified input context
2. lexical model ID tie-break

Example:

```ts
eligible.sort(
  (a, b) =>
    (b.inputTokenLimit ?? -1) - (a.inputTokenLimit ?? -1)
    || a.id.localeCompare(b.id),
);
```

This guarantees stable selection even if OpenRouter changes catalog ordering.

---

## Tests

Required:

```text
free model with tools → eligible
free model without tools → rejected
structured-output requirement → filtering
vision requirement → filtering
context requirement → filtering
unknown context + required context → rejected
largest eligible context → preferred
equal context → deterministic ID ordering
no eligible model → undefined
```

Also test multiple sequential requests against the same catalog:

```text
request A → model A
request B → model B
```

This becomes an explicit regression against the old global-concrete-cache defect.

---

## Shared request requirements + capability check

`deriveRequestRequirements` (used by Task 4 for the free route) and `supportsRequest` (used by Task 5 for all routing candidates) MUST live in this module so the free route and the routing layer share ONE capability vocabulary. They are a required deliverable of this task.

### Interface

Both helpers reuse the `FreeModelRequirements` type already defined above in this task — one capability vocabulary across the free route and the routing layer:

```ts
export function deriveRequestRequirements(
  request: NormalizedRequest,
  maxInputTokens?: number,
): FreeModelRequirements;

export function supportsRequest(
  capabilities: ModelCapabilities,
  requirements: FreeModelRequirements,
): boolean;
```

### Implementation

Derive from the EXISTING normalized request vocabulary — no second capability vocabulary:

```ts
export function deriveRequestRequirements(
  request: NormalizedRequest,
  maxInputTokens?: number,
): FreeModelRequirements {
  return {
    needsTools: !!(request.tools && request.tools.length > 0),
    needsStructuredOutput: request.structuredOutputSchema !== undefined,
    needsVision: Array.isArray(request.messages) && request.messages.some((m) =>
      Array.isArray(m.content) && m.content.some((c) => c.type === "image" || c.type === "file")),
    ...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
  };
}

export function supportsRequest(
  capabilities: ModelCapabilities,
  requirements: FreeModelRequirements,
): boolean {
  if (requirements.needsTools && !capabilities.supportsTools) return false;
  if (requirements.needsStructuredOutput && !capabilities.supportsStructuredOutput) return false;
  if (requirements.needsVision && !capabilities.supportsVision) return false;
  if (requirements.maxInputTokens !== undefined && capabilities.inputTokenLimit < requirements.maxInputTokens) return false;
  return true;
}
```

`ModelCapabilities.inputTokenLimit` is `number` (never undefined) — unknown-context handling exists only where it can occur, in the free-model resolver (`FreeModelInfo.inputTokenLimit: number | undefined`), enforced by the conservative rule above and its "unknown context + required context → rejected" test.

### Tests (append to `tests/providers/free-model-resolver.vitest.ts`)

```ts
const caps = { provider: "x", model: "m", inputTokenLimit: 32_000, outputTokenLimit: 4096, supportsTools: true, supportsStreaming: true, supportsStructuredOutput: false, supportsVision: true };

it("deriveRequestRequirements reads the existing request vocabulary", () => {
  expect(deriveRequestRequirements({ systemPrompt: "s", messages: [{ role: "user", content: "hi" }] })).toEqual({ needsTools: false, needsStructuredOutput: false, needsVision: false });
  expect(deriveRequestRequirements({ systemPrompt: "s", messages: [{ role: "user", content: "hi" }], tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }] }).needsTools).toBe(true);
  expect(deriveRequestRequirements({ systemPrompt: "s", messages: [{ role: "user", content: "hi" }], structuredOutputSchema: { name: "o", properties: {} } }).needsStructuredOutput).toBe(true);
  expect(deriveRequestRequirements({ systemPrompt: "s", messages: [{ role: "user", content: [{ type: "image", source: "data:x" }] }] }).needsVision).toBe(true);
  expect(deriveRequestRequirements({ systemPrompt: "s", messages: [{ role: "user", content: "hi" }] }, 64_000).maxInputTokens).toBe(64_000);
});

it("supportsRequest filters on capabilities", () => {
  expect(supportsRequest(caps, { needsTools: true, needsStructuredOutput: false, needsVision: false })).toBe(true);
  expect(supportsRequest(caps, { needsTools: true, needsStructuredOutput: true, needsVision: false })).toBe(false);
  expect(supportsRequest(caps, { needsTools: false, needsStructuredOutput: false, needsVision: true })).toBe(true);
  expect(supportsRequest({ ...caps, supportsVision: false }, { needsTools: false, needsStructuredOutput: false, needsVision: true })).toBe(false);
  expect(supportsRequest(caps, { needsTools: false, needsStructuredOutput: false, needsVision: false, maxInputTokens: 40_000 })).toBe(false);
  expect(supportsRequest(caps, { needsTools: false, needsStructuredOutput: false, needsVision: false, maxInputTokens: 32_000 })).toBe(true);
  expect(supportsRequest({ ...caps, inputTokenLimit: 8_000 }, { needsTools: false, needsStructuredOutput: false, needsVision: false, maxInputTokens: 16_000 })).toBe(false);
});
```

---

# Task 4: OpenRouter `openrouter/free` route

## File

Modify:

```text
src/providers/openrouter-provider.ts
```

Test:

```text
tests/providers/openrouter-free-route.vitest.ts
```

## Critical rule

The provider may cache:

```text
catalog
```

It must **not** cache:

```text
resolved concrete model
```

Therefore:

```ts
import { fetchFreeModelCatalog } from "./free-model-catalog.js";
import { resolveConcreteFreeModel, deriveRequestRequirements } from "./free-model-resolver.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export const FREE_ROUTE_MODEL = "openrouter/free";

function isFreeRoute(model: string): boolean {
  return model === FREE_ROUTE_MODEL || model.endsWith(":free");
}

async function resolveConcreteModel(request: NormalizedRequest): Promise<string> {
  const catalog = await fetchFreeModelCatalog();
  const resolved = resolveConcreteFreeModel(catalog, deriveRequestRequirements(request));
  if (!resolved) {
    throw new Error("No OpenRouter free model satisfies the request requirements");
  }
  return resolved.id;
}
```

No `cachedConcrete` holder exists anywhere — the catalog caches, the selection never does. `complete` and `stream` resolve per request:

```ts
  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    const model = isFreeRoute(this._model) ? await resolveConcreteModel(request) : this._model;
    return complete("openrouter", model, request, { apiKey: this._apiKey });
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    const model = isFreeRoute(this._model) ? await resolveConcreteModel(request) : this._model;
    yield* stream("openrouter", model, request, { apiKey: this._apiKey });
  }
```

Every request gets a fresh capability resolution.

---

## Deriving requirements

The repository ALREADY exposes everything required on `NormalizedRequest` (verified):

```text
tools                        → request.tools?.length > 0
structured output            → request.structuredOutputSchema !== undefined
vision                       → request.messages[].content part type "image" | "file"
input-token requirement      → not derivable from the request; passed explicitly by callers (config maxContextTokens / context budget) via deriveRequestRequirements(request, maxInputTokens)
```

Use `deriveRequestRequirements(request)` from Task 3. Do NOT invent a second request-capability vocabulary. If a future caller needs a concrete input-token requirement, it passes `maxInputTokens` explicitly — the resolver then applies the Task 3 conservative rule (unknown context capacity is rejected when a concrete requirement exists).

---

## Tests

At minimum:

```text
openrouter/free resolves to concrete model
request requiring vision selects vision model
request requiring tools rejects tool-less models
request requiring large context rejects undersized models
no eligible model produces clear error
two sequential incompatible requests resolve independently
```

---

# Task 5: Capability-aware routing adapter

## Files

Create:

```text
src/providers/routing-adapter.ts
```

Test:

```text
tests/providers/routing-adapter.vitest.ts
```

## Types

```ts
export type RoutingCandidate = {
  key: string;
  label: string;
  adapter: ModelAdapter;
};
```

Do not add redundant capability metadata if it already exists on `adapter.capabilities`.

---

# Candidate ordering

Order is:

```text
1. primary
2. OpenRouter free fallback, if enabled
3. explicit configured fallbacks
```

This preserves user-configured priority.

---

# Candidate eligibility

Before invoking a candidate:

```ts
supportsRequest(
  candidate.adapter.capabilities,
  deriveRequestRequirements(request),
)
```

must be evaluated.

Vacuity note: for `openrouter/*` candidates the registry-provider capabilities are static/optimistic (all booleans true, input limit from the model spec), so this check never over-rejects an openrouter candidate — the real per-request filter is the free-route resolution inside `OpenRouterProvider`. It does real filtering for concrete-model candidates (anthropic, local-llama, ...) whose capabilities reflect actual model specs. Safe in both roles.

If incompatible:

```text
skip candidate
```

Do not invoke it.

This applies equally to:

* primary
* free route
* explicit fallback

---

# Retryable errors

Only:

```ts
const RETRYABLE_STATUS = new Set([
  429,
  500,
  502,
  503,
  504,
]);
```

Non-retryable errors immediately propagate.

---

# Complete behavior

Runnable implementation of the whole adapter (complete + stream + breaker). No `cooldowns` map — the breaker owns suppression (INV-6).

```ts
import { ApiError } from "./base.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { supportsRequest, deriveRequestRequirements } from "./free-model-resolver.js";
import type { ModelAdapter, ModelCapabilities, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type RoutingCandidate = {
  key: string;
  label: string;
  adapter: ModelAdapter;
};

export type RoutingOptions = {
  breakerFailureThreshold?: number;
  breakerCooldownMs?: number;
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_BREAKER = { failureThreshold: 2, cooldownMs: 60_000 };

function isRetryable(err: unknown): boolean {
  return err instanceof ApiError && RETRYABLE_STATUS.has(err.status);
}

export class RoutingModelAdapter implements ModelAdapter {
  /** Marker consumed by streamToResponse to suppress its fail-soft re-run for routed providers. */
  readonly isRoutingAdapter = true;

  id: string;
  editFormatPreference: ModelAdapter["editFormatPreference"];
  longContextStrategy: ModelAdapter["longContextStrategy"];

  private candidates: RoutingCandidate[];
  private breakers = new Map<string, CircuitBreaker>();
  private breakerOpts: Required<RoutingOptions>;

  constructor(candidates: RoutingCandidate[], opts: RoutingOptions = {}) {
    if (candidates.length === 0) throw new Error("RoutingModelAdapter requires at least one candidate");
    this.candidates = candidates;
    this.breakerOpts = {
      breakerFailureThreshold: opts.breakerFailureThreshold ?? DEFAULT_BREAKER.failureThreshold,
      breakerCooldownMs: opts.breakerCooldownMs ?? DEFAULT_BREAKER.cooldownMs,
    };
    const primary = candidates[0]!.adapter;
    this.id = primary.id;
    this.editFormatPreference = primary.editFormatPreference;
    this.longContextStrategy = primary.longContextStrategy;
  }

  get capabilities(): ModelCapabilities {
    return this.candidates[0]!.adapter.capabilities;
  }

  private breaker(key: string): CircuitBreaker {
    let b = this.breakers.get(key);
    if (!b) {
      b = new CircuitBreaker({ failureThreshold: this.breakerOpts.breakerFailureThreshold, cooldownMs: this.breakerOpts.breakerCooldownMs });
      this.breakers.set(key, b);
    }
    return b;
  }

  private isEligible(candidate: RoutingCandidate, request: NormalizedRequest): boolean {
    // For `openrouter/*` candidates, provider-static capabilities are
    // optimistic (all true) — the real per-request filter is the free-route
    // resolution inside OpenRouterProvider. supportsRequest therefore never
    // over-rejects an openrouter candidate; it filters concrete-model
    // candidates (anthropic, local-llama, ...) whose capabilities are real.
    return supportsRequest(candidate.adapter.capabilities, deriveRequestRequirements(request));
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    let lastErr: unknown;
    for (const candidate of this.candidates) {
      if (!this.isEligible(candidate, request)) continue;
      const breaker = this.breaker(candidate.key);
      if (!breaker.shouldAttempt()) { lastErr = new Error("Circuit breaker is open — provider unavailable"); continue; }
      try {
        const response = await candidate.adapter.complete(request);
        breaker.onSuccess();
        if (!response.resolvedModel) response.resolvedModel = candidate.label;
        return response;
      } catch (err) {
        lastErr = err;
        if (isRetryable(err)) { breaker.onFailure(); continue; }
        // Non-retryable errors never accumulate toward opening the circuit (INV-6).
        breaker.reset();
        throw err;
      }
    }
    throw lastErr ?? new Error("All routing candidates failed");
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    let lastErr: unknown;
    for (const candidate of this.candidates) {
      if (!this.isEligible(candidate, request)) continue;
      if (!candidate.adapter.stream) { lastErr = new Error(`Candidate ${candidate.key} does not support streaming`); continue; }
      const breaker = this.breaker(candidate.key);
      if (!breaker.shouldAttempt()) { lastErr = new Error("Circuit breaker is open — provider unavailable"); continue; }
      let committed = false;
      try {
        const generator = candidate.adapter.stream(request);
        for await (const chunk of generator) {
          if (!committed) {
            if (chunk.type === "error") throw new Error(chunk.error);
            if (chunk.type === "text_delta" || chunk.type === "tool_call") committed = true;
          }
          if (chunk.type === "done" && !chunk.resolvedModel) {
            yield { type: "done", resolvedModel: candidate.label };
            continue;
          }
          yield chunk;
        }
        breaker.onSuccess();
        return;
      } catch (err) {
        lastErr = err;
        // Pre-commit: a retryable error may fall back. Post-commit: committed
        // chunks are already forwarded (INV-5) — the error propagates, never
        // continues, so the caller never concatenates candidate output.
        if (!committed && isRetryable(err)) { breaker.onFailure(); continue; }
        if (!committed) breaker.reset();
        throw err;
      }
    }
    if (lastErr) throw lastErr;
  }
}
```

Streaming commitment notes (INV-5, Task 6):

* `text_delta` and `tool_call` are the ONLY commitment markers — they are forwarded to the caller and cannot be unsent.
* A first-chunk `error` throws before commitment → the catch retries the next candidate.
* Any error after commitment rethrows (falls out of the loop) → the caller sees it, and `streamToResponse` must NOT fail-soft (see Task 6 Step 3).
* `breaker.onSuccess()`/`onFailure()`/`reset()` run identically for complete and stream, so breaker accounting is consistent across both paths (Task 7).

`resolvedModel` must represent the actual selected candidate/provider result.

### Required tests (`tests/providers/routing-adapter.vitest.ts`)

Use fake adapters whose `complete`/`stream` throw `new ApiError(status, ...)` (imported from `src/providers/base.js`) or return canned responses:

```text
primary succeeds → its response returned
primary 429 → fallback response returned, resolvedModel = fallback label
primary 500/502/503/504 → fallback
primary 400/401/403/404 → error propagates (no fallback, breaker not tripped)
all candidates fail → "All routing candidates failed" thrown
capability-incompatible candidate (supportsVision=false + vision request) → skipped, never invoked
retryable failures trip breaker at threshold (2); open candidate skipped via shouldAttempt()
cooldownMs elapses → shouldAttempt() returns true (half-open probe); success closes the circuit
non-retryable error calls reset(), never accumulates toward open
complete and stream share one breaker per candidate (consistent accounting)
```

---

# Task 6: Streaming routing

This task must be treated separately from `complete()`.

## Required state

```ts
let committed = false;
```

A semantic output chunk marks commitment.

For example:

```text
text_delta
tool_call
```

should commit the stream.

Pure internal bookkeeping/error state does not.

---

## Before commitment

If the candidate fails with a retryable error:

```text
candidate A fails
      ↓
candidate B starts
```

No output from A has been emitted.

---

## After commitment

If candidate A has already yielded output:

```text
candidate A:
  text_delta("hello")
  network error

DO NOT:
  candidate B
```

Instead:

```text
propagate A's error
```

This is mandatory.

---

## Required tests

### Safe fallback

```ts
it("falls back when stream fails before any committed chunk")
```

### Unsafe fallback

```ts
it("does not fall back after text has been emitted")
```

### Tool commitment

```ts
it("does not fall back after tool-call output has been emitted")
```

### Normal stream

```ts
it("forwards committed chunks verbatim")
```

### Resolved model

```ts
it("returns fallback resolvedModel when fallback stream succeeds")
```

---

## Step 3 — Make INV-5 hold end-to-end: suppress the streamToResponse fail-soft for routed providers

`streamToResponse` (`src/run/helpers.ts:331-337`) currently catches ANY mid-stream error and re-runs `provider.complete(request)`. For a routing adapter that would re-run the whole chain and concatenate candidate-A text with a fresh response — violating INV-5. Add a guard so the fail-soft applies only to non-routing providers:

```ts
  } catch (err) {
    // Routing adapters already made their fallback decision (INV-5); their
    // post-commit failure is final — do not re-run the chain and concatenate.
    if ((provider as { isRoutingAdapter?: boolean }).isRoutingAdapter) throw err;
    const resp = await provider.complete(request);
    return { text: text + (resp.text ?? ""), toolCalls, usage: usage ?? resp.usage, resolvedModel: resolvedModel ?? resp.resolvedModel };
  }
```

Test (`tests/providers/routing-adapter.vitest.ts`): a routed provider whose stream yields `text_delta` then a mid-stream `error` chunk must REJECT from `streamToResponse` (not concatenate). Use a `RoutingModelAdapter` with a single candidate whose stream emits `text_delta` then `error`; assert `await expect(streamToResponse(router, req)).rejects.toThrow()`.

---

# Task 7: Circuit-breaker integration

The Task 5 implementation already satisfies INV-6: there is NO router-local `cooldowns: Map<string, number>` — the adapter delegates suppression to the existing `CircuitBreaker` (`src/providers/circuit-breaker.ts`). Do not reintroduce a parallel state machine.

Additive change (Task 5 code depends on it; preserves the existing `call()`/`onSuccess`/`onFailure`/`reset` API unchanged):

```ts
/**
 * Request entry check. Fast-fails while open and still cooling down;
 * transitions open → half-open (probe) once cooldownMs elapses.
 */
shouldAttempt(): boolean {
  if (this.state === "open") {
    if (Date.now() - this.lastFailureTime > this.opts.cooldownMs) {
      this.state = "half-open";
    } else {
      return false;
    }
  }
  return true;
}
```

Why not `call()`: `call()` counts EVERY thrown error toward opening the circuit, but the router only counts retryable statuses (429/500/502/503/504) — a 400 must not trip the breaker. `call()` is also awkward for streaming (it expects a thunk; the routing adapter drives its own async iteration). `shouldAttempt()` gives the router the fast-fail + probe semantics while all state and transitions stay inside the breaker.

The router obtains availability via `breaker.shouldAttempt()`, then reports the outcome via `onSuccess()`/`onFailure()`/`reset()` exactly as shown in the Task 5 implementation. Breaker accounting is identical across complete and stream (both call the same three methods).

Conceptually:

```text
RoutingModelAdapter
       │
       ├── candidate eligibility
       │
       ├── candidate ordering
       │
       └── CircuitBreaker
             │
             ├── closed
             ├── open
             └── recovery
```

## Tests

Required:

```text
retryable failure increments breaker
threshold opens breaker
open candidate is skipped
recovery permits candidate again
successful call resets/recovers breaker according to existing semantics
```

Streaming and complete must have consistent breaker accounting.

---

# Task 8: Configuration

## File

Modify:

```text
src/config/schema.ts
```

## Configuration

```ts
routing?: {
  freeFallback?: boolean;
  fallbacks?: Array<{
    provider: string;
    name: string;
  }>;
};
```

Example:

```json
{
  "models": {
    "default": {
      "provider": "openrouter",
      "name": "openai/gpt-4o",
      "routing": {
        "freeFallback": true,
        "fallbacks": [
          {
            "provider": "anthropic",
            "name": "claude..."
          }
        ]
      }
    }
  }
}
```

---

# Task 9: Composition root

## File

Modify:

```text
src/agent/agent.ts
```

## `buildRoutingAdapter`

Lives in `src/providers/routing-adapter.ts`. Signature:

```ts
export async function buildRoutingAdapter(
  model: ModelConfig,
  apiKeyFor: (providerId: string) => string,
): Promise<ModelAdapter>
```

Behavior:

```text
no routing
    ↓
return createProvider(...)
    ↓ (identical to today's adapter, no wrapper)

routing configured
    ↓
construct candidates: primary → openrouter/free (if freeFallback) → explicit fallbacks
    ↓
return new RoutingModelAdapter(candidates)
```

Implementation:

```ts
import { createProvider } from "./registry.js";
import { RoutingModelAdapter, type RoutingCandidate } from "./routing-adapter.js";
import type { ModelConfig } from "../config/schema.js";

export async function buildRoutingAdapter(
  model: ModelConfig,
  apiKeyFor: (providerId: string) => string,
): Promise<ModelAdapter> {
  const routing = model.routing;
  const fallbackModels: ModelConfig[] = [];
  if (routing?.freeFallback && model.provider === "openrouter") {
    fallbackModels.push({ provider: "openrouter", name: "openrouter/free" });
  }
  if (routing?.fallbacks) fallbackModels.push(...routing.fallbacks);

  if (fallbackModels.length === 0) {
    return createProvider({ provider: model.provider, model: model.name }, apiKeyFor(model.provider));
  }

  const candidates: RoutingCandidate[] = [
    {
      key: `${model.provider}/${model.name}`,
      label: `${model.provider}/${model.name}`,
      adapter: await createProvider({ provider: model.provider, model: model.name }, apiKeyFor(model.provider)),
    },
  ];
  for (const fb of fallbackModels) {
    candidates.push({
      key: `${fb.provider}/${fb.name}`,
      label: `${fb.provider}/${fb.name}`,
      adapter: await createProvider({ provider: fb.provider, model: fb.name }, apiKeyFor(fb.provider)),
    });
  }
  return new RoutingModelAdapter(candidates);
}
```

The no-routing case returns exactly what `createProvider(...)` returns today — verified identical adapter instance through the existing registry cache (no wrapper, no new retry semantics).

## Agent wiring

Replace `src/agent/agent.ts:116-123` with:

```ts
  const model = resolveModelConfig(config);
  const apiKeyFor = (pid: string): string =>
    config.apiKeys?.[pid] ?? process.env[`${pid.toUpperCase()}_API_KEY`] ?? "";
  const provider = await buildRoutingAdapter(model, apiKeyFor);
  const editFormatPolicy = buildEditFormatPolicy({ provider: model.provider, preferred: provider.editFormatPreference });
```

Add the import (next to the existing `createProvider` import):

```ts
import { buildRoutingAdapter } from "../providers/routing-adapter.js";
```

Remove the now-unused `createProvider` import from `src/agent/agent.ts` (verify no other use: `rg "createProvider" src/agent/agent.ts` — the replaced block is the only one). `modelProvider`/`modelName` local names disappear with the block; later uses at `agent.ts:124` (edit format policy) and `:181` now read `model.provider` / `model.name` from the resolved `model`.

Tests: `tests/config/routing-config.vitest.ts` — `buildRoutingAdapter` with `{ provider: "mock", name: "mock-model" }` (no routing) must NOT be an instance of `RoutingModelAdapter` and must have `id === "mock"` (offline-safe; `MockProvider` is network-free); with `{ provider: "openrouter", name: "openai/gpt-4o", routing: { freeFallback: true } }` must BE a `RoutingModelAdapter`.

---

# Task 10: Resolved-model telemetry

## Files

```text
src/agent/messages.ts
src/run/task-loop.ts
```

## Usage payload

Add:

```ts
resolvedModel?: string;
```

to `model.usage`.

Existing payloads without the field remain valid.

### Exact call sites

`src/agent/messages.ts:50-52` — the payload builder (source of truth; note `task-loop` imports it via the `../run.js` re-export, so only messages.ts is edited here):

```ts
export function buildModelUsageEventPayload(provider: string, model: string, usage: { inputTokens: number; outputTokens: number }, resolvedModel?: string) {
  return {
    provider,
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...(resolvedModel ? { resolvedModel } : {}),
  };
}
```

`src/run/task-loop.ts` — thread the resolved model from both call paths:

* declare state next to `usage` (line ~746): `let resolvedModel: string | undefined;`
* streaming branch (line ~760, after `usage = result.usage;`): `resolvedModel = result.resolvedModel;`
* non-streaming branch (line ~773, after `usage = resp.usage;`): `resolvedModel = resp.resolvedModel;`
* `model.usage` emission (line ~819): `buildModelUsageEventPayload(model.provider, model.name, usage, resolvedModel)`

## Metrics

Add:

```text
resolved_model
```

as the metric label on the existing `m09.metric` `model_calls_total` counter emission (line ~815):

```ts
await log.append({
  ...session, actor: "system", type: "m09.metric",
  payload: { name: "model_calls_total", type: "counter", value: 1, labels: { provider: model.provider, ...(resolvedModel ? { resolved_model: resolvedModel } : {}) }, timestamp: new Date().toISOString() },
});
```

Decision (explicit): `TOKEN_CALIBRATION` (line ~822) keeps `model: model.name` — it measures context estimation vs the requested model, not resolution; do NOT add `resolvedModel` there.

Example:

```text
requested:
openrouter/free

resolved:
qwen/qwen3-14b:free
```

This gives observability into actual model usage without changing the existing event type.

---

# Task 11: CLI

## Files

Create:

```text
src/models/routing-cli.ts
```

Modify:

```text
src/cli/commands/models.ts
```

Commands:

```text
alix models free
alix models routing
```

---

## `models free`

Display:

```text
OpenRouter Free Models

qwen/qwen3-14b:free        32k [tools,structured]
...

N free models.
```

Support:

```text
--json
```

Unknown `context_length` renders `"?"` — never `NaN` (the field is `number | undefined`):

```ts
const ctx = m.inputTokenLimit ? `${(m.inputTokenLimit / 1000).toFixed(0)}k` : "?";
```

If the catalog is empty (no key / offline / zero free models):

```text
No OpenRouter free models available. Set OPENROUTER_API_KEY and retry.
```

---

# `models routing`

Important terminology correction:

The command should describe the **configured/logical routing chain**, not claim to know the request-specific effective concrete free model.

Example:

```text
Configured Routing Chain

primary   openrouter/openai/gpt-4o
fallback  openrouter/openrouter/free
fallback  anthropic/...
```

If no routing exists:

```text
No fallbacks configured.
```

### Unconfigured-model error path

`describeRoutingChain` → `resolveModelConfig` throws `NO_MODEL_CONFIGURED_MESSAGE` when no `models.default` exists (`src/config/model-resolver.ts:56`). The handler loads with `requireModel: false`, so it MUST catch and degrade gracefully — never a stack trace:

```ts
export async function handleModelsRouting(args: string[]): Promise<void> {
  const { loadConfig } = await import("../../config/loader.js");
  const { describeRoutingChain } = await import("../../models/routing-cli.js");
  const { NO_MODEL_CONFIGURED_MESSAGE } = await import("../../config/model-resolver.js");
  const config = await loadConfig(process.cwd(), { requireModel: false });
  let chain: Array<{ provider: string; model: string; role: string }>;
  try {
    chain = describeRoutingChain(config);
  } catch (err) {
    if (err instanceof Error && err.message === NO_MODEL_CONFIGURED_MESSAGE) {
      console.log(`\n${NO_MODEL_CONFIGURED_MESSAGE}`);
      process.exit(1);
    }
    throw err;
  }
  if (args.includes("--json")) { console.log(JSON.stringify(chain, null, 2)); return; }
  console.log("\nConfigured Routing Chain\n");
  for (const c of chain) console.log(`  ${c.role.padEnd(9)} ${c.provider}/${c.model}`);
  if (chain.length === 1) {
    console.log("\nNo fallbacks configured. Add under models.default in config:");
    console.log('  "routing": { "freeFallback": true }    # OpenRouter free-tier fallback');
    console.log('  "routing": { "fallbacks": [...] }      # explicit ordered candidates');
  }
}
```

---

# Task 12: CLI tests

Tests:

```text
models free parses catalog
models free renders unknown context as "?"
models routing lists primary
models routing lists free fallback
models routing lists explicit fallbacks
models routing without routing lists only primary
models routing with no models.default exits gracefully (NO_MODEL_CONFIGURED_MESSAGE, no throw)
--json produces valid JSON
```

The existing expected structure remains:

```ts
[
  {
    provider: "openrouter",
    model: "openai/gpt-4o",
    role: "primary",
  },
  {
    provider: "openrouter",
    model: "openrouter/free",
    role: "fallback",
  },
]
```

---

# Task 13: Regression tests for existing behavior

Before declaring the work complete, explicitly verify:

```text
tests/providers/unified-complete.test.ts
tests/providers/provider-contract-validation.test.ts
tests/executive/executive-snapshot-provider.vitest.ts
tests/agent/messages.test.ts
tests/agent/stream.test.ts
tests/agent/session-*.test.ts
```

Note: `tests/agent/agent.test.ts` does NOT exist — the real agent-layer suites are `messages.test.ts`, `stream.test.ts`, and the `session-*` files listed above. Do not hunt for the former.

and any TUI suites consuming:

```text
model.usage
```

The `resolvedModel` field is additive, so existing consumers should continue passing unchanged.

---

# Task 14: Full acceptance suite

Run:

```bash
pnpm typecheck
```

then:

```bash
pnpm build
```

then:

```bash
pnpm test:vitest
```

then:

```bash
pnpm test:node
```

---

# 15. Mandatory adversarial acceptance matrix

This is added to the previous plan specifically because the architectural review identified gaps that ordinary happy-path tests would miss.

## Free model selection

| Scenario                                    | Expected                         |
| ------------------------------------------- | -------------------------------- |
| tools required                              | tool-capable model               |
| tools not supported                         | candidate rejected               |
| structured output required                  | structured-capable model         |
| vision required                             | vision-capable model             |
| insufficient context                        | candidate rejected               |
| unknown context + required context          | candidate rejected               |
| no eligible model                           | explicit resolution failure      |
| equal context sizes                         | deterministic model ID selection |
| request A and B have different requirements | independent resolution           |

---

## Complete routing

| Primary                 | Expected         |
| ----------------------- | ---------------- |
| 200                     | primary response |
| 429                     | fallback         |
| 500                     | fallback         |
| 502                     | fallback         |
| 503                     | fallback         |
| 504                     | fallback         |
| 400                     | propagate        |
| 401                     | propagate        |
| 403                     | propagate        |
| incompatible capability | skip candidate   |

---

## Streaming routing

| Event                          | Expected                          |
| ------------------------------ | --------------------------------- |
| connection fails before output | fallback                          |
| 429 before output              | fallback                          |
| 503 before output              | fallback                          |
| text emitted then failure      | **no fallback**                   |
| tool call emitted then failure | **no fallback**                   |
| normal completion              | success                           |
| fallback succeeds              | fallback `resolvedModel` surfaced |

---

## Circuit behavior

| State               | Expected                         |
| ------------------- | -------------------------------- |
| healthy             | candidate used                   |
| retryable failure   | breaker records failure          |
| breaker opens       | candidate skipped                |
| alternate succeeds  | request succeeds                 |
| recovery            | candidate eventually retried     |
| successful recovery | breaker returns to healthy state |

---

# 16. Required observability acceptance

A successful request should allow telemetry to distinguish:

```text
requested model:
    openrouter/free

resolved model:
    qwen/qwen3-14b:free
```

A fallback should distinguish:

```text
requested primary:
    openai/gpt-4o

resolved:
    qwen/qwen3-14b:free
```

The `resolved_model` metric label and `model.usage.resolvedModel` event field must agree.

---

# 17. Manual smoke tests

After build:

```bash
node dist/src/cli.js models routing --json
```

Expected:

```text
configured primary + configured fallback chain
```

Then:

```bash
node dist/src/cli.js models routing
```

Expected human-readable routing information.

Then:

```bash
node dist/src/cli.js models free
```

Expected current OpenRouter free catalog when:

```text
OPENROUTER_API_KEY
```

is available.

---

# 18. Implementation checkpoints

An agent must stop and surface a blocker rather than making an architectural assumption if any of these occur:

### Checkpoint A

The existing request type cannot expose the information required to determine:

```text
tools
structured output
vision
context requirement
```

### Checkpoint B

The existing `CircuitBreaker` cannot represent the required routing semantics without introducing a second state machine.

### Checkpoint C

Streaming code cannot reliably distinguish:

```text
pre-commit failure
```

from:

```text
post-commit failure
```

### Checkpoint D

Existing provider capability metadata is insufficient to determine whether a candidate can serve the request.

### Checkpoint E

The existing provider registry makes it impossible to construct explicit fallback adapters without changing the default path.

**Do not silently invent a new abstraction to work around any of these. Stop and surface the conflict.**

---

# 19. Commit structure

Recommended commits:

```text
feat(providers): capture resolved model from provider responses
```

```text
feat(providers): add OpenRouter free model catalog
```

```text
feat(providers): resolve free models by request capabilities
```

```text
feat(providers): add capability-aware model routing
```

```text
feat(config): add model routing configuration
```

```text
feat(run): record resolved model in usage telemetry
```

```text
feat(cli): add models free and models routing commands
```

Then final verification commit only if repository conventions require one.

---

# 20. Final acceptance criteria

The implementation is complete only when all of the following are true:

* [ ] Existing no-routing execution path is behaviorally unchanged.
* [ ] OpenRouter free catalog is fetched from `/models`.
* [ ] Free semantics require both zero prompt and zero request pricing.
* [ ] Catalog is cached.
* [ ] Concrete free-model selection is **not globally cached**.
* [ ] Free selection is request/capability-aware.
* [ ] Unknown context metadata is not treated as verified large capacity.
* [ ] Selection is deterministic.
* [ ] Explicit fallback candidates are capability-filtered.
* [ ] Retryable HTTP errors fall through.
* [ ] Non-retryable errors propagate.
* [ ] Streaming can fall back before commitment.
* [ ] Streaming **cannot** fall back after committed output.
* [ ] `streamToResponse` fail-soft re-run is suppressed for routing adapters.
* [ ] Circuit-breaker state is not duplicated by a second cooldown machine.
* [ ] Breaker gains additive `shouldAttempt()`; `call`/`onSuccess`/`onFailure`/`reset` unchanged.
* [ ] Non-retryable errors (e.g. 400) never trip the breaker.
* [ ] `deriveRequestRequirements` + `supportsRequest` are exported from `free-model-resolver.ts` and unit-tested.
* [ ] `models routing` with no `models.default` exits gracefully (no stack trace).
* [ ] `resolvedModel` is captured from OpenRouter.
* [ ] `resolvedModel` survives complete and streaming paths.
* [ ] `model.usage.resolvedModel` is populated.
* [ ] `resolved_model` metric label is populated.
* [ ] `models free` works.
* [ ] `models routing` works.
* [ ] Existing provider/TUI/executive tests remain green.
* [ ] Full Vitest suite passes.
* [ ] Node tests pass.
* [ ] Typecheck passes.
* [ ] Build passes.

---

# Final assessment

This revised version is now much closer to an **executable implementation plan** rather than merely an architecture proposal.

The most important correction is the distinction between:

```text
CATALOG CACHE
    ↓
request-specific RESOLUTION
```

rather than caching the resolved model itself.

The second is the explicit streaming commitment invariant:

```text
              ┌── retry/fallback ──┐
              │                    │
provider ─────┤ pre-commit         │
              │                    ▼
              └ post-commit ──→ propagate
```

And the third is making **capability filtering a property of the routing layer itself**, rather than something special that happens only inside `openrouter/free`.

**Post-review patch (applied):** a plan-document reviewer plus an independent pass closed the remaining non-executable gaps — Task 1 and Task 5 now carry fully runnable code; Task 3 gains the shared `deriveRequestRequirements`/`supportsRequest` interface (INV-4's undefined prerequisites) with tests; Task 6 gains the `streamToResponse` fail-soft guard that makes INV-5 hold end-to-end; Task 7 delegates to the breaker via a new additive `shouldAttempt()` (no parallel cooldown map, non-retryable errors never trip the circuit) and points at the Task 5 implementation; Task 9 gains the `buildRoutingAdapter` signature and the exact `agent.ts:116-123` replacement; Task 10 names the precise call sites; Task 11 gains the unconfigured-model error path and the `?`-for-unknown-context display; Task 13 points at the real test suites.

With those changes, the design has a clean separation of concerns:

```text
Catalog
  ↓
Pure capability resolver
  ↓
Logical provider route
  ↓
Capability-aware routing
  ↓
Circuit protection
  ↓
Execution
  ↓
Resolved-model telemetry
```

**Recommendation: this is the version to hand to the implementation agent.**

