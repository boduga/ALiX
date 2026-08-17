import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, _setHomedirOverride, mergeConfig, normalizeModelConfig } from "../src/config/loader.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { AlixConfig, McpServerConfig } from "../src/config/schema.js";
import { MODEL_SUBAGENT_TIERS } from "../src/config/schema.js";
import { CredentialStore } from "../src/security/credentials/credential-store.js";
import { makeCredentialReference } from "../src/security/credentials/credential-reference.js";

function withMockedHomedir(dir: string): () => void {
  _setHomedirOverride(dir);
  return () => _setHomedirOverride(undefined);
}

// --- Config merge order tests ---

test("loadConfig throws when no config files exist (model is required)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  try {
    _setHomedirOverride(dir);
    await assert.rejects(
      () => loadConfig(dir),
      /No model configured/
    );
  } finally {
    _setHomedirOverride(undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService writes to the flat .alix/config.json (path reconciliation)", async () => {
  // Regression for the path-mismatch bug: ConfigMutationService used to
  // expect a *nested* dir (`<cwd>/.alix/config/`) while loadConfig read
  // the flat `<cwd>/.alix/config.json`. Sets wrote to the nested
  // (non-existent) path; reads came from the flat file — operators saw
  // the set "succeed" but the value never persisted. The fix is to pass
  // the flat dir (`.alix`) to the mutation service; this test pins
  // that mutation writes to the same file loadConfig reads.
  const { ConfigMutationService } = await import("../src/config/mutation.js");
  const dir = await mkdtemp(join(tmpdir(), "alix-config-roundtrip-"));
  try {
    // Seed a config that passes validateConfig. The validator is strict
    // about a handful of required fields; this is the minimal shape.
    const validConfig = {
      model: { provider: "deepseek", name: "deepseek-v4-flash" },
      ui: { port: 3000, host: "127.0.0.1" },
      context: { maxRepoMapTokens: 4000, repoMapMode: "lite" },
      runtime: { provider: "process", commandTimeoutMs: 120000 },
      permissions: {
        default: "ask",
        protectedPaths: [],
        denyCommands: [],
      },
    };
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(join(dir, ".alix", "config.json"), JSON.stringify(validConfig));

    // Construct the mutation service with the FLAT dir. Before the fix
    // this was `<cwd>/.alix/config` (nested), and the write landed at
    // a non-existent path. With the fix, the write lands at the flat
    // config.json — the same file loadConfig reads.
    const service = new ConfigMutationService(join(dir, ".alix"));
    await service.read();
    await service.set("permissions.default", "allow");

    // The flat config.json must now contain the new value on disk.
    const onDisk = JSON.parse(
      await readFile(join(dir, ".alix", "config.json"), "utf-8"),
    );
    assert.equal(onDisk.permissions.default, "allow");

    // The nested `config/config.json` (the pre-fix write target) must
    // NOT exist — it's a phantom path, and writes to it would silently
    // disappear because nothing reads from there.
    const nestedExists = existsSync(join(dir, ".alix", "config", "config.json"));
    assert.equal(nestedExists, false, "the nested config/config.json must not be created");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig merges global user config on top of defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({ model: { provider: "anthropic", name: "claude-custom" } })
    );
    const config = await loadConfig(dir);
    assert.equal(config.model.name, "claude-custom");
    assert.equal(config.model.provider, "anthropic");
    assert.equal(config.ui.port, 4137); // inherited from defaults
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig defaults model.streaming to true when unset (streaming default ON)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  const prev = process.env.ALIX_STREAMING;
  delete process.env.ALIX_STREAMING;
  try {
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({ model: { provider: "anthropic", name: "claude-custom" } })
    );
    const config = await loadConfig(dir);
    assert.equal(config.model.streaming, true);
  } finally {
    if (prev === undefined) delete process.env.ALIX_STREAMING;
    else process.env.ALIX_STREAMING = prev;
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig honors explicit model.streaming:false opt-out", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  const prev = process.env.ALIX_STREAMING;
  delete process.env.ALIX_STREAMING;
  try {
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({ model: { provider: "anthropic", name: "claude-custom", streaming: false } })
    );
    const config = await loadConfig(dir);
    assert.equal(config.model.streaming, false);
  } finally {
    if (prev === undefined) delete process.env.ALIX_STREAMING;
    else process.env.ALIX_STREAMING = prev;
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig honors ALIX_STREAMING=false over the default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  const prev = process.env.ALIX_STREAMING;
  process.env.ALIX_STREAMING = "false";
  try {
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({ model: { provider: "anthropic", name: "claude-custom" } })
    );
    const config = await loadConfig(dir);
    assert.equal(config.model.streaming, false);
  } finally {
    if (prev === undefined) delete process.env.ALIX_STREAMING;
    else process.env.ALIX_STREAMING = prev;
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig applies user config overrides on top of defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    // .alix/config.json (used as both global and project config) overrides defaults
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({ model: { provider: "openai", name: "gpt-4o" }, ui: { port: 5000 } })
    );
    const config = await loadConfig(dir);
    assert.equal(config.model.provider, "openai");
    assert.equal(config.model.name, "gpt-4o");
    assert.equal(config.ui.port, 5000);
    assert.ok(config.permissions.protectedPaths.includes(".git/**")); // defaults preserved
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig merges XDG config then global config then project config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    // XDG: sets model name
    await mkdir(join(dir, ".config", "alix"), { recursive: true });
    await writeFile(
      join(dir, ".config", "alix", "config.json"),
      JSON.stringify({ model: { name: "xdg-model" } })
    );
    // Global: sets provider
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({ model: { provider: "openai" } })
    );
    // Project: overrides provider
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({ model: { provider: "google" } })
    );
    const config = await loadConfig(dir);
    assert.equal(config.model.name, "xdg-model");   // XDG preserved
    assert.equal(config.model.provider, "google");   // project overrides
    assert.equal(config.ui.port, 4137);             // defaults preserved
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

// --- normalizeMcpServers tests ---

test("normalizeMcpServers converts Record map to array format", () => {
  const servers: Record<string, McpServerConfig> = {
    github: { type: "stdio", name: "github", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] }
  };
  const result = mergeConfig(DEFAULT_CONFIG, { mcpServers: servers as unknown as McpServerConfig[] });
  assert.equal(Array.isArray(result.mcpServers), true);
  assert.equal(result.mcpServers!.length, 1);
  assert.equal(result.mcpServers![0].name, "github");
  assert.equal(result.mcpServers![0].type, "stdio");
});

test("normalizeMcpServers keeps array format as-is", () => {
  const servers: McpServerConfig[] = [
    { name: "fetch", type: "stdio", command: "node", args: ["server.js"] }
  ];
  const result = mergeConfig(DEFAULT_CONFIG, { mcpServers: servers });
  assert.equal(result.mcpServers!.length, 1);
  assert.equal(result.mcpServers![0].name, "fetch");
});

test("normalizeMcpServers returns existing defaults when mcpServers is not overridden", () => {
  // DEFAULT_CONFIG.mcpServers has the "fetch" server; passing undefined preserves it
  const result = mergeConfig(DEFAULT_CONFIG, {});
  assert.equal(Array.isArray(result.mcpServers), true);
  assert.ok(result.mcpServers!.length >= 1, "should have default mcpServers");
  assert.equal(result.mcpServers![0].name, "fetch");
});

// --- API key injection tests ---

test("loadConfig injects API key from XDG user config as env var", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    await mkdir(join(dir, ".config", "alix"), { recursive: true });
    await writeFile(
      join(dir, ".config", "alix", "config.json"),
      JSON.stringify({ model: { provider: "openai", name: "gpt-4o" }, apiKeys: { openai: "xdg-key-123" } })
    );
    delete process.env.OPENAI_API_KEY;
    await loadConfig(dir);
    assert.equal(process.env.OPENAI_API_KEY, "xdg-key-123");
  } finally {
    restore();
    delete process.env.OPENAI_API_KEY;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig injects API key from global user config as env var", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({ model: { provider: "anthropic", name: "claude-3-5-sonnet" }, apiKeys: { anthropic: "global-key-456" } })
    );
    delete process.env.ANTHROPIC_API_KEY;
    await loadConfig(dir);
    assert.equal(process.env.ANTHROPIC_API_KEY, "global-key-456");
  } finally {
    restore();
    delete process.env.ANTHROPIC_API_KEY;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig injects API key from project config as env var", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({ model: { provider: "google", name: "gemini-2.5-flash" }, apiKeys: { google: "project-key-789" } })
    );
    delete process.env.GEMINI_API_KEY;
    await loadConfig(dir);
    assert.equal(process.env.GEMINI_API_KEY, "project-key-789");
  } finally {
    restore();
    delete process.env.GEMINI_API_KEY;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig prefers project config API key over global and XDG keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    await mkdir(join(dir, ".config", "alix"), { recursive: true });
    await writeFile(
      join(dir, ".config", "alix", "config.json"),
      JSON.stringify({ model: { provider: "anthropic", name: "claude-3-5-sonnet" }, apiKeys: { anthropic: "xdg-key" } })
    );
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({ model: { provider: "anthropic", name: "claude-3-5-sonnet" }, apiKeys: { anthropic: "global-key" } })
    );
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({ model: { provider: "anthropic", name: "claude-3-5-sonnet" }, apiKeys: { anthropic: "project-key" } })
    );
    delete process.env.ANTHROPIC_API_KEY;
    await loadConfig(dir);
    // env var is set to project key (last wins in merge)
    assert.equal(process.env.ANTHROPIC_API_KEY, "project-key");
  } finally {
    restore();
    delete process.env.ANTHROPIC_API_KEY;
    await rm(dir, { recursive: true, force: true });
  }
});

test("subagent roles are loaded from defaults", () => {
  const result = mergeConfig(DEFAULT_CONFIG, {});
  assert.equal(result.subagents!.enabled, true);
  assert.equal(result.subagents!.roles.length, 6);

  // Check each role's mode, retryCount, and style where applicable
  for (const r of result.subagents!.roles) {
    if (r.role === "explorer") {
      assert.equal(r.mode, "read_only");
      assert.equal(r.retryCount, 1);
      assert.equal(r.style, "fast");
    } else if (r.role === "reviewer") {
      assert.equal(r.mode, "read_only");
      assert.equal(r.retryCount, 1);
      assert.equal(r.style, "critic");
    } else if (r.role === "test_investigator") {
      assert.equal(r.mode, "read_only");
      assert.equal(r.retryCount, 1);
      assert.equal(r.style, "thinking");
    } else if (r.role === "docs_researcher") {
      assert.equal(r.mode, "read_only");
      assert.equal(r.retryCount, 1);
      assert.equal(r.style, "fast");
    } else if (r.role === "worker") {
      assert.equal(r.mode, "write");
      assert.equal(r.retryCount, 0);
      assert.equal(r.style, "coding");
    } else if (r.role === "researcher") {
      assert.equal(r.mode, "read_only");
      assert.equal(r.retryCount, 1);
      assert.equal(r.style, "fast");
    }
  }

  // Tier configs are no longer in DEFAULT_CONFIG — they are
  // inherited from the main model by loadConfig at runtime.
});

test("loadConfig does not override existing env var with config key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({ model: { provider: "openai", name: "gpt-4o" }, apiKeys: { openai: "config-key" } })
    );
    process.env.OPENAI_API_KEY = "already-set-key";
    await loadConfig(dir);
    assert.equal(process.env.OPENAI_API_KEY, "already-set-key");
  } finally {
    restore();
    delete process.env.OPENAI_API_KEY;
    await rm(dir, { recursive: true, force: true });
  }
});

// --- modelTiers config file override tests ---

test("loadConfig applies modelTiers from XDG config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    await mkdir(join(dir, ".config", "alix"), { recursive: true });
    await writeFile(
      join(dir, ".config", "alix", "config.json"),
      JSON.stringify({
        model: { provider: "openai", name: "gpt-4o" },
        modelTiers: {
          thinking: { provider: "openai", name: "gpt-4o" },
          coding: { provider: "openai", name: "gpt-4o-mini" }
        }
      })
    );
    const config = await loadConfig(dir);
    assert.equal(config.subagents!.thinking!.provider, "openai");
    assert.equal(config.subagents!.thinking!.name, "gpt-4o");
    assert.equal(config.subagents!.coding!.provider, "openai");
    assert.equal(config.subagents!.coding!.name, "gpt-4o-mini");
    // fast is not in modelTiers, so it inherits from the main model
    assert.equal(config.subagents!.fast!.provider, "openai");
    assert.equal(config.subagents!.fast!.name, "gpt-4o");
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig applies modelTiers from global config overriding XDG", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    await mkdir(join(dir, ".config", "alix"), { recursive: true });
    await writeFile(
      join(dir, ".config", "alix", "config.json"),
      JSON.stringify({
        model: { provider: "openai", name: "gpt-4o" },
        modelTiers: { thinking: { provider: "openai", name: "gpt-4o" } }
      })
    );
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({
        model: { provider: "openai", name: "gpt-4o" },
        modelTiers: { thinking: { provider: "google", name: "gemini-2.5-flash" } }
      })
    );
    const config = await loadConfig(dir);
    assert.equal(config.subagents!.thinking!.provider, "google");
    assert.equal(config.subagents!.thinking!.name, "gemini-2.5-flash");
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig applies modelTiers from project config overriding global and XDG", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    await mkdir(join(dir, ".config", "alix"), { recursive: true });
    await writeFile(
      join(dir, ".config", "alix", "config.json"),
      JSON.stringify({ model: { provider: "openai", name: "gpt-4o" }, modelTiers: { coding: { provider: "xdg", name: "xdg-model" } } })
    );
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({ model: { provider: "openai", name: "gpt-4o" }, modelTiers: { coding: { provider: "global", name: "global-model" } } })
    );
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({ model: { provider: "openai", name: "gpt-4o" }, modelTiers: { coding: { provider: "anthropic", name: "claude-sonnet-4" } } })
    );
    const config = await loadConfig(dir);
    assert.equal(config.subagents!.coding!.provider, "anthropic");
    assert.equal(config.subagents!.coding!.name, "claude-sonnet-4");
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("modelTiers config file override is overridden by env vars", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    await mkdir(join(dir, ".config", "alix"), { recursive: true });
    await writeFile(
      join(dir, ".config", "alix", "config.json"),
      JSON.stringify({
        model: { provider: "openai", name: "gpt-4o" },
        modelTiers: { thinking: { provider: "openai", name: "gpt-4o" } }
      })
    );
    process.env.ALIX_THINKING_PROVIDER = "google";
    process.env.ALIX_THINKING_MODEL = "gemini-2.5-flash";
    const config = await loadConfig(dir);
    assert.equal(config.subagents!.thinking!.provider, "google");
    assert.equal(config.subagents!.thinking!.name, "gemini-2.5-flash");
  } finally {
    restore();
    delete process.env.ALIX_THINKING_PROVIDER;
    delete process.env.ALIX_THINKING_MODEL;
    await rm(dir, { recursive: true, force: true });
  }
});
// --- Single-source model normalization tests (Task 2) ---
// normalizeModelConfig projects legacy `model` / `modelTiers` / env overrides
// onto the canonical `models` object and derives `model` + `subagents` from it.

test("normalizeModelConfig migrates legacy model to models.default", () => {
  const config: Partial<AlixConfig> = { model: { provider: "anthropic", name: "claude-3-5-sonnet" } };
  normalizeModelConfig(config);
  assert.deepEqual(config.models?.default, { provider: "anthropic", name: "claude-3-5-sonnet" });
  assert.equal(config.model?.provider, "anthropic");
});

test("normalizeModelConfig migration is in-memory (never writes disk)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    const config: Partial<AlixConfig> = { model: { provider: "anthropic", name: "claude-3-5-sonnet" } };
    normalizeModelConfig(config);
    assert.equal(existsSync(join(dir, ".alix", "config.json")), false);
    assert.equal(existsSync(join(dir, ".config", "alix", "config.json")), false);
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("normalizeModelConfig keeps existing models.default over legacy model", () => {
  const config: Partial<AlixConfig> = {
    model: { provider: "legacy", name: "old" },
    models: { default: { provider: "canonical", name: "new" } },
  };
  normalizeModelConfig(config);
  assert.deepEqual(config.models?.default, { provider: "canonical", name: "new" });
  assert.equal(config.model?.provider, "canonical");
});

test("normalizeModelConfig keeps invalid-but-present models.default over legacy model", () => {
  const config: Partial<AlixConfig> = {
    model: { provider: "legacy", name: "old" },
    models: { default: { provider: "", name: "" } },
  };
  normalizeModelConfig(config);
  // Key presence wins — legacy must never migrate over an existing default.
  assert.deepEqual(config.models?.default, { provider: "", name: "" });
  // ...but the invalid default cannot back the model projection.
  assert.equal(config.model, undefined);
});

test("normalizeModelConfig does not migrate invalid legacy model", () => {
  const config: Partial<AlixConfig> = { model: { provider: "", name: "" } };
  normalizeModelConfig(config);
  assert.equal(config.models?.default, undefined);
  assert.equal(config.model, undefined);
});

test("normalizeModelConfig derives model from models.default (clone, not reference)", () => {
  const config: Partial<AlixConfig> = { models: { default: { provider: "openai", name: "gpt-4o" } } };
  normalizeModelConfig(config);
  assert.equal(config.model?.provider, "openai");
  assert.equal(config.model?.name, "gpt-4o");
  assert.notEqual(config.model, config.models?.default);
});

test("normalizeModelConfig derives subagent tiers from canonical models", () => {
  const config: Partial<AlixConfig> = {
    models: {
      default: { provider: "openai", name: "gpt-4o" },
      thinking: { provider: "anthropic", name: "claude-opus" },
      coding: { provider: "openai", name: "gpt-4o-mini" },
    },
  };
  normalizeModelConfig(config);
  assert.equal(config.subagents?.thinking?.provider, "anthropic");
  assert.equal(config.subagents?.thinking?.name, "claude-opus");
  assert.equal(config.subagents?.coding?.provider, "openai");
  assert.equal(config.subagents?.coding?.name, "gpt-4o-mini");
});

test("normalizeModelConfig falls back to default for missing tiers", () => {
  const config: Partial<AlixConfig> = {
    models: { default: { provider: "openai", name: "gpt-4o" }, thinking: { provider: "anthropic", name: "claude-opus" } },
  };
  normalizeModelConfig(config);
  assert.equal(config.subagents?.thinking?.name, "claude-opus"); // explicit wins
  for (const tier of MODEL_SUBAGENT_TIERS) {
    if (tier === "thinking") continue;
    assert.equal((config.subagents as any)?.[tier]?.provider, "openai"); // from default
    assert.equal((config.subagents as any)?.[tier]?.name, "gpt-4o");
  }
});

test("normalizeModelConfig never uses invalid default as a fallback", () => {
  const config: Partial<AlixConfig> = {
    models: { default: { provider: "", name: "" }, thinking: { provider: "anthropic", name: "claude-opus" } },
  };
  normalizeModelConfig(config);
  assert.equal(config.model, undefined); // invalid default → no model projection
  assert.equal(config.subagents?.thinking?.name, "claude-opus");
  assert.equal(config.subagents?.coding, undefined); // no valid source, invalid default
});

test("normalizeModelConfig drops stale/non-canonical subagent tier keys", () => {
  const config: Partial<AlixConfig> = {
    models: { default: { provider: "openai", name: "gpt-4o" } },
    subagents: {
      enabled: true,
      roles: [],
      bogus: { provider: "x", name: "y" },
      coder: { provider: "x", name: "y" },
      oldTier: { provider: "x", name: "y" },
      classifier: { provider: "x", name: "y" },
    } as any,
  };
  normalizeModelConfig(config);
  const sub = config.subagents as any;
  assert.equal("bogus" in sub, false);
  assert.equal("coder" in sub, false);
  assert.equal("oldTier" in sub, false);
  assert.equal("classifier" in sub, false);
  assert.equal(sub.thinking?.provider, "openai"); // canonical tier projected
});

test("normalizeModelConfig preserves model metadata through projection", () => {
  const config: Partial<AlixConfig> = {
    models: {
      default: {
        provider: "anthropic", name: "claude-opus",
        temperature: 0.2, maxOutputTokens: 8192, maxContextTokens: 200000, maxIterations: 8, streaming: true,
      },
      thinking: {
        provider: "anthropic", name: "claude-opus",
        temperature: 0.1, maxOutputTokens: 4096, streaming: false,
      },
    },
  };
  normalizeModelConfig(config);
  assert.equal(config.model?.temperature, 0.2);
  assert.equal(config.model?.maxOutputTokens, 8192);
  assert.equal(config.model?.maxContextTokens, 200000);
  assert.equal(config.model?.maxIterations, 8);
  assert.equal(config.model?.streaming, true);
  // Runtime projections carry full ModelConfig metadata even though the
  // SubagentConfig tier type only guarantees provider/name.
  assert.equal((config.subagents?.thinking as any)?.temperature, 0.1);
  assert.equal((config.subagents?.thinking as any)?.maxOutputTokens, 4096);
  assert.equal((config.subagents?.thinking as any)?.streaming, false);
});

test("normalizeModelConfig empty config leaves model and subagents unset", () => {
  const config: Partial<AlixConfig> = {};
  normalizeModelConfig(config);
  assert.equal(config.model, undefined);
  assert.equal(config.subagents, undefined);
  assert.equal(config.models?.default, undefined);
});

test("normalizeModelConfig preserves subagents enabled/roles behavior config", () => {
  const config: Partial<AlixConfig> = {
    models: { default: { provider: "openai", name: "gpt-4o" } },
    subagents: {
      enabled: false,
      roles: [{ role: "worker", mode: "write", style: "coding", retryCount: 0 }],
    },
  };
  normalizeModelConfig(config);
  assert.equal(config.subagents?.enabled, false);
  assert.equal(config.subagents?.roles.length, 1);
  assert.equal(config.subagents?.thinking?.name, "gpt-4o"); // tier still projected
});

test("loadConfig routes config modelTiers into models and projects to subagents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(join(dir, ".alix", "config.json"), JSON.stringify({
      model: { provider: "openai", name: "gpt-4o" },
      modelTiers: { thinking: { provider: "anthropic", name: "claude-opus" } },
    }));
    const config = await loadConfig(dir);
    assert.equal(config.models?.thinking?.provider, "anthropic"); // authoritative
    assert.equal(config.models?.thinking?.name, "claude-opus");
    assert.equal(config.subagents?.thinking?.provider, "anthropic"); // observable via projection
    assert.equal(config.subagents?.thinking?.name, "claude-opus");
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ALIX_<TIER> env override lands in models and projects to subagents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  process.env.ALIX_CODING_PROVIDER = "google";
  process.env.ALIX_CODING_MODEL = "gemini-2.5-flash";
  try {
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(join(dir, ".alix", "config.json"), JSON.stringify({ model: { provider: "openai", name: "gpt-4o" } }));
    const config = await loadConfig(dir);
    assert.equal(config.models?.coding?.provider, "google"); // authoritative on models
    assert.equal(config.models?.coding?.name, "gemini-2.5-flash");
    assert.equal(config.subagents?.coding?.provider, "google"); // observable via projection
    assert.equal(config.subagents?.coding?.name, "gemini-2.5-flash");
  } finally {
    restore();
    delete process.env.ALIX_CODING_PROVIDER;
    delete process.env.ALIX_CODING_MODEL;
    await rm(dir, { recursive: true, force: true });
  }
});

test("ALIX_STREAMING lands in models.default.streaming and projects to model", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  const prev = process.env.ALIX_STREAMING;
  process.env.ALIX_STREAMING = "false";
  try {
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(join(dir, ".alix", "config.json"), JSON.stringify({ model: { provider: "openai", name: "gpt-4o" } }));
    const config = await loadConfig(dir);
    assert.equal(config.models?.default?.streaming, false); // authoritative on models.default
    assert.equal(config.model?.streaming, false); // reflected in projection
  } finally {
    if (prev === undefined) delete process.env.ALIX_STREAMING;
    else process.env.ALIX_STREAMING = prev;
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("default streaming:true lands in models.default.streaming", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  const prev = process.env.ALIX_STREAMING;
  delete process.env.ALIX_STREAMING;
  try {
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(join(dir, ".alix", "config.json"), JSON.stringify({ model: { provider: "openai", name: "gpt-4o" } }));
    const config = await loadConfig(dir);
    assert.equal(config.models?.default?.streaming, true);
    assert.equal(config.model?.streaming, true);
  } finally {
    if (prev === undefined) delete process.env.ALIX_STREAMING;
    else process.env.ALIX_STREAMING = prev;
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig merges models across config layers without dropping tiers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    await mkdir(join(dir, ".config", "alix"), { recursive: true });
    await writeFile(join(dir, ".config", "alix", "config.json"), JSON.stringify({
      models: { default: { provider: "openai", name: "gpt-4o" }, thinking: { provider: "anthropic", name: "claude-opus" } },
    }));
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(join(dir, ".alix", "config.json"), JSON.stringify({
      models: { coding: { provider: "google", name: "gemini-2.5-flash" } },
    }));
    const config = await loadConfig(dir);
    assert.equal(config.models?.default?.name, "gpt-4o"); // user layer preserved
    assert.equal(config.models?.thinking?.name, "claude-opus");
    assert.equal(config.models?.coding?.name, "gemini-2.5-flash"); // project layer added
    assert.equal(config.subagents?.thinking?.name, "claude-opus");
    assert.equal(config.subagents?.coding?.name, "gemini-2.5-flash");
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});
// --- Credential reference resolution tests (P4.3-Se1) ---

test("loadConfig resolves cred:// references in apiKeys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    // Populate credential store at the default platform state path
    const credDir = join(dir, ".local", "state", "alix-inspector", "data", "credentials");
    await mkdir(credDir, { recursive: true, mode: 0o700 });
    const credentialStore = new CredentialStore({
      filePath: join(credDir, "credential-store.json"),
    });
    await credentialStore.load();
    await credentialStore.set("openai", "apiKey", "sk-from-credential-store");

    // Project config with cred:// reference
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({
        model: { provider: "openai", name: "gpt-4o" },
        apiKeys: { openai: makeCredentialReference("openai", "apiKey") },
      })
    );

    delete process.env.OPENAI_API_KEY;
    const config = await loadConfig(dir, { credentialStore });
    assert.equal(process.env.OPENAI_API_KEY, "sk-from-credential-store");
    // The resolved key should also be in config.apiKeys
    assert.equal(config.apiKeys?.openai, "sk-from-credential-store");
  } finally {
    restore();
    delete process.env.OPENAI_API_KEY;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig throws clear error on missing credential reference", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    // Create an empty credential store
    const credDir = join(dir, ".local", "state", "alix-inspector", "data", "credentials");
    await mkdir(credDir, { recursive: true, mode: 0o700 });
    const credentialStore = new CredentialStore({
      filePath: join(credDir, "credential-store.json"),
    });
    await credentialStore.load();

    // Project config with cred:// reference to non-existent credential
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({
        model: { provider: "openai", name: "gpt-4o" },
        apiKeys: { openai: makeCredentialReference("openai", "apiKey") },
      })
    );

    await assert.rejects(
      () => loadConfig(dir, { credentialStore }),
      /Credential not found/
    );
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig mixed cred:// and plaintext apiKeys work together", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    // Populate credential store
    const credDir = join(dir, ".local", "state", "alix-inspector", "data", "credentials");
    await mkdir(credDir, { recursive: true, mode: 0o700 });
    const credentialStore = new CredentialStore({
      filePath: join(credDir, "credential-store.json"),
    });
    await credentialStore.load();
    await credentialStore.set("openai", "apiKey", "sk-from-store");

    // Project config with mixed: one cred:// reference, one plaintext
    await mkdir(join(dir, ".alix"), { recursive: true });
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({
        model: { provider: "openai", name: "gpt-4o" },
        apiKeys: {
          openai: makeCredentialReference("openai", "apiKey"),
          anthropic: "sk-plaintext-key",
        },
      })
    );

    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const config = await loadConfig(dir, { credentialStore });

    // cred:// reference resolved
    assert.equal(process.env.OPENAI_API_KEY, "sk-from-store");
    assert.equal(config.apiKeys?.openai, "sk-from-store");

    // Plaintext key preserved
    assert.equal(process.env.ANTHROPIC_API_KEY, "sk-plaintext-key");
    assert.equal(config.apiKeys?.anthropic, "sk-plaintext-key");
  } finally {
    restore();
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await rm(dir, { recursive: true, force: true });
  }
});
