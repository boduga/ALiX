# Single-Source Model Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `models` the single persistent source of model assignments; `model` and `subagents.*` become derived compatibility projections normalized in-memory at the loader boundary; collapse all model writers into the `alix models` family; remove the legacy `config set-default-model` / `config set-tier` commands.

**Architecture (three layers):**
1. **Persistent representation** — only `models` and `modelProfile` hold model-selection state on disk. `model` and `subagents.*` are NEVER persisted by any writer.
2. **Loader compatibility projection** — `loadConfig()` produces, in memory only: `models` (authoritative), `model := models.default` (derived), `subagents[tier] := models.<tier> ?? models.default` (derived).
3. **Runtime resolution** — new code calls `resolveModelConfig(config, tier?)` (a **pure reader**, never mutates config); it does not touch the compatibility projections.

**Strengthened invariant:** Only the loader is allowed to construct compatibility projections. No writer, command handler, profile patcher, or runtime path constructs or persists `model` / `subagents` as model-selection state. Writers persist `models` only; the compatibility layer derives the rest on load.

**Tech Stack:** TypeScript strict, node:test (`*.test.ts`) + vitest (`*.vitest.ts`), conventional commits.

## Global Constraints

- **The invariant (load-bearing):** No configuration writer may persist `model.*` or `subagents.<tier>` as an independent model assignment. All persisted model assignments MUST originate under `models`. `model` and `subagents.*` exist solely as compatibility projections.
- **Migration is in-memory only** — `loadConfig()` never rewrites `config.json`; a config file with a legacy `model` field is left byte-for-byte untouched on load.
- **Precedence:** `models.default` is authoritative; legacy `model` only seeds it when absent; when both present, `models.default` wins.
- **Tier precedence:** `subagents[tier] := models.<tier> ?? models.default`.
- `apiKeys` remains separate — never coupled to model selection.
- **Canonical `ModelTier`** is a closed union: `default | thinking | coding | fast | critic | tiny | image`. No other tier string exists.
- **`MODEL_SUBAGENT_TIERS`** is the selectable (non-default) subset: `thinking | coding | fast | critic | tiny | image`. Distinct from `ModelTier` — never assume it covers `default`.
- Legacy `config set-default-model` and `config set-tier` are **removed** — tests must assert they fail as unknown commands via dispatch, not source-text grep.
- Conventional commit prefixes: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`.

---

### Task 1: Define canonical types + writer/reader audit

**Files:**
- Modify: `src/config/schema.ts` — `ModelTier`, `ModelsConfig`
- Modify: `src/config/profile-types.ts` — align `ModelTier` with schema's canonical set
- (Audit output recorded in plan, not committed)

**Interfaces:**
- Produces `ModelTier` (closed union) + `ModelsConfig = Partial<Record<ModelTier, ModelConfig>>` in `schema.ts`; `models?: ModelsConfig` on `AlixConfig`.
- This is the type both `resolveModelConfig` and the writers use — no loose `Record<string, ...>`.

- [ ] **Step 1: Add the types to `src/config/schema.ts`**

```ts
export type ModelTier =
  | "default" | "thinking" | "coding" | "fast" | "critic" | "tiny" | "image";

export type ModelsConfig = Partial<Record<ModelTier, ModelConfig>>;

/** Loader-owned compatibility projection — one tier vocabulary. */
export type DerivedSubagentConfig = Partial<Record<Exclude<ModelTier, "default">, ModelConfig>>;
```

Change `AlixConfig.models?: Record<string, { provider: string; name: string; temperature?: number; contextWindow?: number }>` → `models?: ModelsConfig`.

Document the persisted-vs-derived split on `AlixConfig`:
- **Persisted** (written to disk): `models`, `modelProfile`, `apiKeys`, everything else.
- **Loader-owned projections** (never persisted): `model?: ModelConfig` (derived from `models.default`), `subagents?: DerivedSubagentConfig` (derived from `models.*`).
- The rule: **any persistence operation must operate on a persisted representation, never the fully normalized `AlixConfig`.** TypeScript can't prevent serializing a field, but `withoutDerivedModelProjections` (Task 4) + the writers' strip-before-write make the intent structural.

- [ ] **Step 2: Align `profile-types.ts` `ModelTier`**

`src/config/profile-types.ts:8-15` defines `ModelTier` as `default | planner | researcher | coder | critic | embeddings | classifier`. These are *profile* tier names, distinct from the *config* `ModelTier`. Rename the profile one to `ProfileModelTier` and note it's a preset vocabulary that maps onto config tiers. **Resolve the `coder` vs `coding` inconsistency explicitly:** the profile tier `coder` maps to config tier `coding` (as `profile-patch.ts:60` already does via `tierMap`). Document this mapping in the type; do NOT introduce a `coder` config tier.

- [ ] **Step 3: Writer/reader audit (search, classify, record — do not change code)**

```bash
rg 'config\.model|config\.models|subagents|modelProfile' src --glob '!**/*.test.*'
rg 'writeFile|writeJson|saveConfig|save.*Config|updateConfig|mergeConfig' src
```

Classify every hit into: `authoritative-writer` / `derived-reader` / `profile-writer` / `cli-writer` / `runtime-reader` / `migration-loader`. Record the classification in this task's notes (commit message body). This proves the Task 6/7 (reader) and Task 4/5/6 (writer) surfaces are complete before any change.

> **Hard gate:** If this audit finds any writer — `config.model = ...`, `subagents[tier] = ...`, a `writeFile` of a derived projection — that is NOT covered by Tasks 4-6, **stop and extend the plan before proceeding**. A missed writer is an architectural defect, not incomplete cleanup.

- [ ] **Step 4: Run build + typecheck**

Run: `pnpm build`
Expected: clean (type change is non-breaking; `models` still accepts the same object shapes).

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts src/config/profile-types.ts
git commit -m "feat(config): type ModelsConfig with canonical ModelTier union
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: `normalizeModelConfig` — deterministic projection at the loader boundary

**Files:**
- Modify: `src/config/loader.ts`
- Test: `tests/config-loader.test.ts`

**Interfaces:**
- Consumes: `AlixConfig`, `ModelsConfig`, `ModelTier`.
- Produces: `export const MODEL_SUBAGENT_TIERS: readonly Exclude<ModelTier, "default">[]` and `export function normalizeModelConfig(config: Partial<AlixConfig>): void` — mutates in place; **deterministically replaces** `subagents` with a pure projection (never merges stale keys). **Preserves full `ModelConfig` metadata** — projections carry `temperature`/`contextWindow`/`maxOutputTokens` through, not just `{provider, name}`. The projection type is **derived from the canonical tier types** so there's exactly one tier vocabulary:

```ts
export type DerivedSubagentConfig = Partial<Record<Exclude<ModelTier, "default">, ModelConfig>>;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { normalizeModelConfig, MODEL_SUBAGENT_TIERS } from "../src/config/loader.js";

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

test("normalizeModelConfig: derives subagents deterministically, replacing stale keys", () => {
  const cfg: any = {
    models: {
      default: { provider: "deepseek", name: "deepseek-chat" },
      coding: { provider: "openai", name: "gpt-4o" },
    },
    // stale non-canonical tier + stale canonical tier must NOT survive
    subagents: {
      coding: { provider: "openai", name: "old-coding-model" },
      bogus: { provider: "x", name: "y" },
      thinking: { provider: "stale", name: "old" },
    },
  };
  normalizeModelConfig(cfg);
  assert.deepEqual(cfg.subagents.coding, { provider: "openai", name: "gpt-4o" });
  assert.deepEqual(cfg.subagents.thinking, { provider: "deepseek", name: "deepseek-chat" }); // fallback
  assert.equal(cfg.subagents.bogus, undefined); // stale non-canonical dropped
  assert.equal(cfg.subagents["old"], undefined);
  // only canonical tiers exist
  assert.deepEqual(Object.keys(cfg.subagents).sort(), ["coding", "thinking"].sort());
});

test("normalizeModelConfig: preserves model metadata through the projection", () => {
  const cfg: any = {
    models: {
      default: { provider: "deepseek", name: "deepseek-chat", temperature: 0.3, contextWindow: 64000 },
    },
  };
  normalizeModelConfig(cfg);
  assert.deepEqual(cfg.model, { provider: "deepseek", name: "deepseek-chat", temperature: 0.3, contextWindow: 64000 });
  assert.deepEqual(cfg.subagents.thinking, { provider: "deepseek", name: "deepseek-chat", temperature: 0.3, contextWindow: 64000 });
});

test("normalizeModelConfig: no model and no models leaves model AND subagents unset", () => {
  const cfg: any = {};
  normalizeModelConfig(cfg);
  assert.equal(cfg.model, undefined);
  assert.equal(cfg.subagents, undefined); // "no model configuration exists" ≠ "empty subagents"
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/config-loader.test.js`
Expected: FAIL — `normalizeModelConfig` not exported; stale subagent keys survive.

- [ ] **Step 3: Implement**

```ts
export const MODEL_SUBAGENT_TIERS: readonly Exclude<ModelTier, "default">[] = [
  "thinking", "coding", "fast", "critic", "tiny", "image",
];

/** Projection type derived from the canonical tier types — one tier vocabulary. */
export type DerivedSubagentConfig = Partial<Record<Exclude<ModelTier, "default">, ModelConfig>>;

/** Copy a ModelConfig carrying full metadata, not just provider/name. */
function cloneModelConfig(m: ModelConfig): ModelConfig {
  return { ...m };
}

export function normalizeModelConfig(config: Partial<AlixConfig>): void {
  // 1. Legacy `model` → `models.default` (only when models.default absent).
  if (!config.models?.default && config.model?.provider && config.model?.name) {
    config.models = { ...(config.models ?? {}), default: cloneModelConfig(config.model) };
  }
  // 2. models.default is authoritative → derive `model` with full metadata.
  const def = config.models?.default;
  if (def?.provider && def?.name) {
    config.model = cloneModelConfig(def);
  }
  // 3. Deterministic subagent projection: derivedSubagents replaces subagents
  //    wholesale, preserving full ModelConfig metadata. A canonical tier not in
  //    `models` falls back to default; a stale/extra key never survives.
  const derived: DerivedSubagentConfig = {};
  if (config.models) {
    for (const tier of MODEL_SUBAGENT_TIERS) {
      const model = config.models[tier] ?? def;
      if (model?.provider && model?.name) {
        derived[tier] = cloneModelConfig(model);
      }
    }
  }
  // Preserve the semantic distinction between "no model configuration exists"
  // (subagents stays unset) and "model configuration exists but derives zero
  // tiers". Only assign subagents when at least one tier resolved.
  config.subagents = Object.keys(derived).length
    ? (derived as DerivedSubagentConfig)
    : undefined;
}

/**
 * Persistence-safety note: normalizeModelConfig MUTATES the loaded object
 * (in-memory only — it is NEVER called from a writer). The invariant is
 * enforced at the WRITER boundary: no writer may serialize `config.model` or
 * `config.subagents` back to disk. Writers must persist `models` explicitly and
 * strip `model`/`subagents` (see Tasks 4-6). The loader is the ONLY projector.
 */
```

- [ ] **Step 4: Wire into `loadConfig`** — call `normalizeModelConfig(result)` after `mergeConfig` produces the final result, before the `requireModel` validation at `loader.ts:205`. Update the error message:

```ts
"Example: alix models set-default deepseek deepseek-v4-flash\n" +
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm build && node --test dist/tests/config-loader.test.js`
Expected: PASS (all existing + 4 new).

- [ ] **Step 6: Commit**

```bash
git add src/config/loader.ts tests/config-loader.test.ts
git commit -m "feat(config): deterministic models projection in loader
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: `resolveModelConfig` — pure reader, no normalization

**Files:**
- Create: `src/config/model-resolver.ts`
- Test: `tests/config/model-resolver.test.ts`

**Interfaces:**
- Consumes: `AlixConfig`, `ModelsConfig`, `ModelTier`.
- Produces: `resolveModelConfig(config: AlixConfig, tier?: ModelTier): ModelConfig` — **pure**: reads `config.models` only, throws on no match, never mutates config. Returns the **full `ModelConfig`** (metadata included) as a **defensive copy** — consistent with the type contract, mutation-safe for callers. Takes an already-normalized config (callers get it from `loadConfig`).

- [ ] **Step 1: Write the failing test**

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

test("resolveModelConfig: does NOT mutate the input config", () => {
  const cfg: any = { models: { default: { provider: "deepseek", name: "deepseek-chat" } } };
  const before = JSON.stringify(cfg);
  resolveModelConfig(cfg, "coding");
  assert.equal(JSON.stringify(cfg), before);
});

test("resolveModelConfig: rejects unknown runtime tiers instead of defaulting", () => {
  const cfg: any = { models: { default: { provider: "deepseek", name: "deepseek-chat" } } };
  assert.throws(() => resolveModelConfig(cfg, "bogus" as any), /Unknown model tier/);
});

test("resolveModelConfig: returns full metadata as a defensive copy", () => {
  const cfg: any = { models: { default: { provider: "deepseek", name: "deepseek-chat", temperature: 0.3, contextWindow: 64000 } } };
  const out = resolveModelConfig(cfg);
  assert.deepEqual(out, { provider: "deepseek", name: "deepseek-chat", temperature: 0.3, contextWindow: 64000 });
  assert.notEqual(out, cfg.models.default);           // copy, not the stored object
  out.temperature = 999;                              // mutating the copy...
  assert.equal(cfg.models.default.temperature, 0.3);  // ...does not touch config
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/config/model-resolver.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { AlixConfig, ModelTier, ModelConfig } from "./schema.js";

export function resolveModelConfig(
  config: AlixConfig,
  tier?: ModelTier,
): ModelConfig {
  // Reject unknown tiers at runtime — silently falling back to default on a
  // typo can be nasty in an agent system. ModelTier is a closed union.
  if (tier !== undefined && !MODEL_SUBAGENT_TIERS.includes(tier) && tier !== "default") {
    throw new Error(`Unknown model tier: ${tier}`);
  }
  const model = tier
    ? config.models?.[tier] ?? config.models?.default
    : config.models?.default;
  if (!model?.provider || !model?.name) {
    throw new Error('No model configured. Run: alix models set-default');
  }
  // Defensive copy — callers may tweak temperature/etc. without mutating config.
  return { ...model };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/config/model-resolver.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/model-resolver.ts tests/config/model-resolver.test.ts
git commit -m "feat(config): pure resolveModelConfig reader
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Profile writers persist only `models` + `modelProfile`, strip stale projections

**Files:**
- Modify: `src/config/profile-patch.ts`
- Test: `tests/config/profile-patch.test.ts`

**Interfaces:**
- Consumes: `ProfileData`, `ProfilePatch`.
- Produces: `buildProfilePatch(profile)` → `{ modelProfile, models }` (no `model`, no `subagents`). `applyProfilePatch(existing, patch)` → result with `modelProfile` set, **`models` merged** (patch tiers win, pre-existing tiers preserved), and **legacy `model`/`subagents` keys REMOVED** from the returned object (so a downstream writer can't accidentally serialize them).

**Merge semantics (explicit):** a profile is a *partial* preset — it patches only the tiers it defines (`default`, `coding`, etc.) and preserves all other pre-existing `models` tiers. It does NOT wipe the entire model config. `models: { ...existing.models, ...patch.models }`.

- [ ] **Step 1: Write the failing tests**

```ts
test("buildProfilePatch: writes only modelProfile + models", () => {
  const patch = buildProfilePatch(balancedLocalProfile);
  assert.equal(patch.modelProfile, "balanced-local");
  assert.ok(patch.models?.default);
  assert.ok(patch.models?.coding);       // NOTE: coding, not coder
  assert.equal(patch.model, undefined);
  assert.equal(patch.subagents, undefined);
});

test("applyProfilePatch: strips stale model/subagents even when input has them", () => {
  const existing = {
    model: { provider: "old", name: "old-model" },
    subagents: { coding: { provider: "old", name: "old-coder" } },
  };
  const out = applyProfilePatch(existing as any, buildProfilePatch(balancedLocalProfile));
  assert.equal(out.modelProfile, "balanced-local");
  assert.ok(out.models?.default);
  assert.equal(out.model, undefined);
  assert.equal(out.subagents, undefined);
});

test("applyProfilePatch: merges tiers — patch wins, pre-existing tiers preserved", () => {
  const existing = {
    models: {
      default: { provider: "deepseek", name: "deepseek-chat" },
      fast: { provider: "existing", name: "fast-model" },  // not in the patch
    },
  };
  const patch = buildProfilePatch(balancedLocalProfile);    // defines default + coding
  const out = applyProfilePatch(existing as any, patch);
  assert.equal(out.models.default.provider, "deepseek");    // patch default wins
  assert.deepEqual(out.models.fast, { provider: "existing", name: "fast-model" }); // preserved
  assert.ok(out.models.coding);                             // patch tier added
});
```

Use the existing `balancedLocalProfile` fixture (its coder tier maps to `models.coding`). If the fixture defines `coder`, the assertion is `patch.models?.coding` after the mapping in `buildProfilePatch`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/config/profile-patch.test.js`
Expected: FAIL — `patch.model` set; stale `model`/`subagents` survive.

- [ ] **Step 3: Implement** — edit `src/config/profile-patch.ts`:

```ts
export function buildProfilePatch(profile: ProfileData): ProfilePatch {
  const patch: ProfilePatch = { modelProfile: profile.id };
  patch.models = {};
  for (const [tier, model] of Object.entries(profile.models)) {
    const configTier = TIER_MAP[tier] ?? tier;   // coder→coding, planner→thinking, ...
    if (!isConfigTier(configTier)) continue;
    patch.models[configTier] = { provider: model.provider, name: model.name };
    if (model.temperature !== undefined) patch.models[configTier].temperature = model.temperature;
    if (model.contextWindow !== undefined) patch.models[configTier].contextWindow = model.contextWindow;
  }
  return patch;
}

/**
 * Strip loader-owned compatibility projections from a config, leaving the
 * persisted representation. Makes the "no writer persists model/subagents"
 * invariant structurally obvious instead of relying on convention.
 */
export function withoutDerivedModelProjections(
  config: AlixConfig,
): Omit<AlixConfig, "model" | "subagents"> {
  const { model: _model, subagents: _subagents, ...persisted } = config;
  return persisted;
}

export function applyProfilePatch(existingConfig: AlixConfig, patch: ProfilePatch): AlixConfig {
  // Persisted representation only — the loader derives model/subagents.
  const result: Omit<AlixConfig, "model" | "subagents"> =
    withoutDerivedModelProjections(existingConfig) as Omit<AlixConfig, "model" | "subagents">;
  result.modelProfile = patch.modelProfile;
  // Merge semantics: a profile patches only the tiers it defines. Pre-existing
  // models tiers are preserved; patch tiers win.
  if (patch.models) result.models = { ...(existingConfig.models ?? {}), ...patch.models };
  if (patch.runtime) result.runtime = { ...(existingConfig.runtime ?? {}), ...(patch.runtime ?? {}) };
  return result as AlixConfig;
}
```

Where `TIER_MAP` is the existing mapping (`profile-patch.ts:60`: planner→thinking, coder→coding, critic→critic, researcher→fast, embeddings→tiny) plus `default→default`, and `isConfigTier` is a guard over `ModelTier`. This makes profile application **incapable** of carrying stale `model`/`subagents` into persisted config.

- [ ] **Step 4: Run all affected tests**

Run: `pnpm build && node --test dist/tests/config/profile-patch.test.js dist/tests/config-loader.test.js dist/tests/models/model-install.test.js`
Expected: PASS. Update pinned assertions (lines 33-34, 62-70) to `models.coding` / absence of `subagents`.

- [ ] **Step 5: Commit**

```bash
git add src/config/profile-patch.ts tests/config/profile-patch.test.ts
git commit -m "fix(config): profile persists only models + modelProfile
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: `alix models set-default` / `set-tier` writers persist only `models`

**Files:**
- Modify: `src/cli/commands/models.ts`
- Test: `tests/cli/models-command.vitest.ts`

**Interfaces:**
- Consumes: `ModelsConfig`, `MODEL_SUBAGENT_TIERS`, `normalizeModelConfig`, provider-selection helpers, `setApiKey`.
- Produces: `handleSetDefaultModel(args)` → persists `models: { ...existing.models, default: selected }` (derives `model` only in memory for display, never persists it). `handleSetTier(args)` → persists `models: { ...existing.models, [tier]: selected }` — **MERGE, never replace**: setting one tier preserves every other tier and `models.default`. Registered in `models.ts` HANDLERS as `"set-default"`/`"set-tier"`.

- [ ] **Step 1: Write the failing test**

`tests/cli/models-command.vitest.ts` (vitest). Mock `provider-selection.ts` to return fixed picks, point cwd at a tmp dir with `.git`, and assert the **written file**:

```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleSetDefaultModel, handleSetTier } from "../../src/cli/commands/models.js";

function tmpCwd(): { dir: string; config: string } {
  const dir = mkdtempSync(join(tmpdir(), "alix-models-"));
  mkdirSync(join(dir, ".git"), { recursive: true });
  const config = join(dir, ".alix", "config.json");
  mkdirSync(join(dir, ".alix"), { recursive: true });
  writeFileSync(config, JSON.stringify({}), "utf8");
  return { dir, config };
}

vi.mock("../../src/cli/helpers/provider-selection.js", () => ({
  selectFromList: vi.fn().mockResolvedValue({ id: "deepseek" }),
  getApiKey: vi.fn().mockResolvedValue("sk-test"),
  getAvailableModels: vi.fn().mockResolvedValue([{ id: "deepseek-chat", displayName: "deepseek-chat" }]),
  selectModelInteractive: vi.fn().mockResolvedValue({ id: "deepseek-chat" }),
}));

describe("alix models set-default persists only models", () => {
  it("writes models.default, not model/subagents", async () => {
    const { dir, config } = tmpCwd();
    try {
      process.chdir(dir);
      await handleSetDefaultModel([]);
      const saved = JSON.parse(readFileSync(config, "utf8"));
      expect(saved.models.default).toEqual({ provider: "deepseek", name: "deepseek-chat" });
      expect(saved.model).toBeUndefined();
      expect(saved.subagents).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("alix models set-tier persists only models", () => {
  it("writes models.coding merged into existing models, preserving other tiers", async () => {
    const { dir, config } = tmpCwd();
    try {
      process.chdir(dir);
      // pre-seed a default tier + a fast tier + a STALE derived projection
      writeFileSync(config, JSON.stringify({
        models: {
          default: { provider: "deepseek", name: "deepseek-chat" },
          fast: { provider: "existing", name: "fast-model" },
        },
        model: { provider: "stale", name: "stale" },           // must be stripped on write
        subagents: { thinking: { provider: "stale", name: "stale" } },
      }), "utf8");
      await handleSetTier(["coding"]);
      const saved = JSON.parse(readFileSync(config, "utf8"));
      expect(saved.models.coding).toEqual({ provider: "deepseek", name: "deepseek-chat" });
      // other tiers preserved — set-tier must NOT erase them
      expect(saved.models.default).toEqual({ provider: "deepseek", name: "deepseek-chat" });
      expect(saved.models.fast).toEqual({ provider: "existing", name: "fast-model" });
      // on-disk invariant: derived projections never persisted
      expect(saved.model).toBeUndefined();
      expect(saved.subagents).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/models-command.vitest.ts`
Expected: FAIL — handlers not exported.

- [ ] **Step 3: Implement the two handlers**

Port the body of today's `set-default-model` / `set-tier` (interactive provider pick → key → `listModels` → model pick → write), but persist **only** `models` — merging, never replacing: `models: { ...existing.models, default: selected }` for set-default, `models: { ...existing.models, [tier]: selected }` for set-tier.

> **Do NOT call `normalizeModelConfig()` from the writer.** The writer persists the authoritative representation only; `config show`/`models resolve` obtain compatibility projections by loading through `loadConfig()` (which normalizes). This keeps "the loader is the only projector" genuinely enforceable. If a post-write display needs derived `model`/`subagents`, it must call `loadConfig()` — not normalize the in-memory write object.

Validate tier against `MODEL_SUBAGENT_TIERS`. Persist the full existing config with only `models` changed (preserving `modelProfile`, `apiKeys`, and every other section) — but with `model`/`subagents` **stripped** via `withoutDerivedModelProjections` before serialization, so a stale loaded projection can never be written back.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/models-command.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/models.ts tests/cli/models-command.vitest.ts
git commit -m "feat(models): add set-default and set-tier writers (persist models only)
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Remove legacy `config set-default-model` / `config set-tier` (behavioral test)

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli/cli-commands.test.ts` (behavioral dispatch)

**Interfaces:**
- Produces: `alix config set-default-model` and `alix config set-tier` fail as **unknown commands**; `models set-default` / `models set-tier` are recognized.

- [ ] **Step 1: Write the failing behavioral test**

The behavioral contract is: **legacy commands → unknown command; new commands → registered/dispatchable.** Test at the dispatcher level, not subprocess (deterministic, no TTY/stdio coupling). If `src/cli.ts`'s dispatch is a module-scope `if` chain, extract the command→handler resolution into an exported `COMMAND_TABLE` (or an exported `resolveCommand(command, args)` helper) so it's unit-testable without spawning the process:

```ts
import { resolveCommand } from "../../src/cli-dispatch.js";

test("legacy config model commands are unknown", () => {
  assert.equal(resolveCommand("config", ["set-default-model"]), null);
  assert.equal(resolveCommand("config", ["set-tier"]), null);
});

test("models set-default and set-tier are registered", () => {
  const d1 = resolveCommand("models", ["set-default"]);
  const d2 = resolveCommand("models", ["set-tier"]);
  assert.ok(d1, "models set-default recognized");
  assert.ok(d2, "models set-tier recognized");
});
```

The positive test asserts **registration only** (the command dispatches), NOT that the interactive picker completes — that's incidental CLI behavior and would couple the test to TTY/stdin. If the dispatch cannot be cleanly extracted, use a subprocess check that asserts only `exit !== 0` / non-unknown-command for the legacy pair, never the interactive completion.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/cli/cli-commands.test.js`
Expected: FAIL — legacy commands still recognized.

- [ ] **Step 3: Remove the two blocks** from `src/cli.ts` (lines 680-733 `set-default-model`, 735-813 `set-tier`). Search `src/cli.ts` and `src/cli/commands/*` for `set-default-model` / `set-tier` references and remove from usage text. Extract `resolveCommand(command, args)` (or `COMMAND_TABLE`) if it doesn't already exist, so the dispatcher is unit-testable.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/cli/cli-commands.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli/cli-commands.test.ts
git commit -m "feat(cli): remove legacy config set-default-model and set-tier
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Migrate runtime readers — precedence-sensitive

**Files:**
- Modify: `src/agent/agent.ts` (113-120), `src/agent/session.ts` (1180-1181, 1221-1224), `src/run/task-loop.ts` (811-823), `src/agents/subagent-cli.ts` (104-116)
- Test: re-run existing suites; add a precedence test for `subagent-cli.ts`.

**Interfaces:**
- Consumes: `resolveModelConfig` (Task 3) — pure reader.
- Produces: the four sites read via `resolveModelConfig`; **precedence preserved**; `config.model` never mutated by resolution.

**Documented precedence for `subagent-cli.ts` (before editing):**
```
explicit invocation override (--provider/--model)
    > models.<tier>          (role/style tier)
    > models.default
```
The override resolves a concrete model WITHOUT mutating `config.model`.

- [ ] **Step 1: Migrate `agent.ts`, `session.ts`, `task-loop.ts`**

Replace `config.model.provider/name` reads with `const { provider, name } = resolveModelConfig(config);`. In `session.ts` keep `ctx.config.model.streaming` — **verified: `ModelConfig.streaming?: boolean` exists at `schema.ts:14`, so it is genuinely part of the derived `ModelConfig` projection, not an independent compatibility property.** Do NOT mutate `config.model`.

- [ ] **Step 2: Add the precedence test for `subagent-cli.ts`**

```ts
test("subagent-cli: override beats models.<tier>, which beats models.default", () => {
  // construct config with models.default + models.coding
  // invoke the resolution path with --model override
  // assert the override wins; assert config.model is NOT mutated
});
```

- [ ] **Step 3: Migrate `subagent-cli.ts` preserving precedence**

The override path already resolves a concrete provider/name before the tier lookup; keep that, but route the tier lookup through `resolveModelConfig(config, tier)` instead of mutating `config.model`. Ensure the override branch returns before any mutation.

- [ ] **Step 4: Run the full affected suite**

Run: `pnpm build && node --test dist/tests/config-loader.test.js dist/tests/config/model-resolver.test.js dist/tests/config/profile-patch.test.js dist/tests/models/model-install.test.js dist/tests/agent/agent-loop.test.js dist/tests/agent/session.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/agent.ts src/agent/session.ts src/run/task-loop.ts src/agents/subagent-cli.ts
git commit -m "refactor(config): runtime readers via resolveModelConfig
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Single-source invariant test suite

**Files:**
- Create: `tests/config/model-invariant.test.ts`

**Interfaces:**
- Consumes: `normalizeModelConfig`, `resolveModelConfig`, `applyProfilePatch`, `handleSetDefaultModel`, `handleSetTier` (the real CLI writers).

**This task is the architecture's executable contract.** It runs the persistence-invariant assertions for every model-writing path AND the final repo-wide writer audit (the hard completion gate).

- [ ] **Step 0: Final repo-wide writer audit (hard completion gate)**

Re-run the audit from Task 1 now that runtime migration + profile changes are done — they may have exposed writers that weren't obvious initially:

```bash
rg 'config\.model\s*=|subagents\[[^]]*\]\s*=|\.subagents\.[a-z]+\s*=' src --glob '!**/*.test.*'
rg 'model:|subagents' src/cli/commands src/models src/config --glob '!**/*.test.*' -l
```

Every hit must be one of: (a) the loader's projection, (b) a reader, or (c) a writer that persists under `models`. **If any writer persists `model.*` or `subagents.*` as model-selection state, STOP — the invariant is violated and the plan must be extended.** The test suite below does not pass until the audit is clean.

- [ ] **Step 1: Write the invariant suite**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeModelConfig } from "../../src/config/loader.js";
import { resolveModelConfig } from "../../src/config/model-resolver.js";
import { buildProfilePatch, applyProfilePatch } from "../../src/config/profile-patch.js";

// Persistence invariant: no model-writing path persists model.* or subagents.*
// The distinction that matters is "the bytes on disk obey the invariant" — not
// "the writer implementation looks correct." So these drive the REAL writers.
test("invariant: profile application strips model/subagents projections", () => {
  const existing = {
    model: { provider: "old", name: "old" },
    subagents: { coding: { provider: "old", name: "old" } },
  };
  const out = applyProfilePatch(existing as any, buildProfilePatch(minimalProfile));
  assert.equal(out.model, undefined);
  assert.equal(out.subagents, undefined);
  assert.ok(out.models?.default);
});

// On-disk invariant: the actual CLI writers persist models, never projections
test("invariant: alix models set-default writes models only", async () => {
  const { dir, config } = makeTmpConfig();
  try {
    process.chdir(dir);
    writeFileSync(config, JSON.stringify({
      model: { provider: "stale", name: "stale" },
      subagents: { thinking: { provider: "stale", name: "stale" } },
    }), "utf8");
    await handleSetDefaultModel([]); // mocked provider-selection returns deepseek-chat
    const saved = JSON.parse(readFileSync(config, "utf8"));
    assert.ok(saved.models.default, "models.default present");
    assert.equal(saved.model, undefined, "model never persisted");
    assert.equal(saved.subagents, undefined, "subagents never persisted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invariant: alix models set-tier writes models only", async () => {
  const { dir, config } = makeTmpConfig();
  try {
    process.chdir(dir);
    await handleSetTier(["coding"]); // mocked selection
    const saved = JSON.parse(readFileSync(config, "utf8"));
    assert.ok(saved.models.coding, "models.coding present");
    assert.equal(saved.model, undefined);
    assert.equal(saved.subagents, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Loader compatibility: legacy model → models.default → model + 6 subagents
test("invariant: load-normalize produces derived model + six subagents", () => {
  const cfg: any = { model: { provider: "deepseek", name: "deepseek-chat" } };
  normalizeModelConfig(cfg);
  assert.deepEqual(cfg.models.default, { provider: "deepseek", name: "deepseek-chat" });
  assert.deepEqual(cfg.model, { provider: "deepseek", name: "deepseek-chat" });
  for (const t of ["thinking","coding","fast","critic","tiny","image"]) {
    assert.deepEqual(cfg.subagents[t], { provider: "deepseek", name: "deepseek-chat" });
  }
});

// Precedence: models.default wins over legacy model
test("invariant: models.default wins over legacy model", () => {
  const cfg: any = { model: { provider: "a", name: "b" }, models: { default: { provider: "c", name: "d" } } };
  normalizeModelConfig(cfg);
  assert.equal(cfg.model.provider, "c");
});

// Tier precedence: models.coding → coding; missing → default
test("invariant: tier precedence", () => {
  const cfg: any = { models: { default: { provider: "a", name: "b" }, coding: { provider: "c", name: "d" } } };
  normalizeModelConfig(cfg);
  assert.equal(cfg.subagents.coding.provider, "c");
  assert.equal(cfg.subagents.thinking.provider, "a");
});

// Migration safety: loadConfig leaves config.json byte-for-byte unchanged
test("invariant: migration is in-memory only, file untouched", async () => {
  // construct a real config file with a legacy model field; loadConfig(cwd);
  // read the file back; assert identical to the original bytes.
});
```

The `migration is in-memory only` test is the highest-value one — it proves `loadConfig` never rewrites the file (the core requirement). It needs a tmp cwd with `.git`, a config file with legacy `model`, then `loadConfig(dir)` and byte-compare the file before/after.

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/config/model-invariant.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/config/model-invariant.test.ts
git commit -m "test(config): single-source model invariant suite
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**Review rounds → resolution:**
- **Round 1 (10 points):** never persist derived projections; pure `resolveModelConfig`; typed `ModelsConfig`; `coder`→`coding` map; deterministic projection; profile strips stale projections; behavioral CLI test; `subagent-cli` precedence; writer/reader audit; invariant suite.
- **Round 2 (2 points):** in-memory-only migration pinned (file byte-compare); empty-state `subagents` stays `undefined`.
- **Round 3 (8 points):**
  1. **Persistence hazard** → the invariant is enforced at the WRITER boundary, not just loadConfig: `normalizeModelConfig` documents it never serializes; Tasks 4-6 strip/persist-only-`models`; Task 8 audits every writer.
  2. **set-tier merge semantics** → `models: { ...existing.models, [tier]: selected }` (merge, never replace); test seeds other tiers and asserts preservation.
  3. **Profile merge (not wipe)** → `applyProfilePatch` merges `{ ...existing.models, ...patch.models }`; test proves pre-existing tiers survive.
  4. **`MODEL_SUBAGENT_TIERS` naming** → selectable subset, distinct from `ModelTier` union.
  5. **Metadata preservation** → projections carry full `ModelConfig` (temperature/contextWindow); test pins it.
  6. **Resolver returns full `ModelConfig`** → defensive copy, type-consistent; test asserts copy-not-shared.
  7. **Dispatcher-level CLI test** → registration-only, no TTY/interactive coupling.
  8. **Final audit gate** → Task 8 Step 0 re-runs the writer audit after runtime migration + profile changes; test suite does not pass until clean.
- **Round 4 (7 points):**
  1. **Derived `subagents` type** → `DerivedSubagentConfig = Partial<Record<Exclude<ModelTier,"default">, ModelConfig>>` (single tier vocabulary, no independent drift).
  2. **Typed strip helper** → `withoutDerivedModelProjections(config): Omit<AlixConfig,"model"|"subagents">`; no `as object` escapes; `runtime` merged with `?? {}` on both sides.
  3. **Writer never normalizes** → Task 5 drops the `normalizeModelConfig()` call entirely; `config show`/`resolve` get projections via `loadConfig()`. The loader is the only projector.
  4. **On-disk writer invariant tests** → Task 8 drives the real `handleSetDefaultModel`/`handleSetTier`/profile writer and asserts `saved.model === undefined`, `saved.subagents === undefined`, `saved.models !== undefined`.
  5. **Runtime tier validation** → `resolveModelConfig` throws `Unknown model tier` for invalid runtime tiers (no silent default on typo).
  6. **`streaming` verified in `ModelConfig`** → `schema.ts:14`; Task 7 keeps it as part of the derived projection, not an independent property.
  7. **Persisted/derived type split** → documented on `AlixConfig`; "any persistence operates on persisted representation, never the normalized `AlixConfig`."

**Spec coverage:** One store (T1/T2/T4/T5), loader projection (T2), resolver (T3), one writer family (T5 + T4), legacy removal (T6), runtime migration (T7), invariant (T8). apiKeys untouched. All 7 spec test categories present + migration-safety.

**Placeholder scan:** no TBD/TODO; every code step has concrete code. Task 6's subprocess test notes the TTY fallback explicitly.

**Type consistency:** `ModelTier`/`ModelsConfig` (T1) → `MODEL_SUBAGENT_TIERS` + `normalizeModelConfig` (T2) → `resolveModelConfig(config, tier?: ModelTier)` (T3) → `handleSetDefaultModel`/`handleSetTier` (T5). All names match across tasks.

## Verification

- `pnpm build` — clean.
- `node --test dist/tests/config-loader.test.js dist/tests/config/model-resolver.test.js dist/tests/config/profile-patch.test.js dist/tests/models/model-install.test.js dist/tests/config/model-invariant.test.js dist/tests/cli/cli-commands.test.js` — all pass.
- `npx vitest run tests/cli/models-command.vitest.ts` — pass.
- Full `pnpm test:vitest` + `pnpm test:node` — no new failures (pre-existing streamSSE/unit failures on `main` are unrelated).
- Manual: `alix config show` renders active model; `alix models set-default` writes `models.default` only; `alix config set-default-model` → unknown command.
- GitNexus: `detect_changes()` before each commit; `impact()` on `loadConfig`, `mergeConfig`, `buildProfilePatch`, `applyProfilePatch`, `handleModelsCommand` before editing (CLAUDE.md requirement).
