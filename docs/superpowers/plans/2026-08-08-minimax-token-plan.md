# MiniMax Token Plan Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `minimax-token-plan` provider entry to ALiX that authenticates against MiniMax's Token Plan (`api.minimax.io/anthropic`) using `sk-cp-...` keys, supports the `MiniMax-M3` model, and updates the `cloud-minimax.json` profile to use it.

**Architecture:** New provider entry (clean separation from the existing `minimax` provider). The new spec is a 3-line spread of `anthropicSpec` since the Token Plan is documented as Anthropic-compatible. The provider class mirrors `anthropic-provider.ts`. The `cloud-minimax.json` profile is updated to point at the new provider.

**Tech Stack:** TypeScript, Node.js, vitest (existing infrastructure). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-08-alix-minimax-token-plan-design.md` (already approved).

**Branch:** `feat/minimax-token-plan-provider` (already created). Spec is committed at `b61a3749`.

## Global Constraints

- **Provider id:** `minimax-token-plan` (kebab-case, matches the existing `minimax` provider's id style).
- **Env var:** `MINIMAX_TOKEN_PLAN_KEY`.
- **Catalog hint:** `sk-cp-...`.
- **Default model:** `MiniMax-M3`.
- **Base URL:** `https://api.minimax.io/anthropic` (reused from `anthropicSpec` via spread).
- **Auth header:** `x-api-key: <key>` + `anthropic-version: 2023-06-01` (inherited from `anthropicSpec`).
- **Capabilities:** `inputTokenLimit: 1_000_000`, `outputTokenLimit: 64_000`, `supportsTools: true`, `supportsStreaming: true`, `supportsStructuredOutput: true`, `supportsVision: true`.
- **Provider context window:** `1_048_576` tokens, `cl100k_base` tokenizer.
- **No changes to existing `minimax` provider.** Out of scope.
- **Existing 2 uncommitted edits** (`AGENTS.md`, `CLAUDE.md`) on the working tree are unrelated to this work — leave them untouched (don't commit, don't stash).

## File Structure

### New files

| File | Responsibility |
|------|----------------|
| `src/providers/specs/minimax-token-plan-spec.ts` | 5-line spec: spreads `anthropicSpec` with new baseUrl |
| `src/providers/minimax-token-plan-provider.ts` | ~45-line provider class |
| `tests/providers/minimax-token-plan.test.ts` | Capability + identity tests |

### Modified files

| File | Change |
|------|--------|
| `src/providers/catalog.ts` | 1 line in `PROVIDERS` array, 1 switch case in `listModels`, 1 line in `DEFAULT_MODELS` |
| `src/providers/unified-complete.ts` | 1 line in `SPECS` Map, 1 line in `PROVIDER_KEY_ENV` |
| `src/providers/registry.ts` | 1 line in `lazyProviders`, 1 line in `listProviders()` |
| `src/security/credentials/credential-migration.ts` | 1 line in `PROVIDER_ENV_MAP` |
| `src/config/context-limits.ts` | 1 line in the per-provider window table |
| `src/config/profiles/cloud-minimax.json` | 5 line changes (all model tiers) |
| `tests/manual/run-cli.ts` | 1 line in `PROVIDER_ENV_VARS` |
| `tests/providers/streaming-regression.test.ts` | 1 line in `STREAMING_SPECS` array |

---

## Task 1: Add the spec file

**Files:**
- Create: `src/providers/specs/minimax-token-plan-spec.ts`

**Interfaces:**
- Produces: `minimaxTokenPlanSpec: ProviderSpec` (consumed by Task 3 to add to `SPECS` Map)

- [ ] **Step 1: Create the spec file**

Write at `src/providers/specs/minimax-token-plan-spec.ts`:

```ts
import { anthropicSpec } from "./anthropic-spec.js";
import type { ProviderSpec } from "../spec-types.js";
export const minimaxTokenPlanSpec: ProviderSpec = {
  ...anthropicSpec,
  baseUrl: "https://api.minimax.io/anthropic",
};
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit 2>&1 | tail -10`
Expected: clean exit (no errors mentioning `minimax-token-plan-spec`).

- [ ] **Step 3: Verify the spec is identical to anthropicSpec except baseUrl**

Run: `node -e "import('./src/providers/specs/minimax-token-plan-spec.js').then(m => { console.log('baseUrl:', m.minimaxTokenPlanSpec.baseUrl); })"`
Expected: `baseUrl: https://api.minimax.io/anthropic`

(If you get a "module not found" error, run the project build first: `pnpm build`.)

- [ ] **Step 4: Commit**

```bash
git add src/providers/specs/minimax-token-plan-spec.ts
git commit -m "feat(minimax): add minimax-token-plan-spec (Anthropic-compatible spread)"
```

---

## Task 2: Add the provider class with capability test

**Files:**
- Create: `src/providers/minimax-token-plan-provider.ts`
- Create: `tests/providers/minimax-token-plan.test.ts`

**Interfaces:**
- Produces: `MiniMaxTokenPlanProvider` class (consumed by Task 4 in `registry.ts` `lazyProviders`)

- [ ] **Step 1: Write the failing test**

Create `tests/providers/minimax-token-plan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MiniMaxTokenPlanProvider } from "../../src/providers/minimax-token-plan-provider.js";

describe("MiniMaxTokenPlanProvider", () => {
  it("has id 'minimax-token-plan'", () => {
    const p = new MiniMaxTokenPlanProvider({ apiKey: "sk-cp-test" });
    expect(p.id).toBe("minimax-token-plan");
  });

  it("defaults model to 'MiniMax-M3'", () => {
    const p = new MiniMaxTokenPlanProvider({ apiKey: "sk-cp-test" });
    expect((p as any)._model).toBe("MiniMax-M3");
  });

  it("reads apiKey from env when not provided in config", () => {
    const saved = process.env.MINIMAX_TOKEN_PLAN_KEY;
    process.env.MINIMAX_TOKEN_PLAN_KEY = "sk-cp-from-env";
    try {
      const p = new MiniMaxTokenPlanProvider();
      expect((p as any)._apiKey).toBe("sk-cp-from-env");
    } finally {
      if (saved === undefined) delete process.env.MINIMAX_TOKEN_PLAN_KEY;
      else process.env.MINIMAX_TOKEN_PLAN_KEY = saved;
    }
  });

  it("returns configured capabilities", () => {
    const p = new MiniMaxTokenPlanProvider({ apiKey: "sk-cp-test" });
    expect(p.capabilities).toEqual({
      provider: "minimax-token-plan",
      model: "MiniMax-M3",
      inputTokenLimit: 1_000_000,
      outputTokenLimit: 64_000,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: true,
    });
  });

  it("uses structured_patch edit format and expanded_context long-context strategy", () => {
    const p = new MiniMaxTokenPlanProvider({ apiKey: "sk-cp-test" });
    expect(p.editFormatPreference).toBe("structured_patch");
    expect(p.longContextStrategy).toBe("expanded_context");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:vitest tests/providers/minimax-token-plan.test.ts 2>&1 | tail -20`
Expected: FAIL with "MiniMaxTokenPlanProvider module not found" or "Cannot find module".

- [ ] **Step 3: Write the implementation**

Create `src/providers/minimax-token-plan-provider.ts`:

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

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:vitest tests/providers/minimax-token-plan.test.ts 2>&1 | tail -10`
Expected: PASS with all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/providers/minimax-token-plan-provider.ts tests/providers/minimax-token-plan.test.ts
git commit -m "feat(minimax): add MiniMaxTokenPlanProvider (sk-cp- key, M3 model)"
```

---

## Task 3: Wire spec into unified-complete

**Files:**
- Modify: `src/providers/unified-complete.ts:18-32` (`SPECS` Map)
- Modify: `src/providers/unified-complete.ts:34-48` (`PROVIDER_KEY_ENV`)

**Interfaces:**
- Consumes: `minimaxTokenPlanSpec` from Task 1
- Consumes: env var name `MINIMAX_TOKEN_PLAN_KEY`
- Produces: `SPECS.get("minimax-token-plan")` returns the new spec (consumed by Task 4)

- [ ] **Step 1: Write the failing test**

Add to `tests/providers/minimax-token-plan.test.ts` (append inside the existing `describe` block, before the closing `});`):

```ts
  it("is registered in unified-complete SPECS Map", async () => {
    const { SPECS } = await import("../../src/providers/unified-complete.js");
    const spec = SPECS.get("minimax-token-plan");
    expect(spec).toBeDefined();
    expect(spec?.baseUrl).toBe("https://api.minimax.io/anthropic");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:vitest tests/providers/minimax-token-plan.test.ts 2>&1 | tail -20`
Expected: FAIL with "expected undefined to be defined" or similar.

- [ ] **Step 3: Add the import**

At the top of `src/providers/unified-complete.ts` (alongside the existing spec imports around line 10-13), add:

```ts
import { minimaxTokenPlanSpec } from "./specs/minimax-token-plan-spec.js";
```

- [ ] **Step 4: Register in SPECS Map**

In the `SPECS` Map (around line 18-32), add an entry:

```ts
["minimax-token-plan", minimaxTokenPlanSpec],
```

(Insert in the same style as the existing entries — e.g. between `["minimax", minimaxSpec]` and `["mock", mockSpec]`.)

- [ ] **Step 5: Add to PROVIDER_KEY_ENV**

In the `PROVIDER_KEY_ENV` object (around line 34-48), add:

```ts
minimax-token-plan: "MINIMAX_TOKEN_PLAN_KEY",
```

(Insert after the existing `"minimax": "MINIMAX_API_KEY"` entry.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test:vitest tests/providers/minimax-token-plan.test.ts 2>&1 | tail -10`
Expected: 6 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/providers/unified-complete.ts tests/providers/minimax-token-plan.test.ts
git commit -m "feat(minimax): register Token Plan spec in unified-complete"
```

---

## Task 4: Wire provider class into registry

**Files:**
- Modify: `src/providers/registry.ts:11` (import)
- Modify: `src/providers/registry.ts:19-33` (`lazyProviders`)
- Modify: `src/providers/registry.ts:61-76` (`listProviders`)

**Interfaces:**
- Consumes: `MiniMaxTokenPlanProvider` from Task 2
- Produces: `createProvider({ provider: "minimax-token-plan" }, apiKey)` returns a `MiniMaxTokenPlanProvider` (consumed by the CLI `init`/`run` flows)

- [ ] **Step 1: Write the failing test**

Add to `tests/providers/minimax-token-plan.test.ts` (inside the existing `describe`):

```ts
  it("createProvider returns MiniMaxTokenPlanProvider for id 'minimax-token-plan'", async () => {
    const { createProvider } = await import("../../src/providers/registry.js");
    const p = await createProvider({ provider: "minimax-token-plan" }, "sk-cp-test");
    expect(p.id).toBe("minimax-token-plan");
    expect(p).toBeInstanceOf(MiniMaxTokenPlanProvider);
  });

  it("listProviders includes 'minimax-token-plan'", async () => {
    const { listProviders } = await import("../../src/providers/registry.js");
    const list = listProviders();
    expect(list.find((p) => p.id === "minimax-token-plan")).toBeDefined();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:vitest tests/providers/minimax-token-plan.test.ts 2>&1 | tail -20`
Expected: FAIL with "createProvider" or "unknown provider" error.

- [ ] **Step 3: Add the import**

In `src/providers/registry.ts`, alongside the existing provider imports (around line 11), add:

```ts
import { MiniMaxTokenPlanProvider } from "./minimax-token-plan-provider.js";
```

- [ ] **Step 4: Register in lazyProviders**

In the `lazyProviders` map (around line 19-33), add a new entry:

```ts
"minimax-token-plan": lazy(() => import("./minimax-token-plan-provider.js").then((m) => m.MiniMaxTokenPlanProvider)),
```

(Insert after the existing `"minimax": lazy(...)` entry.)

- [ ] **Step 5: Add to listProviders()**

In the `listProviders()` function (around line 61-76), add the entry to the returned array:

```ts
{ id: "minimax-token-plan", name: "MiniMax (Token Plan)", envKey: "MINIMAX_TOKEN_PLAN_KEY" },
```

(Insert after the existing `{ id: "minimax", ... }` entry.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test:vitest tests/providers/minimax-token-plan.test.ts 2>&1 | tail -10`
Expected: 8 tests pass.

- [ ] **Step 7: Update the existing `listProviders returns all providers` test**

The existing test at `tests/providers.test.ts:314-320` asserts `list.length >= 12`. After adding the new provider, the count will be 13. Update the assertion:

```ts
  assert.ok(list.length >= 13);
```

- [ ] **Step 8: Run the full providers test to verify everything passes**

Run: `pnpm test:vitest tests/providers.test.ts 2>&1 | tail -10`
Expected: PASS with all tests including the updated count.

- [ ] **Step 9: Commit**

```bash
git add src/providers/registry.ts tests/providers/minimax-token-plan.test.ts tests/providers.test.ts
git commit -m "feat(minimax): register MiniMaxTokenPlanProvider in registry"
```

---

## Task 5: Wire catalog entry (PROVIDERS + listModels + DEFAULT_MODELS)

**Files:**
- Modify: `src/providers/catalog.ts:25-37` (`PROVIDERS`)
- Modify: `src/providers/catalog.ts:39-157` (`listModels` switch — add new case)
- Modify: `src/providers/catalog.ts:163-175` (`DEFAULT_MODELS`)

**Interfaces:**
- Produces: `PROVIDERS` array now includes `minimax-token-plan` (auto-picks up `tests/providers/catalog.vitest.ts` coverage)
- Produces: `listModels("minimax-token-plan", apiKey)` calls `https://api.minimax.io/anthropic/v1/models` with `x-api-key` header
- Produces: `getDefaultModel("minimax-token-plan")` returns `"MiniMax-M3"`

- [ ] **Step 1: Write the failing test**

Add to `tests/providers/minimax-token-plan.test.ts` (inside the existing `describe`):

```ts
  it("listModels calls https://api.minimax.io/anthropic/v1/models with x-api-key", async () => {
    const { listModels } = await import("../../src/providers/catalog.js");
    let captured: { url: string; headers: Record<string, string> } | undefined;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any, init: any) => {
      captured = { url: String(url), headers: init?.headers ?? {} };
      return new Response(JSON.stringify({ data: [{ id: "MiniMax-M3", display_name: "MiniMax-M3" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as any;
    try {
      const models = await listModels("minimax-token-plan", "sk-cp-test");
      expect(captured?.url).toBe("https://api.minimax.io/anthropic/v1/models");
      expect(captured?.headers["x-api-key"]).toBe("sk-cp-test");
      expect(captured?.headers["anthropic-version"]).toBe("2023-06-01");
      expect(models).toEqual([{ id: "MiniMax-M3", displayName: "MiniMax-M3", maxInputTokens: undefined, maxOutputTokens: undefined }]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("getDefaultModel returns 'MiniMax-M3'", async () => {
    const { getDefaultModel } = await import("../../src/providers/catalog.js");
    expect(getDefaultModel("minimax-token-plan")).toBe("MiniMax-M3");
  });

  it("PROVIDERS array includes minimax-token-plan", async () => {
    const { PROVIDERS } = await import("../../src/providers/catalog.js");
    const p = PROVIDERS.find((x) => x.id === "minimax-token-plan");
    expect(p).toEqual({
      id: "minimax-token-plan",
      name: "MiniMax (Token Plan)",
      env: "MINIMAX_TOKEN_PLAN_KEY",
      hint: "sk-cp-...",
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:vitest tests/providers/minimax-token-plan.test.ts 2>&1 | tail -20`
Expected: 3 new tests fail.

- [ ] **Step 3: Add to PROVIDERS array**

In `src/providers/catalog.ts`, find the `PROVIDERS` array (lines 25-37). Add the new entry after the existing `minimax` entry:

```ts
{ id: "minimax-token-plan", name: "MiniMax (Token Plan)", env: "MINIMAX_TOKEN_PLAN_KEY", hint: "sk-cp-..." },
```

- [ ] **Step 4: Add listModels switch case**

In the `listModels` switch (lines 39-157), add a new case after the existing `minimax` case (around line 135):

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

- [ ] **Step 5: Add to DEFAULT_MODELS**

In the `DEFAULT_MODELS` object (lines 163-175), add a new entry:

```ts
"minimax-token-plan": "MiniMax-M3",
```

(Insert after the existing `minimax: "minimax-text-01"` entry.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test:vitest tests/providers/minimax-token-plan.test.ts 2>&1 | tail -10`
Expected: 11 tests pass.

- [ ] **Step 7: Run the catalog test to verify auto-coverage still works**

Run: `pnpm test:vitest tests/providers/catalog.vitest.ts 2>&1 | tail -10`
Expected: PASS — the new env var `MINIMAX_TOKEN_PLAN_KEY` is automatically picked up by `ALL_ENV_VARS` and the precedence tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/providers/catalog.ts tests/providers/minimax-token-plan.test.ts
git commit -m "feat(minimax): register Token Plan in catalog (PROVIDERS, listModels, DEFAULT_MODELS)"
```

---

## Task 6: Wire credential-migration + context-limits + manual test file

**Files:**
- Modify: `src/security/credentials/credential-migration.ts:60-71` (`PROVIDER_ENV_MAP`)
- Modify: `src/config/context-limits.ts:38` (per-provider window table)
- Modify: `tests/manual/run-cli.ts:21-33` (`PROVIDER_ENV_VARS`)

**Interfaces:**
- Produces: `credential-migration` recognizes `MINIMAX_TOKEN_PLAN_KEY` as a known env var
- Produces: `context-limits` returns `{ contextWindowTokens: 1_048_576, tokenizer: "cl100k_base" }` for `minimax-token-plan`
- Produces: `tests/manual/run-cli.ts` can resolve the new provider's env var

- [ ] **Step 1: Add to PROVIDER_ENV_MAP (credential-migration)**

In `src/security/credentials/credential-migration.ts`, find the `PROVIDER_ENV_MAP` object (lines 60-71). Add a new entry:

```ts
"minimax-token-plan": "MINIMAX_TOKEN_PLAN_KEY",
```

(Insert after the existing `"minimax": "MINIMAX_API_KEY"` entry.)

- [ ] **Step 2: Add to context-limits**

In `src/config/context-limits.ts`, find the per-provider window table (around line 38). Add a new entry:

```ts
"minimax-token-plan": { contextWindowTokens: 1_048_576, tokenizer: "cl100k_base" },
```

(Insert after the existing `minimax: { ... }` entry.)

- [ ] **Step 3: Add to PROVIDER_ENV_VARS (manual test)**

In `tests/manual/run-cli.ts`, find the `PROVIDER_ENV_VARS` object (lines 21-33). Add a new entry:

```ts
"minimax-token-plan": "MINIMAX_TOKEN_PLAN_KEY",
```

(Insert after the existing `minimax: "MINIMAX_API_KEY"` entry.)

- [ ] **Step 4: Verify all three files build clean**

Run: `npx tsc --noEmit 2>&1 | tail -10`
Expected: clean exit (no type errors).

- [ ] **Step 5: Commit**

```bash
git add src/security/credentials/credential-migration.ts src/config/context-limits.ts tests/manual/run-cli.ts
git commit -m "feat(minimax): register Token Plan in credential-migration, context-limits, manual test"
```

---

## Task 7: Update cloud-minimax.json profile

**Files:**
- Modify: `src/config/profiles/cloud-minimax.json` (5 lines — all model tiers)

**Interfaces:**
- Produces: `cloud-minimax.json` profile uses `minimax-token-plan` provider with `MiniMax-M3` model in all 5 tiers

- [ ] **Step 1: Read the current profile to confirm structure**

Run: `cat src/config/profiles/cloud-minimax.json`
Expected: file shows 5 tiers (`default`, `planner`, `coder`, `researcher`, `critic`) each with `provider: "minimax"`, plus an `embeddings` tier with `provider: "openai"`.

- [ ] **Step 2: Update the 5 model tiers**

Using your editor (or `sed -i`), change `provider: "minimax"` to `provider: "minimax-token-plan"` in the 5 model-tier lines ONLY. Do NOT touch the `embeddings` line (it stays `provider: "openai"`).

Run: `sed -i 's/"provider": "minimax",/"provider": "minimax-token-plan",/g' src/config/profiles/cloud-minimax.json`

Verify with: `cat src/config/profiles/cloud-minimax.json`
Expected: 5 model tiers now say `minimax-token-plan`. The `embeddings` tier still says `openai`.

- [ ] **Step 3: Validate the profile shape**

Run: `npx tsc --noEmit 2>&1 | tail -10`
Expected: clean exit (no errors).

- [ ] **Step 4: Run the profile test (if it exists)**

Run: `pnpm test:vitest tests/config/profile-registry.vitest.ts 2>&1 | tail -10` (skip if the file doesn't exist)
Expected: PASS or skipped.

- [ ] **Step 5: Commit**

```bash
git add src/config/profiles/cloud-minimax.json
git commit -m "feat(minimax): point cloud-minimax profile at Token Plan provider"
```

---

## Task 8: Update streaming regression test

**Files:**
- Modify: `tests/providers/streaming-regression.test.ts` (1 line in `STREAMING_SPECS`)

**Interfaces:**
- Produces: `streaming-regression` test suite covers `minimaxTokenPlanSpec` (verifying the Anthropic-compatible wire format)

- [ ] **Step 1: Find the STREAMING_SPECS array**

Run: `grep -n "STREAMING_SPECS\|anthropicSpec" tests/providers/streaming-regression.test.ts | head -10`
Expected: find the array definition and the existing `anthropicSpec` entry.

- [ ] **Step 2: Add the new spec entry**

In the `STREAMING_SPECS` array, add an entry after the existing `anthropicSpec` entry:

```ts
[ "minimax-token-plan", minimaxTokenPlanSpec ],
```

(If the array uses a different shape, follow the pattern of the existing entries.)

- [ ] **Step 3: Add the import**

At the top of the file, add:

```ts
import { minimaxTokenPlanSpec } from "../../src/providers/specs/minimax-token-plan-spec.js";
```

(Insert alongside the existing spec imports.)

- [ ] **Step 4: Run the streaming regression test**

Run: `pnpm test:vitest tests/providers/streaming-regression.test.ts 2>&1 | tail -10`
Expected: PASS — the existing `anthropicSpec` tests should now also pass for `minimaxTokenPlanSpec` since they share the same wire format.

- [ ] **Step 5: Commit**

```bash
git add tests/providers/streaming-regression.test.ts
git commit -m "test(minimax): include Token Plan spec in streaming regression"
```

---

## Task 9: Run full suite + verification

**Files:** (no edits — verification only)

- [ ] **Step 1: Build the project**

Run: `pnpm build 2>&1 | tail -10`
Expected: clean exit (no TypeScript errors).

- [ ] **Step 2: Run the full vitest suite**

Run: `pnpm test:vitest 2>&1 | tail -10`
Expected: all tests pass (no new failures introduced).

- [ ] **Step 3: Capture the test count as a baseline**

Run: `pnpm test:vitest 2>&1 | grep -E "Test Files|Tests"`
Expected: e.g. `Test Files  384 passed | 1 skipped (385)` / `Tests  4193 passed | 7 skipped (4200)` (or higher — the new tests in `minimax-token-plan.test.ts` should add to the count).

- [ ] **Step 4: Verify the new provider appears in the CLI menu**

Run: `node -e "import('./src/providers/catalog.js').then(m => { console.log(m.PROVIDERS.find(p => p.id === 'minimax-token-plan')); })"`
Expected: `{ id: 'minimax-token-plan', name: 'MiniMax (Token Plan)', env: 'MINIMAX_TOKEN_PLAN_KEY', hint: 'sk-cp-...' }`

- [ ] **Step 5: Detect any changes staged**

Run: `git status --short`
Expected: only the 2 pre-existing uncommitted edits (`AGENTS.md`, `CLAUDE.md`) — nothing else. All implementation changes should be committed.

- [ ] **Step 6: Report final state**

Run: `git log --oneline main..feat/minimax-token-plan-provider`
Expected: 9 commits (one per task).

- [ ] **Step 7: Wait for user review**

Show the commit list and pause for the user to review before proceeding to merge.

---

## Self-Review

**1. Spec coverage:**

- New provider entry (`minimax-token-plan`): Tasks 1, 2, 3, 4, 5.
- Anthropic-compatible protocol: Task 1 (spec spread).
- `MINIMAX_TOKEN_PLAN_KEY` env var: Tasks 3, 4, 6.
- `sk-cp-...` hint: Task 5.
- `MiniMax-M3` default model: Tasks 2, 5.
- `x-api-key` + `anthropic-version` headers: Task 5 (listModels case).
- `cloud-minimax.json` profile update: Task 7.
- Capability numbers (1M input, 64k output): Task 2.
- `context-limits` entry: Task 6.
- TDD throughout: Tasks 2, 3, 4, 5.
- Verification: Task 9.
- Risky variants (API drift, capability drift): out of scope per the spec.

**2. Placeholder scan:** No "TBD", "TODO", "fill in details". All concrete code, paths, and commands.

**3. Type consistency:** `MiniMaxTokenPlanProvider` (Task 2) → `lazyProviders["minimax-token-plan"]` (Task 4) → `createProvider({ provider: "minimax-token-plan" })` (Tasks 4, 9) — all consistent. `minimaxTokenPlanSpec` (Task 1) → `SPECS.get("minimax-token-plan")` (Task 3) → `provider-selection.ts` consumer (Task 9) — all consistent. Env var `MINIMAX_TOKEN_PLAN_KEY` used the same way across Tasks 3, 4, 6.

**4. Ambiguity check:** The `sed -i` command in Task 7 Step 2 is precise enough — it only changes the `provider: "minimax"` lines. The `embeddings` tier uses `provider: "openai"` so the `sed` won't accidentally touch it. The TDD approach in Tasks 2–5 makes each test self-verifying.
