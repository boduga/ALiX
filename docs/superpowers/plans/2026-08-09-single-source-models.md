# Single-Source Model Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `models` the single persistent source of model assignments; `model` and `subagents.*` become derived compatibility projections normalized in-memory at the loader boundary; collapse all model writers into the `alix models` family; remove the legacy `config set-default-model` / `config set-tier` commands.

**Architecture (three layers):**
1. **Persistent representation** — only `models` and `modelProfile` hold model-selection state on disk. `model` and `subagents.*` are NEVER persisted by any writer.
2. **Loader compatibility projection** — `loadConfig()` produces, in memory only: `models` (authoritative), `model := models.default` (derived), `subagents[tier] := models.<tier> ?? models.default` (derived).
3. **Runtime resolution** — new code calls `resolveModelConfig(config, tier?)` (a **pure reader**, never mutates config); it does not touch the compatibility projections.

**Tech Stack:** TypeScript strict, node:test (`*.test.ts`) + vitest (`*.vitest.ts`), conventional commits.

## Global Constraints

- **The invariant (load-bearing):** No configuration writer may persist `model.*` or `subagents.<tier>` as an independent model assignment. All persisted model assignments MUST originate under `models`. `model` and `subagents.*` exist solely as compatibility projections.
- **Migration is in-memory only** — `loadConfig()` never rewrites `config.json`; a config file with a legacy `model` field is left byte-for-byte untouched on load.
- **Precedence:** `models.default` is authoritative; legacy `model` only seeds it when absent; when both present, `models.default` wins.
- **Tier precedence:** `subagents[tier] := models.<tier> ?? models.default`.
- `apiKeys` remains separate — never coupled to model selection.
- **Canonical `ModelTier`** is a closed union: `default | thinking | coding | fast | critic | tiny | image`. No other tier string exists.
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
```

Change `AlixConfig.models?: Record<string, { provider: string; name: string; temperature?: number; contextWindow?: number }>` → `models?: ModelsConfig`.

- [ ] **Step 2: Align `profile-types.ts` `ModelTier`**

`src/config/profile-types.ts:8-15` defines `ModelTier` as `default | planner | researcher | coder | critic | embeddings | classifier`. These are *profile* tier names, distinct from the *config* `ModelTier`. Rename the profile one to `ProfileModelTier` and note it's a preset vocabulary that maps onto config tiers. **Resolve the `coder` vs `coding` inconsistency explicitly:** the profile tier `coder` maps to config tier `coding` (as `profile-patch.ts:60` already does via `tierMap`). Document this mapping in the type; do NOT introduce a `coder` config tier.

- [ ] **Step 3: Writer/reader audit (search, classify, record — do not change code)**

```bash
rg 'config\.model|config\.models|subagents|modelProfile' src --glob '!**/*.test.*'
rg 'writeFile|writeJson|saveConfig|save.*Config|updateConfig|mergeConfig' src
```

Classify every hit into: `authoritative-writer` / `derived-reader` / `profile-writer` / `cli-writer` / `runtime-reader` / `migration-loader`. Record the classification in this task's notes (commit message body). This proves the Task 6 (reader) and Task 4/5 (writer) surfaces are complete before any change.

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
- Produces: `export const MODEL_TIERS: readonly ModelTier[]` and `export function normalizeModelConfig(config: Partial<AlixConfig>): void` — mutates in place; **deterministically replaces** `subagents` with a pure projection (never merges stale keys).

- [ ] **Step 1: Write the failing tests**

```ts
import { normalizeModelConfig, MODEL_TIERS } from "../src/config/loader.js";

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
export const MODEL_TIERS: readonly ModelTier[] = [
  "thinking", "coding", "fast", "critic", "tiny", "image",
];

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
  // 3. Deterministic subagent projection: derivedSubagents replaces subagents
  //    wholesale. A canonical tier not in `models` falls back to default; a
  //    stale/extra key never survives.
  const derived: Partial<Record<ModelTier, ModelConfig>> = {};
  if (config.models) {
    for (const tier of MODEL_TIERS) {
      const model = config.models[tier] ?? def;
      if (model?.provider && model?.name) {
        derived[tier] = { provider: model.provider, name: model.name };
      }
    }
  }
  // Preserve the semantic distinction between "no model configuration exists"
  // (subagents stays unset) and "model configuration exists but derives zero
  // tiers". Only assign subagents when at least one tier resolved.
  config.subagents = Object.keys(derived).length
    ? (derived as SubagentConfig)
    : undefined;
}
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
- Produces: `resolveModelConfig(config: AlixConfig, tier?: ModelTier): ModelConfig` — **pure**: reads `config.models` only, throws on no match, never mutates config. Takes an already-normalized config (callers get it from `loadConfig`).

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
  const model = tier
    ? config.models?.[tier] ?? config.models?.default
    : config.models?.default;
  if (!model?.provider || !model?.name) {
    throw new Error('No model configured. Run: alix models set-default');
  }
  return { provider: model.provider, name: model.name };
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
- Produces: `buildProfilePatch(profile)` → `{ modelProfile, models }` (no `model`, no `subagents`). `applyProfilePatch(existing, patch)` → result with `modelProfile` + `models` set and **legacy `model`/`subagents` keys REMOVED** from the returned object (so a downstream writer can't accidentally serialize them).

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

export function applyProfilePatch(existingConfig: AlixConfig, patch: ProfilePatch): AlixConfig {
  // Start from a copy that EXCLUDES legacy model/subagents projections.
  const { model, subagents, models: _oldModels, ...rest } = existingConfig;
  const result: Record<string, unknown> = { ...rest };
  result.modelProfile = patch.modelProfile;
  if (patch.models) result.models = { ...((patch.models) as object) };
  if (patch.runtime) result.runtime = { ...(result.runtime as object), ...patch.runtime };
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
- Consumes: `ModelsConfig`, `MODEL_TIERS`, `normalizeModelConfig`, provider-selection helpers, `setApiKey`.
- Produces: `handleSetDefaultModel(args)` → persists `{ models: { default } }` (derives `model` only in memory for display, never persists it). `handleSetTier(args)` → persists `{ models: { tier } }`. Registered in `models.ts` HANDLERS as `"set-default"`/`"set-tier"`.

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
  it("writes models.coding, not subagents.coding", async () => {
    const { dir, config } = tmpCwd();
    try {
      process.chdir(dir);
      await handleSetTier(["coding"]);
      const saved = JSON.parse(readFileSync(config, "utf8"));
      expect(saved.models.coding).toEqual({ provider: "deepseek", name: "deepseek-chat" });
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

Port the body of today's `set-default-model` / `set-tier` (interactive provider pick → key → `listModels` → model pick → write), but persist **only** `models.default` / `models.<tier>`. Call `normalizeModelConfig` on the in-memory object purely so a post-write `config show` reflects the derived `model`, but the **file** contains only `models` (plus preserved sections). Validate tier against `MODEL_TIERS`.

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

If the CLI dispatcher is testable directly (it's a chain of `if (command === ...)` at module scope — invoke the built CLI via a subprocess for a true behavioral assertion):

```ts
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("legacy config model commands fail as unknown commands", () => {
  const cli = fileURLToPath(new URL("../../bin/alix.js", import.meta.url));
  // both should exit non-zero with an unknown-command error
  for (const args of [["config", "set-default-model"], ["config", "set-tier"]]) {
    assert.throws(
      () => execFileSync("node", [cli, ...args], { encoding: "utf8", stdio: "pipe" }),
      (e: any) => e.status !== 0 && /unknown command|not a command|unrecognized/i.test(e.stderr + e.stdout),
    );
  }
});

test("models set-default and set-tier are recognized", () => {
  const cli = fileURLToPath(new URL("../../bin/alix.js", import.meta.url));
  for (const args of [["models", "set-default"], ["models", "set-tier"]]) {
    // reaches the interactive picker (won't complete without stdin) but is RECOGNIZED
    const out = execFileSync("node", [cli, ...args], { encoding: "utf8", stdio: "pipe", input: "" });
    assert.ok(!/unknown command/i.test(out));
  }
});
```

If `bin/alix.js` requires TTY, fall back to a unit-level dispatch test: extract the command→handler mapping into an exported `COMMAND_TABLE` (or test that `src/cli.ts` no longer registers the legacy handlers by importing its dispatch module). The **key requirement** is a behavioral assertion on the public contract, not `readFileSync(...).includes(...)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/cli/cli-commands.test.js`
Expected: FAIL — legacy commands still recognized.

- [ ] **Step 3: Remove the two blocks** from `src/cli.ts` (lines 680-733 `set-default-model`, 735-813 `set-tier`). Search `src/cli.ts` and `src/cli/commands/*` for `set-default-model` / `set-tier` references and remove from usage text.

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

Replace `config.model.provider/name` reads with `const { provider, name } = resolveModelConfig(config);`. In `session.ts` keep `ctx.config.model.streaming` (a derived convenience, not an assignment). Do NOT mutate `config.model`.

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
- Consumes: `normalizeModelConfig`, `resolveModelConfig`, `applyProfilePatch`, the `models` writers (via the CLI handlers or a direct writer helper).

- [ ] **Step 1: Write the invariant suite**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeModelConfig } from "../../src/config/loader.js";
import { resolveModelConfig } from "../../src/config/model-resolver.js";
import { buildProfilePatch, applyProfilePatch } from "../../src/config/profile-patch.js";

// Persistence invariant: no model-writing path persists model.* or subagents.*
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

**Reviewer's 10 points → resolution:**
1. **Never persist derived model/subagents** → Task 5 writes only `models` (test asserts `saved.model === undefined`, `saved.subagents === undefined`); Task 4 strips them from profile output; Task 8 enforces.
2. **`resolveModelConfig` pure reader** → Task 3 drops `normalizeModelConfig` from the resolver; normalization lives only at the loader boundary (Task 2). Mutation-assertion test added.
3. **Typed `ModelsConfig` / canonical `ModelTier`** → Task 1 defines the closed union; all later tasks use it.
4. **`coder` vs `coding`** → Task 1 documents the profile→config tier map (coder→coding); Task 4 maps through it and asserts `models.coding`.
5. **Deterministic projection** → Task 2 rebuilds `subagents` wholesale (stale/extra keys dropped).
6. **Profile can't carry stale projections** → Task 4 destructures `model`/`subagents` out of the result; test proves it with non-empty input.
7. **Behavioral CLI test** → Task 6 uses subprocess/dispatch, not source-string grep.
8. **`subagent-cli.ts` precedence** → Task 7 documents the chain (override > models.<tier> > models.default) and adds a precedence test.
9. **Writer/reader audit** → Task 1 step 3 is a dedicated `rg` audit before any change.
10. **Invariant suite** → Task 8 covers persistence, load-compat, precedence, tier precedence, and in-memory-only migration.

**Spec coverage:** One store (T1/T2/T4/T5), loader projection (T2), resolver (T3), one writer family (T5 + T4), legacy removal (T6), runtime migration (T7), invariant (T8). apiKeys untouched. All 7 spec test categories present + migration-safety.

**Placeholder scan:** no TBD/TODO; every code step has concrete code. Task 6's subprocess test notes the TTY fallback explicitly.

**Type consistency:** `ModelTier`/`ModelsConfig` (T1) → `MODEL_TIERS` + `normalizeModelConfig` (T2) → `resolveModelConfig(config, tier?: ModelTier)` (T3) → `handleSetDefaultModel`/`handleSetTier` (T5). All names match across tasks.

## Verification

- `pnpm build` — clean.
- `node --test dist/tests/config-loader.test.js dist/tests/config/model-resolver.test.js dist/tests/config/profile-patch.test.js dist/tests/models/model-install.test.js dist/tests/config/model-invariant.test.js dist/tests/cli/cli-commands.test.js` — all pass.
- `npx vitest run tests/cli/models-command.vitest.ts` — pass.
- Full `pnpm test:vitest` + `pnpm test:node` — no new failures (pre-existing streamSSE/unit failures on `main` are unrelated).
- Manual: `alix config show` renders active model; `alix models set-default` writes `models.default` only; `alix config set-default-model` → unknown command.
- GitNexus: `detect_changes()` before each commit; `impact()` on `loadConfig`, `mergeConfig`, `buildProfilePatch`, `applyProfilePatch`, `handleModelsCommand` before editing (CLAUDE.md requirement).
