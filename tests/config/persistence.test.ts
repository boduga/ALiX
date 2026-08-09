import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  withoutDerivedModelProjections,
  writeConfig,
} from "../../src/config/persistence.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { AlixConfig, PersistedAlixConfig } from "../../src/config/schema.js";

// Compile-time fixture for the brand tripwires: `declare` emits nothing at
// runtime, so `rawConfig` is undefined when the tests execute — the bodies
// below are type-only (erased) or guarded, never dereference it.
declare const rawConfig: AlixConfig;

// Fixture: full runtime config carrying the derived projections plus the
// canonical `models` object and unrelated persisted fields.
const fixture: AlixConfig = {
  ...DEFAULT_CONFIG,
  model: { provider: "legacy", name: "old" },
  subagents: {
    enabled: true,
    roles: [{ role: "worker", mode: "write", style: "coding", retryCount: 0 }],
    coding: { provider: "openai", name: "gpt-4o-mini" },
  },
  models: { default: { provider: "openai", name: "gpt-4o" } },
  apiKeys: { openai: "sk-test" },
};

// --- §4.1 Strip helper: projections removed, persisted fields survive ---

test("withoutDerivedModelProjections strips model and the subagent tier projections", () => {
  const persisted = withoutDerivedModelProjections(fixture);
  assert.equal("model" in persisted, false);
  // The six model-tier keys never persist; `enabled`/`roles` are behavior
  // config (§2.8.1) and survive when they differ from the defaults. The
  // fixture's `roles: [{worker}]` is non-default, so it is preserved; the
  // derived `coding` key is dropped.
  assert.deepEqual(persisted.subagents, { roles: fixture.subagents?.roles });
  assert.equal((persisted.subagents as any)?.coding, undefined);
});

test("withoutDerivedModelProjections preserves models (canonical source)", () => {
  const persisted = withoutDerivedModelProjections(fixture);
  assert.deepEqual(persisted.models, {
    default: { provider: "openai", name: "gpt-4o" },
  });
});

test("withoutDerivedModelProjections preserves apiKeys and other fields", () => {
  const persisted = withoutDerivedModelProjections(fixture);
  assert.deepEqual(persisted.apiKeys, { openai: "sk-test" });
  assert.equal(persisted.version, fixture.version);
});

// --- §4.3 Brand requirements ---

test("withoutDerivedModelProjections does not emit a runtime brand property", () => {
  const persisted = withoutDerivedModelProjections(fixture);
  assert.equal(JSON.stringify(persisted).includes("persistedConfigBrand"), false);
});

test("raw AlixConfig fails the PersistedAlixConfig type assignment", () => {
  // Compile-time assertions: the type-only unique-symbol brand means a raw
  // AlixConfig cannot structurally satisfy PersistedAlixConfig. If the brand
  // tripwires below (marked with @ts-expect-error) ever stop erroring, the
  // brand has become structural and this file fails to build. The body is
  // inside `if (false)` — tsc still type-checks it, but the erased `declare`
  // const never evaluates at runtime.
  if (false) {
    // @ts-expect-error — raw AlixConfig must not satisfy PersistedAlixConfig
    const bad: PersistedAlixConfig = rawConfig;
    // A hand-built Omit is not branded either.
    const handBuilt = { ...rawConfig } as Omit<AlixConfig, "model" | "subagents">;
    // @ts-expect-error — Omit without the brand must not satisfy PersistedAlixConfig
    const alsoBad: PersistedAlixConfig = handBuilt;
    void bad;
    void alsoBad;
  }
});

test("withoutDerivedModelProjections is the only construction path (branded OK)", () => {
  const persisted: PersistedAlixConfig = withoutDerivedModelProjections(fixture);
  assert.equal(persisted !== undefined, true);
});

// --- §4.2/§4.4 Shared writer ---

test("writeConfig writes a branded persisted config successfully", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-persist-"));
  const configPath = join(dir, "config.json");
  try {
    const persisted = withoutDerivedModelProjections(fixture);
    await writeConfig(persisted, configPath);
    assert.equal(existsSync(configPath), true);
    const raw = await readFile(configPath, "utf8");
    assert.equal(raw.endsWith("\n"), true);
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed.models, {
      default: { provider: "openai", name: "gpt-4o" },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("disk contains no top-level model projection or tier keys, no brand property", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-persist-"));
  const configPath = join(dir, "config.json");
  try {
    const persisted = withoutDerivedModelProjections(fixture);
    await writeConfig(persisted, configPath);
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    // Top-level `model` and the six subagent tier projections must not be
    // persisted. (Nested keys like `factory.model` in DEFAULT_CONFIG are
    // unrelated and legitimately survive.) Behavior config (`roles`) survives.
    assert.equal("model" in parsed, false);
    assert.deepEqual(parsed.subagents, { roles: fixture.subagents?.roles });
    assert.equal(parsed.subagents?.coding, undefined);
    assert.equal(raw.includes("persistedConfigBrand"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("default behavior config persists no subagents at all", () => {
  // enabled:true + DEFAULT roles match the loader defaults — nothing differs,
  // so nothing is persisted (§2.8.1: defaults are implied by the loader).
  const defaultBehavior: AlixConfig = {
    ...fixture,
    subagents: { enabled: true, roles: DEFAULT_CONFIG.subagents!.roles },
  };
  const persisted = withoutDerivedModelProjections(defaultBehavior);
  assert.equal("subagents" in persisted, false);
});

test("non-default enabled/roles survive persistence", () => {
  const disabled = withoutDerivedModelProjections({
    ...fixture,
    subagents: { ...fixture.subagents!, enabled: false, roles: [] },
  });
  assert.deepEqual(disabled.subagents, { enabled: false, roles: [] });
});

test("legacy model migrates to models.default before stripping (never data-loss)", () => {
  // §5.2: a config with a legacy `model` and no `models.default` must seed
  // models.default before the projection is stripped — otherwise stripping the
  // projection would destroy the user's only model assignment.
  const legacy = withoutDerivedModelProjections({
    ...fixture,
    model: { provider: "ollama", name: "legacy" },
    models: undefined as any,
    subagents: { enabled: true, roles: [], coding: { provider: "ollama", name: "old-coding" } },
  });
  assert.equal("model" in legacy, false);
  assert.deepEqual((legacy.models as any)?.default, { provider: "ollama", name: "legacy" });
  assert.equal((legacy.subagents as any)?.coding, undefined, "tier projection stripped");
});

test("writeConfig refuses a raw AlixConfig (compile-time)", async () => {
  // Type-only tripwire: writeConfig's parameter is PersistedAlixConfig, so a
  // raw AlixConfig must not be accepted without withoutDerivedModelProjections.
  // The call is inside `if (false)` so tsc still type-checks it (consuming the
  // ts-expect-error directive on the call line) but no runtime write occurs.
  // NOTE: the directive below is the ONLY one of its kind in this test.
  const dir = await mkdtemp(join(tmpdir(), "alix-persist-"));
  const configPath = join(dir, "config.json");
  try {
    if (false) {
      // @ts-expect-error — raw AlixConfig must not satisfy PersistedAlixConfig
      await writeConfig(rawConfig, configPath);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
