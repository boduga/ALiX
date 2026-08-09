import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProfilePatch, applyProfilePatch } from "../../src/config/profile-patch.js";
import { withoutDerivedModelProjections } from "../../src/config/persistence.js";
import { normalizeModelConfig, loadConfig, _setHomedirOverride } from "../../src/config/loader.js";
import { persistModelSelection } from "../../src/cli/commands/models.js";
import { applyProfile } from "../../src/models/model-install.js";
import { getProfile } from "../../src/config/profile-registry.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { AlixConfig } from "../../src/config/schema.js";

const NO_PROJECTION = "derived model/subagents projection must not be persisted";

async function withProjectDir() {
  const dir = await mkdtemp(join(tmpdir(), "alix-invariant-"));
  return {
    dir,
    projectConfigPath: join(dir, ".alix", "config.json"),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

// --- §12.1 Profile persistence invariant ---

test("§12.1 profile application strips stale model/subagents, keeps models+modelProfile", () => {
  const stale: AlixConfig = {
    ...DEFAULT_CONFIG,
    model: { provider: "legacy", name: "legacy" },
    subagents: { enabled: true, roles: [], coding: { provider: "legacy", name: "legacy" } },
    models: { default: { provider: "ollama", name: "qwen3:4b" } },
  };
  const profile = getProfile("balanced-local")!;
  const persisted = applyProfilePatch(stale, buildProfilePatch(profile));
  assert.equal("model" in persisted, false, NO_PROJECTION);
  assert.equal("subagents" in persisted, false, NO_PROJECTION);
  assert.ok(persisted.models, "models retained");
  assert.equal(persisted.modelProfile, "balanced-local", "modelProfile retained");
});

// --- §12.2 models set-default ---

test("§12.2 set-default writes models.default with no projections", async () => {
  const { dir, projectConfigPath, cleanup } = await withProjectDir();
  try {
    await mkdir(join(dir, ".git"), { recursive: true }); // force project-config path
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(projectConfigPath, JSON.stringify({ model: { provider: "legacy", name: "legacy" } }));
    await persistModelSelection(dir, "default", { provider: "openai", name: "gpt-4o" });
    const saved = JSON.parse(await readFile(projectConfigPath, "utf8"));
    assert.ok(saved.models?.default, "models.default written");
    assert.equal(saved.model, undefined, NO_PROJECTION);
    assert.equal(saved.subagents, undefined, NO_PROJECTION);
  } finally {
    await cleanup();
  }
});

// --- §12.3 models set-tier ---

test("§12.3 set-tier merges without erasing unrelated tiers and no projections", async () => {
  const { dir, projectConfigPath, cleanup } = await withProjectDir();
  try {
    await mkdir(join(dir, ".git"), { recursive: true });
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(projectConfigPath, JSON.stringify({
      models: { default: { provider: "openai", name: "gpt-4o" }, fast: { provider: "openai", name: "gpt-4o-mini" } },
    }));
    await persistModelSelection(dir, "coding", { provider: "anthropic", name: "claude-3-5-sonnet" });
    const saved = JSON.parse(await readFile(projectConfigPath, "utf8"));
    assert.equal(saved.models.coding.provider, "anthropic");
    assert.equal(saved.models.default.name, "gpt-4o", "default survives");
    assert.equal(saved.models.fast.name, "gpt-4o-mini", "fast survives");
    assert.equal(saved.model, undefined, NO_PROJECTION);
    assert.equal(saved.subagents, undefined, NO_PROJECTION);
  } finally {
    await cleanup();
  }
});

// --- §12.4 init ---

test("§12.4 init writes canonical models with no projections", async () => {
  const { dir, projectConfigPath, cleanup } = await withProjectDir();
  try {
    const { runInit } = await import("../../src/cli/commands/init.js");
    await runInit(dir);
    assert.ok(existsSync(projectConfigPath), ".alix/config.json created");
    const saved = JSON.parse(await readFile(projectConfigPath, "utf8"));
    assert.ok(saved.models?.default, "models.default written by init");
    assert.equal(saved.model, undefined, NO_PROJECTION);
    assert.equal(saved.subagents, undefined, NO_PROJECTION);
  } finally {
    await cleanup();
  }
});

// --- §12.5 model-install ---

test("§12.5 install-profile persists models with no projections and no brand", async () => {
  const { dir, projectConfigPath, cleanup } = await withProjectDir();
  try {
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(projectConfigPath, JSON.stringify({ version: 1 })); // applyProfile requires an existing config
    await applyProfile("balanced-local", dir);
    const raw = await readFile(projectConfigPath, "utf8");
    const saved = JSON.parse(raw);
    assert.ok(saved.models, "models written");
    assert.equal(saved.model, undefined, NO_PROJECTION);
    assert.equal(saved.subagents, undefined, NO_PROJECTION);
    assert.equal(saved.__persistedConfigBrand, undefined, "brand must never serialize");
    assert.equal(raw.includes("persistedConfigBrand"), false);
  } finally {
    await cleanup();
  }
});

// --- §12.6 Loader migration (definitive migration-safety test) ---

test("§12.6 legacy model migrates to models.default with all projections, disk untouched", async () => {
  const { dir, projectConfigPath, cleanup } = await withProjectDir();
  try {
    await mkdir(join(dir, ".alix"), { recursive: true });
    const legacy = { model: { provider: "legacy", name: "legacy-model" } };
    await writeFile(projectConfigPath, JSON.stringify(legacy));
    const before = await readFile(projectConfigPath, "utf8");

    _setHomedirOverride(join(dir, ".tmp-homedir"));
    try {
      const loaded = await loadConfig(dir);
      // Canonical default seeded from legacy.
      assert.equal(loaded.models?.default?.provider, "legacy");
      // Runtime projections present.
      assert.equal(loaded.model?.provider, "legacy");
      assert.ok(loaded.subagents, "subagents projection present");
      for (const tier of ["thinking", "coding", "fast", "critic", "tiny", "image"]) {
        assert.equal((loaded.subagents as any)?.[tier]?.provider, "legacy", `${tier} derived from default`);
      }
    } finally {
      _setHomedirOverride(undefined);
    }

    const after = await readFile(projectConfigPath, "utf8");
    assert.equal(after, before, "loading must never write to disk");
  } finally {
    await cleanup();
  }
});

// --- §12.7 Precedence ---

test("§12.7 canonical models.default beats legacy model", () => {
  const config: Partial<AlixConfig> = {
    model: { provider: "legacy", name: "legacy" },
    models: { default: { provider: "canonical", name: "canonical" } },
  };
  normalizeModelConfig(config);
  assert.equal(config.models?.default?.provider, "canonical", "legacy must not replace models.default");
  assert.equal(config.model?.provider, "canonical");
});

test("§12.7 models.<tier> beats models.default", () => {
  const config: Partial<AlixConfig> = {
    models: { default: { provider: "openai", name: "gpt-4o" }, coding: { provider: "anthropic", name: "claude-opus" } },
  };
  normalizeModelConfig(config);
  assert.equal(config.subagents?.coding?.provider, "anthropic", "tier wins over default");
  assert.equal(config.subagents?.fast?.provider, "openai", "unset tier falls back to default");
});

// --- §12.8 Invalid authoritative default ---

test("§12.8 invalid models.default is not replaced, has no projection, not a fallback", () => {
  const config: Partial<AlixConfig> = {
    model: { provider: "legacy", name: "legacy" },
    models: { default: { provider: "", name: "" }, thinking: { provider: "anthropic", name: "claude-opus" } },
  };
  normalizeModelConfig(config);
  assert.deepEqual(config.models?.default, { provider: "", name: "" }, "legacy must not replace invalid default");
  assert.equal(config.model, undefined, "invalid default cannot back the model projection");
  assert.equal(config.subagents?.thinking?.provider, "anthropic", "tier remains independently resolvable");
  assert.equal(config.subagents?.coding, undefined, "invalid default is never used as a fallback");
});
