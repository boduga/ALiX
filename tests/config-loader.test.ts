import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, _setHomedirOverride, mergeConfig } from "../src/config/loader.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { AlixConfig, McpServerConfig } from "../src/config/schema.js";

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
  assert.equal(result.subagents!.roles.length, 5);

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