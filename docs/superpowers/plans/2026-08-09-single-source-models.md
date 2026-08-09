# Single-Source Model Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `models` the single persistent source of model assignments; `model` and `subagents.*` become derived compatibility projections normalized in-memory at the loader boundary; collapse all model writers into the `alix models` family; remove the legacy `config set-default-model` / `config set-tier` commands.

**Architecture:** `models` is the only persisted store. `loadConfig()` normalizes on load: legacy `model` → `models.default` (in-memory, file untouched), then derives `model := models.default` and `subagents[tier] := models.<tier> ?? models.default`. A new `resolveModelConfig(config, tier?)` resolver is the progressive target for runtime readers. The `alix models` command family is the only writer; `apply-profile`/`install-profile` write only `modelProfile` + `models`.

**Tech Stack:** TypeScript strict, node:test (`*.test.ts`) + vitest (`*.vitest.ts`), conventional commits.

## Global Constraints

- **The invariant (load-bearing):** No configuration writer may persist `model.*` or `subagents.<tier>` as an independent model assignment. All persisted model assignments MUST originate under `models`.
- `models.default` is authoritative; legacy `model` only seeds it when absent; when both present, `models.default` wins.
- Migration is **in-memory only** — `loadConfig()` never rewrites `config.json`.
- `apiKeys` remains a separate, orthogonal section — never coupled to model selection.
- `model := models.default`; `subagents[tier] := models.<tier> ?? models.default` (tier fallback preserves today's `loader.ts:213-223` behavior).
- Legacy `config set-default-model` and `config set-tier` are **removed** — tests must assert they fail as unknown commands.
- Tier names are the canonical 6: `thinking`, `coding`, `fast`, `critic`, `tiny`, `image`.
- Conventional commit prefixes: `feat:`, `fix:`, `test:`, `docs:`.

---

### Task 1: Add `models` normalization + derivation in the loader

**Files:**
- Modify: `src/config/loader.ts` — normalization + subagent fill
- Test: `tests/config-loader.test.ts`

**Interfaces:**
- Consumes: `AlixConfig` (`model: ModelConfig`, `models?: Record<string, {provider,name,...}>`), `SubagentConfig` tiers from `src/config/schema.ts`.
- Produces: a normalized `AlixConfig` where `result.model` is populated from `models.default` (or legacy `model`), and every `subagents[tier]` is filled from `models.<tier>` falling back to `models.default`. Also export a pure helper `normalizeModelConfig(config: Partial<AlixConfig>): void` (mutates in place) that Task 2's resolver and Task 5's writers reuse.

- [ ] **Step 1: Write the failing test**

Add to `tests/config-loader.test.ts` (node:test, near the existing model assertions):

```ts
import { normalizeModelConfig } from "../src/config/loader.js";

test("normalizeModelConfig: legacy model seeds models.default in-memory", () => {
  const cfg: any = { model: { provider: "deepseek", name: "deepseek-chat" } };
  normalizeModelConfig(cfg);
  assert.deepEqual(cfg.models.default, { provider: "deepseek", name: "deepseek-chat" });
});

test("normalizeModelConfig: models.default wins over legacy model", () => {
  const cfg: any = {
    model: { provider: "legacy", name: "old" },
    models: { default: { provider: "deepseek", name: "deepseek-chat" } },
  };
  normalizeModelConfig(cfg);
  assert.equal(cfg.models.default.name, "deepseek-chat");
  assert.equal(cfg.model.provider, "deepseek");
});

test("normalizeModelConfig: derives model from models.default", () => {
  const cfg: any = { models: { default: { provider: "deepseek", name: "deepseek-chat" } } };
  normalizeModelConfig(cfg);
  assert.equal(cfg.model.provider, "deepseek");
  assert.equal(cfg.model.name, "deepseek-chat");
});

test("normalizeModelConfig: fills subagent tiers from models with fallback to default", () => {
  const cfg: any = { models: { default: { provider: "deepseek", name: "deepseek-chat" }, coding: { provider: "openai", name: "gpt-4o" } } };
  normalizeModelConfig(cfg);
  assert.deepEqual(cfg.subagents.coding, { provider: "openai", name: "gpt-4o" });
  assert.deepEqual(cfg.subagents.thinking, { provider: "deepseek", name: "deepseek-chat" }); // fallback
});

test("normalizeModelConfig: no model and no models leaves unset (loader throws later)", () => {
  const cfg: any = {};
  normalizeModelConfig(cfg);
  assert.equal(cfg.model, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/config-loader.test.js`
Expected: FAIL — `normalizeModelConfig` is not exported.

- [ ] **Step 3: Implement the minimal normalization**

In `src/config/loader.ts`, add the `ModelConfig`/`ModelTierConfig` import (already imported), the `MODEL_TIERS` constant, and the pure helper:

```ts
export const MODEL_TIERS = ["thinking", "coding", "fast", "critic", "tiny", "image"] as const;

/**
 * Normalize an AlixConfig's model fields in place (in-memory only — never
 * rewrites the file). Enforces the single-source invariant: `models` is the
 * only persisted store; `model` and `subagents.<tier>` are derived views.
 */
export function normalizeModelConfig(config: Partial<AlixConfig>): void {
  // 1. Legacy `model` → `models.default` (only when models.default absent).
  if (!config.models?.default && config.model?.provider && config.model?.name) {
    config.models = { ...(config.models ?? {}), default: { provider: config.model.provider, name: config.model.name } };
  }
  // 2. models.default is authoritative → derive `model`.
  const def = config.models?.default;
  if (def?.provider && def?.name) {
    config.model = { provider: def.provider, name: def.name };
  }
  // 3. Derive subagents.<tier> from models.<tier> ?? models.default.
  if (config.models) {
    config.subagents = { ...(config.subagents ?? {}) };
    for (const tier of MODEL_TIERS) {
      const tierModel = config.models[tier] ?? def;
      if (tierModel?.provider && tierModel?.name) {
        (config.subagents as Record<string, unknown>)[tier] = { provider: tierModel.provider, name: tierModel.name };
      }
    }
  }
}
```

- [ ] **Step 4: Wire `normalizeModelConfig` into `loadConfig`** after `mergeConfig` produces the final result, before the `requireModel` validation at `loader.ts:205`. Also update the `"No model configured"` error message to point at the new command:

```ts
"Example: alix models set-default deepseek deepseek-v4-flash\n" +
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm build && node --test dist/tests/config-loader.test.js`
Expected: PASS (all existing + 5 new).

- [ ] **Step 6: Commit**

```bash
git add src/config/loader.ts tests/config-loader.test.ts
git commit -m "feat(config): normalize models as single source in loader
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Add `resolveModelConfig` resolver

**Files:**
- Create: `src/config/model-resolver.ts`
- Test: `tests/config/model-resolver.test.ts`

**Interfaces:**
- Consumes: `AlixConfig`, `normalizeModelConfig` (Task 1) to guarantee `models.default` present.
- Produces: `resolveModelConfig(config: AlixConfig, tier?: string): { provider: string; name: string }` — no tier → `models.default`; with tier → `models.<tier> ?? models.default`. Throws if neither resolves.

- [ ] **Step 1: Write the failing test**

`tests/config/model-resolver.test.ts` (node:test):

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { resolveModelConfig } from "../../src/config/model-resolver.js";

test("resolveModelConfig: default tier returns models.default", () => {
  const cfg: any = { models: { default: { provider: "deepseek", name: "deepseek-chat" } } };
  assert.deepEqual(resolveModelConfig(cfg), { provider: "deepseek", name: "deepseek-chat" });
});

test("resolveModelConfig: explicit tier returns models.<tier>", () => {
  const cfg: any = { models: { default: { provider: "deepseek", name: "deepseek-chat" }, coding: { provider: "openai", name: "gpt-4o" } } };
  assert.deepEqual(resolveModelConfig(cfg, "coding"), { provider: "openai", name: "gpt-4o" });
});

test("resolveModelConfig: missing tier falls back to default", () => {
  const cfg: any = { models: { default: { provider: "deepseek", name: "deepseek-chat" } } };
  assert.deepEqual(resolveModelConfig(cfg, "critic"), { provider: "deepseek", name: "deepseek-chat" });
});

test("resolveModelConfig: throws when no model resolves", () => {
  assert.throws(() => resolveModelConfig({} as any), /No model configured/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/config/model-resolver.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { AlixConfig } from "./schema.js";
import { normalizeModelConfig } from "./loader.js";

export function resolveModelConfig(
  config: AlixConfig,
  tier?: string,
): { provider: string; name: string } {
  normalizeModelConfig(config);
  const def = config.models?.default;
  const m = tier ? (config.models?.[tier] ?? def) : def;
  if (!m?.provider || !m?.name) {
    throw new Error('No model configured. Run: alix models set-default');
  }
  return { provider: m.provider, name: m.name };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/config/model-resolver.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/model-resolver.ts tests/config/model-resolver.test.ts
git commit -m "feat(config): add resolveModelConfig resolver
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Profile writer writes only `modelProfile` + `models`

**Files:**
- Modify: `src/config/profile-patch.ts`
- Test: `tests/config/profile-patch.test.ts`

**Interfaces:**
- Consumes: `ProfileData` (`models: Partial<Record<ModelTier, ProfileModel>>`), `ProfilePatch`.
- Produces: `ProfilePatch` carrying `modelProfile` + `models` only (no `model`, no `subagents`). `applyProfilePatch` merges `models` and sets `modelProfile`; it must NOT write `model` or `subagents` (loader derives them).

- [ ] **Step 1: Write the failing test**

Add to `tests/config/profile-patch.test.ts`:

```ts
test("buildProfilePatch: writes only modelProfile + models, no model/subagents", () => {
  const patch = buildProfilePatch(balancedLocalProfile);
  assert.equal(patch.modelProfile, "balanced-local");
  assert.ok(patch.models?.default);           // still writes models
  assert.ok(patch.models?.coder);             // per-tier still there
  assert.equal(patch.model, undefined);       // no flat model write
  assert.equal(patch.subagents, undefined);   // no subagents write
});

test("applyProfilePatch: output has modelProfile + models but no model/subagents keys", () => {
  const patch = buildProfilePatch(balancedLocalProfile);
  const out = applyProfilePatch({} as any, patch);
  assert.equal(out.modelProfile, "balanced-local");
  assert.ok(out.models?.default);
  assert.equal(out.model, undefined);
  assert.equal(out.subagents, undefined);
});
```

Use the existing `balancedLocalProfile` fixture already in the test file (or a minimal inline `ProfileData`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/config/profile-patch.test.js`
Expected: FAIL — `patch.model` is currently set, `patch.subagents` exists.

- [ ] **Step 3: Implement** — edit `src/config/profile-patch.ts`:

Remove from `buildProfilePatch` the `patch.model = { ... }` assignment (lines 31-34) and the `subagents` sync loop in `applyProfilePatch` (lines 59-71). Keep writing `modelProfile` and `models`. Keep `PRESERVED_SECTIONS` as-is.

```ts
export function buildProfilePatch(profile: ProfileData): ProfilePatch {
  const patch: ProfilePatch = { modelProfile: profile.id };
  patch.models = {};
  for (const [tier, model] of Object.entries(profile.models)) {
    patch.models[tier] = { provider: model.provider, name: model.name };
    if (model.temperature !== undefined) patch.models[tier].temperature = model.temperature;
    if (model.contextWindow !== undefined) patch.models[tier].contextWindow = model.contextWindow;
  }
  return patch;
}

export function applyProfilePatch(existingConfig: AlixConfig, patch: ProfilePatch): AlixConfig {
  const result: Record<string, unknown> = { ...(existingConfig as any) };
  result.modelProfile = patch.modelProfile;
  if (patch.models) result.models = { ...((result.models as object) || {}), ...patch.models };
  if (patch.runtime) result.runtime = { ...(result.runtime as object), ...patch.runtime };
  return result as AlixConfig;
}
```

- [ ] **Step 4: Run all profile-patch + loader + model-install tests**

Run: `pnpm build && node --test dist/tests/config/profile-patch.test.js dist/tests/config-loader.test.js dist/tests/models/model-install.test.js`
Expected: PASS. Existing assertions that `patch.model?.name === "qwen3:4b"` (line 33-34) and subagent sync (62-70) will need updating to assert on `models.default`/absence instead.

- [ ] **Step 5: Update the pinned assertions**

In `tests/config/profile-patch.test.ts`, change:
- line 33-34 `patch.model?.name === "qwen3:4b"` → `patch.models?.default?.name === "qwen3:4b"`
- lines 62-70 (subagent sync assertions) → assert `out.subagents === undefined` and that `out.models.coder` exists (loader derives subagents).

- [ ] **Step 6: Commit**

```bash
git add src/config/profile-patch.ts tests/config/profile-patch.test.ts
git commit -m "fix(config): profile writes only modelProfile + models
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Add `alix models set-default` and `set-tier` writers

**Files:**
- Modify: `src/cli/commands/models.ts`
- Modify: `src/cli/helpers/api-keys.ts` (reuse `setApiKey`)
- Test: `tests/cli/models-command.vitest.ts`

**Interfaces:**
- Consumes: `PROVIDERS`, `listModels`, `getSavedApiKey`, `setApiKey` from catalog/api-keys (already in `src/cli.ts`); the interactive selection helpers in `src/cli/helpers/provider-selection.ts`.
- Produces: `handleSetDefaultModel(args: string[])` → writes `models.default` + derives `model`; `handleSetTier(args: string[])` → writes `models.<tier>` + derives `subagents.<tier>`. Registered in `models.ts` HANDLERS map as `"set-default"` and `"set-tier"`. Both write to user or project config (same path logic as today's `set-default-model` at `cli.ts:795-812`), never writing `model`/`subagents` independently.

- [ ] **Step 1: Write the failing test**

`tests/cli/models-command.vitest.ts` (vitest):

```ts
import { describe, it, expect } from "vitest";
import { handleSetDefaultModel, handleSetTier } from "../../src/cli/commands/models.js";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeTmpConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "alix-models-"));
  const p = join(dir, ".alix", "config.json");
  // path resolution happens via cwd; simulate by writing directly
  return p;
}

describe("alix models set-default", () => {
  it("writes models.default and derives model", async () => {
    // mock provider-selection listModels to return a fixed model
    // then assert config.json has models.default + model
  });
});
```

Because the selection is interactive, mock `provider-selection.ts` via `vi.mock` to return fixed picks, and point cwd at a tmp dir with a `.git`. Assert the written config has `models.default` and `model` derived from it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/models-command.vitest.ts`
Expected: FAIL — `handleSetDefaultModel` not exported.

- [ ] **Step 3: Implement the two handlers in `models.ts`**

Port the body of today's `set-default-model` (interactive provider pick → `getApiKey`/`setApiKey` → `listModels` → `selectModelInteractive` → write) and `set-tier` (tier pick → same flow → write) into `models.ts`, changing only the *written key*: `models.default` / `models.<tier>` instead of `model` / `subagents.<tier>`. Reuse `normalizeModelConfig` on the in-memory result so `model`/`subagents` are derived for display, but **persist only `models`** (plus `modelProfile` untouched). Register in HANDLERS + usage text.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/models-command.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/models.ts tests/cli/models-command.vitest.ts
git commit -m "feat(models): add alix models set-default and set-tier
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Remove legacy `config set-default-model` and `config set-tier`

**Files:**
- Modify: `src/cli.ts` (remove blocks 680-733 and 735-813)
- Test: `tests/cli/cli-commands.test.ts` (or add to `tests/cli-command-registration.test.ts` if present)

**Interfaces:**
- Consumes: nothing new — just removes the two legacy handlers.
- Produces: `alix config set-default-model` / `alix config set-tier` fail as unknown commands.

- [ ] **Step 1: Write the failing test**

Add a test that asserts both commands are unknown. If `src/cli.ts` runs its handler via a big `if (command === ...)` chain (it does), the simplest robust check is to assert the dispatch does not contain the legacy handlers. Since `cli.ts` is the entrypoint with side effects, test at the module level via a helper. Concretely:

```ts
test("legacy config model commands are removed", () => {
  const cliSource = readFileSync(new URL("../../src/cli.ts", import.meta.url), "utf8");
  assert.ok(!cliSource.includes('args[0] === "set-default-model"'), "set-default-model removed");
  assert.ok(!cliSource.includes('args[0] === "set-tier"'), "config set-tier removed");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/cli/cli-commands.test.js`
Expected: FAIL — the strings still exist.

- [ ] **Step 3: Remove the two blocks** from `src/cli.ts`: lines 680-733 (`set-default-model`) and 735-813 (`set-tier`). Update any usage text that references them (search `set-default-model` / `set-tier` in `src/cli.ts` and `src/cli/commands/*`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/cli/cli-commands.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full affected suite**

Run: `pnpm build && node --test dist/tests/config-loader.test.js dist/tests/config/model-resolver.test.js dist/tests/config/profile-patch.test.js dist/tests/models/model-install.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/cli/cli-commands.test.ts
git commit -m "feat(cli): remove legacy config set-default-model and set-tier
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Migrate high-drift runtime readers to `resolveModelConfig`

**Files:**
- Modify: `src/agent/agent.ts` (lines 113-120), `src/agent/session.ts` (lines 1180-1181, 1221-1224), `src/run/task-loop.ts` (lines 811-823), `src/agents/subagent-cli.ts` (lines 104-116)
- Test: re-run existing suites (no new tests — these are mechanical swaps; existing tests pin the behavior).

**Interfaces:**
- Consumes: `resolveModelConfig` (Task 2).
- Produces: the four drift sites read the model via `resolveModelConfig(config, tier?)` instead of raw `config.model.provider/name`. Behavior identical; the resolver enforces single-source.

- [ ] **Step 1: Mechanical swap in each file**

In `src/agent/agent.ts` (113-120):
```ts
const { provider, name } = resolveModelConfig(config);
// use provider/name where config.model.provider / config.model.name were read
```

In `src/agent/session.ts` (1180-1181, 1221-1224): replace `ctx.config.model.provider/name/streaming` with `const resolved = resolveModelConfig(ctx.config);` and use `resolved.provider` / `resolved.name`. Keep `ctx.config.model.streaming` as-is (streaming is a derived convenience, not a model assignment).

In `src/run/task-loop.ts` (811-823): `const { provider, name } = resolveModelConfig(config);` for the m09 metric + model.usage event.

In `src/agents/subagent-cli.ts` (104-116): after CLI override / tier-role resolution, resolve via `resolveModelConfig(config, tier)` instead of mutating `config.model`.

Import `resolveModelConfig` from `../config/model-resolver.js` in each.

- [ ] **Step 2: Run the full affected suite**

Run: `pnpm build && node --test dist/tests/config-loader.test.js dist/tests/config/model-resolver.test.js dist/tests/config/profile-patch.test.js dist/tests/models/model-install.test.js dist/tests/agent/agent-loop.test.js dist/tests/agent/session.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/agent/agent.ts src/agent/session.ts src/run/task-loop.ts src/agents/subagent-cli.ts
git commit -m "refactor(config): migrate runtime readers to resolveModelConfig
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- One store (`models`) → Task 1 normalization, Task 3 profile-patch.
- Loader boundary in-memory → Task 1.
- `resolveModelConfig` → Task 2.
- One writer family → Task 4 (`set-default`/`set-tier`), Task 3 (profile), existing apply/install.
- Legacy commands removed → Task 5.
- Invariant enforced → Task 1 (normalize), Task 3 (profile writes only models), Task 4 (writers persist only models), Task 5 (legacy writers gone).
- Runtime readers migrate → Task 6.
- apiKeys orthogonal → no task touches it (explicitly preserved in Task 3/4).
- Tests: migration (Task 1), resolver (Task 2), writers (Task 4), profile-patch (Task 3), command-removal (Task 5), existing pinned tests (Task 6 re-run).

**Placeholder scan:** no TBD/TODO; every code step has concrete code. Task 4's test mocks provider-selection (interactive) — noted, with a concrete mock approach.

**Type consistency:** `normalizeModelConfig(config)` mutates in place and is exported from `loader.ts`; `resolveModelConfig(config, tier?)` from `model-resolver.ts`; `handleSetDefaultModel`/`handleSetTier` from `models.ts`. All names match across tasks.

## Verification

- `pnpm build` — clean.
- `node --test dist/tests/config-loader.test.js dist/tests/config/model-resolver.test.js dist/tests/config/profile-patch.test.js dist/tests/models/model-install.test.js dist/tests/cli/cli-commands.test.js` — all pass.
- `npx vitest run tests/cli/models-command.vitest.ts` — pass.
- Full `pnpm test:vitest` + `pnpm test:node` — no new failures (pre-existing streamSSE/unit failures on `main` are unrelated).
- Manual: `alix config show` still renders the active model; `alix models set-default` writes `models.default`; `alix config set-default-model` errors as unknown command.
- GitNexus: `detect_changes()` before each commit; `impact()` on `loadConfig`, `mergeConfig`, `buildProfilePatch`, `applyProfilePatch`, `handleModelsCommand` before editing (CLAUDE.md requirement).
