# Single-Source Model Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `models` the single persistent source of model assignments; `model` and `subagents.*` become loader-owned, in-memory compatibility projections; collapse all model writers into the `alix models` family; remove the legacy `config set-default-model` / `config set-tier` commands.

**The single invariant:** Persisted model selection has exactly one source of truth: `models`. `modelProfile` is provenance/metadata only (it identifies *how* models were selected, never participates in resolution). `model` and `subagents` are loader-owned, in-memory compatibility projections and MUST NOT participate in model resolution or persistence.

**Architecture (three layers):**
1. **Persisted representation** — only `models` and `modelProfile` hold model-selection state on disk. `model` and `subagents.*` are NEVER persisted by any writer.
2. **Loader compatibility projection** — `loadConfig()` produces, in memory only: `models` (authoritative), `model := models.default` (derived), `subagents[tier] := models.<tier> ?? models.default` (derived). The loader is the ONLY projector.
3. **Runtime resolution** — new code calls `resolveModelConfig(config, tier?)` (a **pure reader**, never mutates config); it reads `models` ONLY and knows nothing about `modelProfile`.

**Tech Stack:** TypeScript strict, node:test (`*.test.ts`) + vitest (`*.vitest.ts`), conventional commits.

## Global Constraints

- **The invariant (load-bearing):** No configuration writer may persist `model.*` or `subagents.<tier>` as an independent model assignment. All persisted model assignments MUST originate under `models`. `model` and `subagents.*` exist solely as compatibility projections.
- **Migration is in-memory only** — `loadConfig()` never rewrites `config.json`; a config file with a legacy `model` field is left byte-for-byte untouched on load.
- **Precedence:** `models.default` is authoritative; legacy `model` only seeds it when absent; when both present, `models.default` wins.
- **Legacy-migration semantics (explicit):** "absent" means `models.default === undefined`. `models.default` wins whenever the property *exists* (even if it's an invalid/empty object — presence is authoritative); legacy `model` is used ONLY when `models.default === undefined`. A legacy model is migrated only if it contains a valid `{provider, name}` pair. This is unambiguous by construction.
- **Tier precedence:** `subagents[tier] := models.<tier> ?? models.default`.
- `apiKeys` remains separate — never coupled to model selection.
- `modelProfile` is provenance/metadata only — it identifies which preset selected the `models`, and **never participates in runtime resolution**. `resolveModelConfig` must know nothing about it.
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
// Single-source vocabulary — the const tuple IS the type, no drift possible.
export const MODEL_TIER_VALUES = [
  "default", "thinking", "coding", "fast", "critic", "tiny", "image",
] as const;
export type ModelTier = typeof MODEL_TIER_VALUES[number];

export const MODEL_SUBAGENT_TIERS = [
  "thinking", "coding", "fast", "critic", "tiny", "image",
] as const;

export type ModelsConfig = Partial<Record<ModelTier, ModelConfig>>;

/** Loader-owned compatibility projection — one tier vocabulary. */
export type DerivedSubagentConfig = Partial<Record<Exclude<ModelTier, "default">, ModelConfig>>;

/**
 * Persisted representation — NOMINALLY distinct from AlixConfig, not just a
 * narrower Omit. A structural Omit alone does NOT reject a normalized
 * AlixConfig (extra properties are assignable). The brand makes the two
 * representations incomparable, so `writeConfig(config: PersistedAlixConfig)`
 * genuinely refuses a normalized object unless it passed through the strip
 * function that constructs the brand.
 */
export interface PersistedAlixConfig
  extends Omit<AlixConfig, "model" | "subagents"> {
  /** Nominal brand — constructed only by withoutDerivedModelProjections. */
  readonly __persistedConfigBrand?: never;
}

/** Runtime guard for arbitrary tier strings at an external boundary
 *  (CLI arg, config file). Uses the canonical tuple — no separately
 *  maintained array to drift. NOT used inside resolveModelConfig. */
export function isModelTier(value: string): value is ModelTier {
  return (MODEL_TIER_VALUES as readonly string[]).includes(value);
}
```

Change `AlixConfig.models?: Record<string, { provider: string; name: string; temperature?: number; contextWindow?: number }>` → `models?: ModelsConfig`.

Document the persisted-vs-derived split on `AlixConfig`:
- **Persisted** (written to disk): `models`, `modelProfile`, `apiKeys`, everything else — typed as `PersistedAlixConfig`.
- **Loader-owned projections** (never persisted): `model?: ModelConfig` (derived from `models.default`), `subagents?: DerivedSubagentConfig` (derived from `models.*`).
- **The rule, compile-time enforced:** any persistence operation must accept only `PersistedAlixConfig` — nominally branded, so a raw `AlixConfig` (even held in a variable, which a plain `Omit` would accept) is refused unless it passed through `withoutDerivedModelProjections`. `MODEL_TIER_VALUES` is the canonical tuple `ModelTier` is derived from; `MODEL_SUBAGENT_TIERS` is the non-default subset.

- [ ] **Step 2: Align `profile-types.ts` `ModelTier`**

`src/config/profile-types.ts:8-15` defines `ModelTier` as `default | planner | researcher | coder | critic | embeddings | classifier`. These are *profile* tier names, distinct from the *config* `ModelTier`. Rename the profile one to `ProfileModelTier` and note it's a preset vocabulary that maps onto config tiers. **Resolve the `coder` vs `coding` inconsistency with a typed map** (moves to `profile-patch.ts`, but the type is defined here):

```ts
/** Profile-tier vocabulary → config-tier vocabulary. `undefined` = no mapping. */
export const PROFILE_TIER_MAP: Record<ProfileModelTier, ModelTier | undefined> = {
  default: "default",
  planner: "thinking",
  researcher: "fast",
  coder: "coding",
  critic: "critic",
  embeddings: "tiny",
  classifier: undefined,
};
```

The compiler forces the profile vocabulary and config vocabulary to stay synchronized — an unhandled profile tier is a compile error, not a runtime `?? tier` leak. Do NOT introduce a `coder` config tier.

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
- Consumes: `AlixConfig`, `DerivedSubagentConfig`, `ModelConfig`, `ModelTier`, `MODEL_SUBAGENT_TIERS` — all **imported** from `./schema.js` (defined ONCE in Task 1; no redeclaration here).
- Produces: `export function normalizeModelConfig(config: Partial<AlixConfig>): void` — mutates in place; **deterministically replaces BOTH projections** (`model` AND `subagents`) wholesale so no stale compatibility state survives. **Preserves full `ModelConfig` metadata** — projections carry `temperature`/`contextWindow`/`maxOutputTokens` through, not just `{provider, name}`.

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

test("normalizeModelConfig: invalid authoritative default is NOT a fallback", () => {
  const cfg: any = {
    models: {
      default: { provider: "", name: "" },   // invalid default
      coding: { provider: "openai", name: "gpt-4o" },
    },
  };
  normalizeModelConfig(cfg);
  assert.equal(cfg.model, undefined);                       // no model projection
  assert.deepEqual(cfg.subagents.coding, { provider: "openai", name: "gpt-4o" });
  assert.equal(cfg.subagents.thinking, undefined);          // NOT a fallback to invalid default
  assert.equal(cfg.subagents.fast, undefined);
});

test("normalizeModelConfig: clears stale model when models has no valid default", () => {
  const cfg: any = {
    models: { coding: { provider: "openai", name: "gpt-4o" } },  // no default
    model: { provider: "stale", name: "stale" },                  // stale projection
  };
  normalizeModelConfig(cfg);
  assert.equal(cfg.model, undefined);  // no valid default → model cleared, not kept stale
  assert.deepEqual(cfg.subagents.coding, { provider: "openai", name: "gpt-4o" });
});

test("normalizeModelConfig: invalid-but-present models.default wins over legacy model", () => {
  const cfg: any = {
    models: { default: { provider: "", name: "" } },  // present but invalid
    model: { provider: "legacy", name: "legacy" },     // must NOT migrate
  };
  normalizeModelConfig(cfg);
  // presence is authoritative: legacy model did not seed models.default...
  assert.deepEqual(cfg.models.default, { provider: "", name: "" });
  // ...and model projection is cleared (no valid default to project)
  assert.equal(cfg.model, undefined);
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
import {
  MODEL_SUBAGENT_TIERS,
  type AlixConfig,
  type DerivedSubagentConfig,
  type ModelConfig,
  type ModelTier,
} from "./schema.js";

// MODEL_SUBAGENT_TIERS lives in schema.ts — it is a domain constant, not a
// loader concern. The loader imports it; the vocabulary is single-source.

/** Copy a ModelConfig carrying full metadata, not just provider/name. */
function cloneModelConfig(m: ModelConfig): ModelConfig {
  return { ...m };
}

export function normalizeModelConfig(config: Partial<AlixConfig>): void {
  // 1. Legacy `model` → `models.default` (only when models.default === undefined).
  //    Two conditions, both required:
  //      a. models.default is absent (presence wins regardless of validity), AND
  //      b. the legacy model itself is a valid {provider, name} pair.
  if (config.models?.default === undefined && config.model?.provider && config.model?.name) {
    config.models = { ...(config.models ?? {}), default: cloneModelConfig(config.model) };
  }
  // 2. Deterministic model projection — clear stale model when default is
  //    absent/invalid, exactly as subagents is cleared below.
  const def = config.models?.default;
  config.model = def?.provider && def?.name
    ? cloneModelConfig(def)
    : undefined;
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
    ? derived
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
- Consumes: `AlixConfig`, `ModelTier`.
- Produces: `resolveModelConfig(config: AlixConfig, tier?: ModelTier): ModelConfig` — **pure**: reads `config.models` only, throws on no match, never mutates config. Returns the **full `ModelConfig`** (metadata included) as a **defensive copy** — consistent with the type contract, mutation-safe for callers. Takes an already-normalized config (callers get it from `loadConfig`).
- **Boundary validation, not in the resolver:** the resolver's `tier?: ModelTier` contract already guarantees a legal value. Arbitrary strings from CLI/config enter via `isModelTier(value)` (Task 1) at the external boundary, BEFORE calling the resolver. The resolver itself has no unknown-tier guard.

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { resolveModelConfig } from "../../src/config/model-resolver.js";
import { isModelTier } from "../../src/config/schema.js";

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

test("isModelTier: boundary guard accepts legal tiers, rejects typos", () => {
  assert.ok(isModelTier("coding"));
  assert.ok(isModelTier("default"));
  assert.ok(!isModelTier("bogus"));
  assert.ok(!isModelTier("coder"));  // profile tier, not a config tier
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
  const model =
    tier === undefined || tier === "default"
      ? config.models?.default
      : config.models?.[tier] ?? config.models?.default;
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

### Task 4: Persistence module — shared strip helper + type-enforced `writeConfig`

**Files:**
- Create: `src/config/persistence.ts`
- Test: `tests/config/persistence.test.ts`

**Interfaces:**
- Consumes: `AlixConfig`, `PersistedAlixConfig` (Task 1).
- Produces: the single shared persistence boundary every writer uses:

```ts
// src/config/persistence.ts
import type { AlixConfig, PersistedAlixConfig } from "./schema.js";

/** Strip loader-owned projections, returning the NOMINALLY branded persisted
 *  representation. The brand (__persistedConfigBrand) means writeConfig's
 *  parameter type genuinely refuses a raw AlixConfig — a plain Omit would
 *  silently accept extra properties once held in a variable. */
export function withoutDerivedModelProjections(
  config: AlixConfig,
): PersistedAlixConfig {
  const { model: _model, subagents: _subagents, ...persisted } = config;
  return persisted as PersistedAlixConfig;
}

/** The ONLY write entrypoint — accepts only the branded PersistedAlixConfig. */
export async function writeConfig(
  config: PersistedAlixConfig,
  configPath: string,
): Promise<void> {
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}
```

`writeConfig`'s parameter type enforces the "never persist the normalized object" rule **at compile time, nominally** — a `model`/`subagents`-carrying `AlixConfig` is not assignable to `PersistedAlixConfig` (even held in a variable) unless it passed through `withoutDerivedModelProjections` and was branded. Profile writers, `models` writers, and any future config writer all route through this one boundary.

- [ ] **Step 1: Write the failing test**

```ts
import { withoutDerivedModelProjections, writeConfig } from "../../src/config/persistence.js";
import type { AlixConfig, PersistedAlixConfig } from "../../src/config/schema.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("withoutDerivedModelProjections: strips model and subagents", () => {
  const cfg: AlixConfig = {
    model: { provider: "a", name: "b" },
    subagents: { thinking: { provider: "a", name: "b" } },
    models: { default: { provider: "a", name: "b" } },
    apiKeys: { deepseek: "x" },
  } as AlixConfig;
  const persisted = withoutDerivedModelProjections(cfg);
  assert.equal(persisted.model, undefined);
  assert.equal(persisted.subagents, undefined);
  assert.ok(persisted.models.default);
  assert.ok(persisted.apiKeys.deepseek);
});

test("writeConfig: refuses a raw AlixConfig (compile-time nominal brand)", () => {
  // This is a TYPE-level assertion, not a runtime one: a raw AlixConfig is
  // not assignable to PersistedAlixConfig. Verify structurally in TS.
  const raw: AlixConfig = { model: { provider: "a", name: "b" } } as AlixConfig;
  // @ts-expect-error — raw AlixConfig (carrying model/subagents) is NOT
  // assignable to PersistedAlixConfig without passing the strip function.
  const _bad: PersistedAlixConfig = raw;
  const _ok: PersistedAlixConfig = withoutDerivedModelProjections(raw);
});

test("writeConfig: writes only persisted representation to disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "alix-persist-"));
  const path = join(dir, "config.json");
  try {
    const persisted = withoutDerivedModelProjections(
      { models: { default: { provider: "a", name: "b" } }, model: { provider: "x", name: "y" } } as AlixConfig,
    );
    await writeConfig(persisted, path);
    const saved = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(saved.models.default, { provider: "a", name: "b" });
    assert.equal(saved.model, undefined);
    assert.equal(saved.subagents, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/config/persistence.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/config/persistence.ts` as above. Add `writeFile` from `node:fs/promises`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/config/persistence.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/persistence.ts tests/config/persistence.test.ts
git commit -m "feat(config): shared persistence boundary (strip helper + typed writeConfig)
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Profile writers persist only `models` + `modelProfile`, strip stale projections

**Files:**
- Modify: `src/config/profile-patch.ts`
- Test: `tests/config/profile-patch.test.ts`

**Interfaces:**
- Consumes: `ProfileData`, `ProfilePatch`, `withoutDerivedModelProjections` (Task 4).
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
import { PROFILE_TIER_MAP } from "./profile-types.js";   // typed map, single-source vocab
import { withoutDerivedModelProjections } from "./persistence.js";
import type { PersistedAlixConfig } from "./schema.js";

export function buildProfilePatch(profile: ProfileData): ProfilePatch {
  const patch: ProfilePatch = { modelProfile: profile.id };
  patch.models = {};
  for (const [tier, model] of Object.entries(profile.models)) {
    const configTier = PROFILE_TIER_MAP[tier as ProfileModelTier];  // typed; undefined = skip
    if (configTier === undefined) continue;  // classifier → no config tier
    patch.models[configTier] = { provider: model.provider, name: model.name };
    if (model.temperature !== undefined) patch.models[configTier].temperature = model.temperature;
    if (model.contextWindow !== undefined) patch.models[configTier].contextWindow = model.contextWindow;
  }
  return patch;
}

export function applyProfilePatch(
  existingConfig: AlixConfig,
  patch: ProfilePatch,
): PersistedAlixConfig {
  // Returns the PERSISTED representation — the loader derives model/subagents.
  // withoutDerivedModelProjections brands the result as PersistedAlixConfig, so
  // a normalized AlixConfig can never be returned or accidentally re-serialized.
  const result = withoutDerivedModelProjections(existingConfig);
  result.modelProfile = patch.modelProfile;
  // Merge semantics: a profile patches only the tiers it defines. Pre-existing
  // models tiers are preserved; patch tiers win.
  if (patch.models) result.models = { ...(existingConfig.models ?? {}), ...patch.models };
  if (patch.runtime) result.runtime = { ...(existingConfig.runtime ?? {}), ...(patch.runtime ?? {}) };
  return result;
}
```

`PROFILE_TIER_MAP` (typed in `profile-types.ts`, Task 1) is the single mapping: `planner→thinking, researcher→fast, coder→coding, critic→critic, embeddings→tiny, default→default`, `classifier→undefined` (no config tier). `applyProfilePatch` returns `PersistedAlixConfig`, making the lifecycle obvious: `loadConfig() → AlixConfig → applyProfilePatch() → PersistedAlixConfig → writeConfig()`. This makes profile application **incapable** of carrying stale `model`/`subagents` into persisted config.

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

### Task 6: `alix models set-default` / `set-tier` writers persist only `models`

**Files:**
- Modify: `src/cli/commands/models.ts`
- Test: `tests/cli/models-command.vitest.ts`

**Interfaces:**
- Consumes: `ModelsConfig`, `MODEL_SUBAGENT_TIERS`, `isModelTier` (Task 1), `withoutDerivedModelProjections` + `writeConfig` (Task 4), provider-selection helpers, `setApiKey`.
- Produces: `handleSetDefaultModel(args)` → persists `models: { ...existing.models, default: selected }` (never persists `model`). `handleSetTier(args)` → persists `models: { ...existing.models, [tier]: selected }` — **MERGE, never replace**: setting one tier preserves every other tier and `models.default`. Registered in `models.ts` HANDLERS as `"set-default"`/`"set-tier"`.
- **Persistence flow (shared boundary, NOT normalize):**

```ts
// in each handler — read persisted, merge models, write through the one API
const existing = await loadConfig(cwd);              // normalized, has projections
const persisted = withoutDerivedModelProjections(existing);
persisted.models = { ...(persisted.models ?? {}), default: selected };
await writeConfig(persisted, configPath);            // writeConfig rejects a full AlixConfig
```

No `normalizeModelConfig` call in the writer — the loader is the only projector. Any post-write display loads through `loadConfig()`.

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

Port the body of today's `set-default-model` / `set-tier` (interactive provider pick → key → `listModels` → model pick → write), but persist **only** `models` — merging, never replacing, through the shared boundary from Task 4:

```ts
// for set-default
const existing = await loadConfig(cwd);
const persisted = withoutDerivedModelProjections(existing);
persisted.models = { ...(persisted.models ?? {}), default: selected };
await writeConfig(persisted, configPath);
// for set-tier
persisted.models = { ...(persisted.models ?? {}), [tier]: selected };
```

> **Do NOT call `normalizeModelConfig()` from the writer.** The writer persists the authoritative representation only; `config show`/`models resolve` obtain compatibility projections by loading through `loadConfig()` (which normalizes). This keeps "the loader is the only projector" genuinely enforceable. If a post-write display needs derived `model`/`subagents`, it must call `loadConfig()` — not normalize the in-memory write object.

Validate the tier arg with `isModelTier(tier)` (the external-boundary guard) before resolving. `writeConfig` (Task 4) strips/accepts only the persisted representation — a stale loaded projection can never be written back because the write API refuses a full `AlixConfig`.

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

### Task 7: Remove legacy `config set-default-model` / `config set-tier` (behavioral test)

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/cli/cli-commands.test.ts` (behavioral dispatch)

**Interfaces:**
- Produces: `alix config set-default-model` and `alix config set-tier` fail as **unknown commands**; `models set-default` / `models set-tier` are recognized.

- [ ] **Step 1: Write the failing behavioral test**

The behavioral contract is: **legacy commands → unknown command; new commands → registered.** `src/cli.ts` is a flat `if (command === ... && args[0] === ...)` chain (verified) — there is no command table to expose, so do NOT invent a `cli-dispatch.ts` solely for testability. Test the actual dispatch by invoking the built CLI as a subprocess, asserting only the public contract:

```ts
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../../bin/alix.js", import.meta.url));

test("legacy config model commands fail as unknown commands", () => {
  for (const args of [["config", "set-default-model"], ["config", "set-tier"]]) {
    assert.throws(
      () => execFileSync("node", [cli, ...args], { encoding: "utf8", stdio: "pipe" }),
      (e: any) => e.status !== 0 && /unknown command|not a command|unrecognized/i.test(e.stderr + e.stdout),
    );
  }
});

test("models set-default and set-tier are registered (NOT unknown)", () => {
  // Binary contract only:
  //   legacy → exit nonzero + "unknown command"
  //   new    → NOT "unknown command" (whatever else — usage, TTY, exit code —
  //             is handler behavior, not part of this contract)
  for (const args of [["models", "set-default"], ["models", "set-tier"]]) {
    let out = "";
    try {
      out = execFileSync("node", [cli, ...args], { encoding: "utf8", stdio: "pipe", input: "" });
    } catch (e: any) {
      out = (e.stdout ?? "") + (e.stderr ?? "");   // non-zero exit is fine; capture output
    }
    assert.ok(!/unknown command|not a command|unrecognized/i.test(out), `recognized: ${args.join(" ")}`);
  }
});
```

If `bin/alix.js` requires a TTY, assert `exit !== 0` for the legacy pair only (proving they're gone) and rely on the Task 6 handler tests for the new commands' behavior — never couple to the interactive completion.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/cli/cli-commands.test.js`
Expected: FAIL — legacy commands still recognized.

- [ ] **Step 3: Remove the two blocks** from `src/cli.ts` (lines 680-733 `set-default-model`, 735-813 `set-tier`). Search `src/cli.ts` and `src/cli/commands/*` for `set-default-model` / `set-tier` references and remove from usage text. Do NOT add a new dispatch module — the flat `if` chain is the dispatcher and the subprocess test covers it.

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

### Task 8: Migrate runtime readers — precedence-sensitive

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

### Task 9: Single-source invariant test suite

**Files:**
- Create: `tests/config/model-invariant.test.ts`

**Interfaces:**
- Consumes: `normalizeModelConfig`, `resolveModelConfig`, `applyProfilePatch`, `handleSetDefaultModel`, `handleSetTier` (the real CLI writers).

**This task is the architecture's executable contract — focused on CROSS-CUTTING invariants, not local handler details.** Its role is: "Could a future refactor accidentally violate the architecture while all local unit tests still pass?" Detailed per-handler assertions already live in Tasks 5/6; this suite proves the architectural properties that local tests can't see. It runs the persistence-invariant assertions for every model-writing path AND the final repo-wide writer audit (the hard completion gate).

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
// while the RUNTIME config gains models.default + derived projections.
test("invariant: migration is in-memory only — runtime normalized, disk untouched", async () => {
  const dir = makeTmpCwdWithConfig({
    model: { provider: "legacy", name: "legacy-model" },   // legacy, no models
  });
  try {
    const before = readFileSync(join(dir, ".alix", "config.json"), "utf8");
    const cfg = await loadConfig(dir);
    // runtime: models.default migrated
    assert.deepEqual(cfg.models?.default, { provider: "legacy", name: "legacy-model" });
    // runtime: derived projections present
    assert.deepEqual(cfg.model, { provider: "legacy", name: "legacy-model" });
    for (const t of ["thinking","coding","fast","critic","tiny","image"]) {
      assert.deepEqual(cfg.subagents?.[t], { provider: "legacy", name: "legacy-model" });
    }
    // disk: byte-for-byte unchanged — migration never rewrites the file
    const after = readFileSync(join(dir, ".alix", "config.json"), "utf8");
    assert.equal(after, before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

The `migration is in-memory only` test is the highest-value one — it proves BOTH sides of the contract simultaneously: the runtime config is fully normalized (`models.default` + derived `model` + derived `subagents`), AND `loadConfig` never rewrites the file (byte-compare before/after). It needs a tmp cwd with `.git`, a config file with legacy `model`, then `loadConfig(dir)`.

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
  1. **Persistence hazard** → the invariant is enforced at the WRITER boundary, not just loadConfig: `normalizeModelConfig` documents it never serializes; Tasks 4-6 strip/persist-only-`models`; Task 9 audits every writer.
  2. **set-tier merge semantics** → `models: { ...existing.models, [tier]: selected }` (merge, never replace); test seeds other tiers and asserts preservation.
  3. **Profile merge (not wipe)** → `applyProfilePatch` merges `{ ...existing.models, ...patch.models }`; test proves pre-existing tiers survive.
  4. **`MODEL_SUBAGENT_TIERS` naming** → selectable subset, distinct from `ModelTier` union.
  5. **Metadata preservation** → projections carry full `ModelConfig` (temperature/contextWindow); test pins it.
  6. **Resolver returns full `ModelConfig`** → defensive copy, type-consistent; test asserts copy-not-shared.
  7. **Dispatcher-level CLI test** → registration-only, no TTY/interactive coupling.
  8. **Final audit gate** → Task 9 Step 0 re-runs the writer audit after runtime migration + profile changes; test suite does not pass until clean.
- **Round 4 (7 points):**
  1. **Derived `subagents` type** → `DerivedSubagentConfig = Partial<Record<Exclude<ModelTier,"default">, ModelConfig>>` (single tier vocabulary, no independent drift).
  2. **Typed strip helper** → `withoutDerivedModelProjections(config): Omit<AlixConfig,"model"|"subagents">`; no `as object` escapes; `runtime` merged with `?? {}` on both sides.
  3. **Writer never normalizes** → Task 6 drops the `normalizeModelConfig()` call entirely; `config show`/`resolve` get projections via `loadConfig()`. The loader is the only projector.
  4. **On-disk writer invariant tests** → Task 9 drives the real `handleSetDefaultModel`/`handleSetTier`/profile writer and asserts `saved.model === undefined`, `saved.subagents === undefined`, `saved.models !== undefined`.
  5. **Runtime tier validation** → `isModelTier` at the external boundary rejects typos; `resolveModelConfig` stays typed and boring (its `tier?: ModelTier` contract already guarantees legality). No guard inside the resolver.
  6. **`streaming` verified in `ModelConfig`** → `schema.ts:14`; Task 8 keeps it as part of the derived projection, not an independent property.
  7. **Persisted/derived type split** → documented on `AlixConfig`; "any persistence operates on persisted representation, never the normalized `AlixConfig`."
- **Round 5 (9 points):**
  1. **`DerivedSubagentConfig` defined once** — in `schema.ts` (Task 1); Task 2 imports it, no redeclaration.
  2. **Stale `model` cleared** — `normalizeModelConfig` now deterministically clears `model` (as it does `subagents`) when no valid default; test pins it.
  3. **Legacy-migration semantics explicit** — `models.default` wins whenever the property *exists*; legacy `model` only when `models.default === undefined`; test pins invalid-but-present default.
  4. **`withoutDerivedModelProjections` moved** — out of `profile-patch.ts` into new `src/config/persistence.ts` (Task 4), shared by all writers.
  5. **`PersistedAlixConfig` type** — branded nominal type (see Round 6); `writeConfig` accepts ONLY it, enforcing the invariant at compile time.
  6. **`isModelTier` boundary guard** — validates arbitrary strings at the CLI/config boundary; `resolveModelConfig` stays clean (no impossible guard), uses the default/undefined ternary.
  7. **Task 7 subprocess test** — tests the real dispatch (flat `if` chain), no invented `cli-dispatch.ts`; asserts only registration, not interactive completion.
  8. **Task 9 focused on cross-cutting invariants** — the final audit gate + architectural properties, not duplicating local handler tests.
  9. **`modelProfile` is metadata-only** — never participates in resolution; `resolveModelConfig` knows nothing about it.
- **Round 6 (10 points):**
  1. **Branded `PersistedAlixConfig`** — nominal `__persistedConfigBrand`; a raw `AlixConfig` (even held in a variable) is refused by `writeConfig` unless it passed `withoutDerivedModelProjections`. `Omit` alone was structurally permissive.
  2. **Round-4/Task-3 contradiction resolved** — no `Unknown model tier` in the resolver; `isModelTier` is the sole boundary guard.
  3. **Invalid-authoritative-default test** — proves an invalid `models.default` is NOT a fallback for other tiers; pinned in Task 2.
  4. **Migration condition explicit** — legacy model migrated only if a valid `{provider,name}` pair; presence still wins.
  5. **`MODEL_SUBAGENT_TIERS` moved to `schema.ts`** — domain constant beside the canonical tuple, not a loader concern; loader imports it.
  6. **`MODEL_TIER_VALUES` const tuple** — `ModelTier = typeof MODEL_TIER_VALUES[number]`; type and runtime cannot drift.
  7. **Typed `PROFILE_TIER_MAP`** — `Record<ProfileModelTier, ModelTier | undefined>`; compiler keeps profile↔config vocabularies synchronized.
  8. **`applyProfilePatch` returns `PersistedAlixConfig`** — the load→patch→write lifecycle is type-explicit.
  9. **Migration test pins all three** — runtime `models.default` + derived `model` + derived `subagents`, AND disk bytes unchanged.
  10. **Task 7 new-command assertion sharpened** — binary contract: legacy = unknown; new = NOT unknown; no exit-status/TTY coupling.

**Spec coverage:** One store (T1/T2/T5/T6), loader projection (T2), resolver (T3), persistence boundary (T4), profile writer (T5), one writer family (T6), legacy removal (T7), runtime migration (T8), invariant (T9). apiKeys untouched. All 7 spec test categories present + migration-safety.

**Placeholder scan:** no TBD/TODO; every code step has concrete code. Task 7's subprocess test notes the TTY fallback explicitly.

**Type consistency:** `MODEL_TIER_VALUES`/`ModelTier`/`MODEL_SUBAGENT_TIERS`/`ModelsConfig`/`DerivedSubagentConfig`/`PersistedAlixConfig`/`isModelTier` (all in `schema.ts`, T1) → `normalizeModelConfig` (T2, imports from schema) → `resolveModelConfig(config, tier?: ModelTier)` (T3) → `withoutDerivedModelProjections`/`writeConfig` (T4) → `handleSetDefaultModel`/`handleSetTier` (T6). All names match across tasks.

## Verification

- `pnpm build` — clean.
- `node --test dist/tests/config-loader.test.js dist/tests/config/model-resolver.test.js dist/tests/config/persistence.test.js dist/tests/config/profile-patch.test.js dist/tests/models/model-install.test.js dist/tests/config/model-invariant.test.js dist/tests/cli/cli-commands.test.js` — all pass.
- `npx vitest run tests/cli/models-command.vitest.ts` — pass.
- Full `pnpm test:vitest` + `pnpm test:node` — no new failures (pre-existing streamSSE/unit failures on `main` are unrelated).
- Manual: `alix config show` renders active model; `alix models set-default` writes `models.default` only; `alix config set-default-model` → unknown command.
- GitNexus: `detect_changes()` before each commit; `impact()` on `loadConfig`, `mergeConfig`, `buildProfilePatch`, `applyProfilePatch`, `handleModelsCommand` before editing (CLAUDE.md requirement).
